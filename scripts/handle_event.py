#!/usr/bin/env python3
"""根据 GitHub 事件维护 ``sites/`` 与 ``.meta/``，并给出是否需要部署。

支持的事件：
  * ``issues``        opened / edited / reopened / labeled / unlabeled
  * ``issue_comment`` /redeploy /delete /offline /online /rename /help
  * ``push`` / ``workflow_dispatch``  仅重建

用法（本地调试）：
    python3 scripts/handle_event.py --event payload.json --event-name issues
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sitekit as sk  # noqa: E402

COMMAND_RE = re.compile(r"^\s*/([a-zA-Z_-]+)\s*(.*?)\s*$")
TRUSTED_ASSOC = {"OWNER", "MEMBER", "COLLABORATOR"}

# 可以在 issue 上加的标签，用来触发操作
LABEL_ACTIONS = {
    "delete": "delete",
    "删除": "delete",
    "offline": "offline",
    "下线": "offline",
    "online": "online",
    "上线": "online",
    "deploy": "deploy",
    "部署": "deploy",
}


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #


def emit_outputs(values: dict) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{k}={v}" for k, v in values.items()]
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for line in lines:
        print(f"[output] {line}")


def emit_summary(markdown: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(markdown + "\n")
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# 计划
# --------------------------------------------------------------------------- #


class Plan:
    def __init__(self) -> None:
        self.changed = False
        self.should_deploy = False
        self.comment: str | None = None
        self.slug: str | None = None
        self.action = "noop"
        self.status = "ok"
        self.message = ""

    def fail(self, message: str) -> "Plan":
        self.status = "failed"
        self.message = message
        self.comment = f"❌ **部署失败**\n\n{message}\n\n{FOOTER}"
        return self


FOOTER = (
    "---\n"
    "<sub>可用命令：`/redeploy` 重新部署 · `/delete` 删除 · `/offline` 下线 · "
    "`/online` 恢复 · `/rename <新标识>` 改链接</sub>"
)


# --------------------------------------------------------------------------- #
# 事件读取
# --------------------------------------------------------------------------- #


def load_event() -> dict:
    path = os.environ.get("GITHUB_EVENT_PATH")
    for i, arg in enumerate(sys.argv):
        if arg == "--event" and i + 1 < len(sys.argv):
            path = sys.argv[i + 1]
        elif arg.startswith("--event="):
            path = arg.split("=", 1)[1]
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except ValueError:
            return {}


def event_name() -> str:
    name = os.environ.get("GITHUB_EVENT_NAME", "")
    for i, arg in enumerate(sys.argv):
        if arg == "--event-name" and i + 1 < len(sys.argv):
            name = sys.argv[i + 1]
        elif arg.startswith("--event-name="):
            name = arg.split("=", 1)[1]
    return name


# --------------------------------------------------------------------------- #
# 动作实现
# --------------------------------------------------------------------------- #


def _issue_labels(issue: dict) -> list[str]:
    return [str(lb.get("name", "")).lower() for lb in (issue.get("labels") or [])]


def _label_action(label_name: str) -> str | None:
    return LABEL_ACTIONS.get((label_name or "").strip().lower())


def resolve_slug(parsed: dict, issue: dict) -> str:
    raw = parsed.get("slug")
    if not raw:
        raw = sk.slug_from_title(parsed.get("title") or issue.get("title") or "", issue.get("number"))
    slug = sk.normalize_slug(raw)
    if not slug:
        raise sk.SiteError(
            "无法生成合法的页面标识。请在 issue 的「页面标识」里填一个英文 slug，例如 `my-demo`。"
        )
    return slug


def do_deploy(issue: dict, plan: Plan) -> None:
    number = issue.get("number")
    parsed = sk.parse_issue(issue.get("body") or "", issue.get("title") or "", number)
    if parsed["errors"]:
        raise sk.SiteError("\n".join(parsed["errors"]))

    slug = resolve_slug(parsed, issue)
    existing = sk.load_meta(slug)
    if existing and existing.get("issue") not in (None, number):
        raise sk.SiteError(
            f"标识 `{slug}` 已被 issue #{existing['issue']} 占用，请换一个标识。"
        )

    site_dir = os.path.join(sk.SITES_DIR, slug)
    files = sk.materialize(site_dir, parsed)
    total_bytes = sum(
        os.path.getsize(os.path.join(site_dir, f)) for f in files if os.path.isfile(os.path.join(site_dir, f))
    )

    now = sk.now_iso()
    meta = dict(existing or {})
    meta.update(
        {
            "slug": slug,
            "title": parsed["title"],
            "description": parsed["description"],
            "tags": parsed["tags"],
            "issue": number,
            "source": {"type": parsed["mode"], "url": parsed.get("url") or None},
            "updated_at": now,
            "file_count": len(files),
            "size_bytes": total_bytes,
        }
    )
    meta.setdefault("status", "active")
    meta.setdefault("created_at", now)
    sk.save_meta(meta)

    plan.changed = True
    plan.should_deploy = True
    plan.slug = slug
    plan.action = "deploy"
    plan.message = f"已部署 `{slug}`（{len(files)} 个文件）"
    plan.comment = render_deploy_comment(meta, files, parsed)


def render_deploy_comment(meta: dict, files: list[str], parsed: dict) -> str:
    url = sk.site_url(meta["slug"])
    mode_label = {"inline": "内联 HTML", "zip": "压缩包", "url": "远程网址"}.get(
        meta.get("source", {}).get("type"), "未知"
    )
    status = meta.get("status", "active")
    badge = "✅ **部署完成**" if status == "active" else "⚠️ **部署完成（当前处于下线状态）**"

    lines = [f"{badge} → [打开页面]({url})", ""]
    lines.append("| 项 | 值 |")
    lines.append("| --- | --- |")
    lines.append(f"| 链接 | <{url}> |")
    lines.append(f"| 标识 | `{meta['slug']}` |")
    lines.append(f"| 标题 | {meta['title']} |")
    if meta.get("description"):
        lines.append(f"| 说明 | {meta['description']} |")
    if meta.get("tags"):
        lines.append("| 标签 | " + " ".join(f"`{t}`" for t in meta["tags"]) + " |")
    lines.append(f"| 来源 | {mode_label} |")
    lines.append(f"| 文件数 | {len(files)} |")
    lines.append(f"| 更新时间 | `{meta['updated_at']}` |")
    lines.append("")

    shown = files[:40]
    lines.append(f"<details><summary>文件列表（{len(files)} 个）</summary>\n")
    lines.append("\n".join(f"- `{f}`" for f in shown))
    if len(files) > len(shown):
        lines.append(f"- …还有 {len(files) - len(shown)} 个")
    lines.append("\n</details>")
    lines.append("")
    lines.append("> 首次部署后可能需要等 10–60 秒，Pages 才会在 CDN 上生效。")
    lines.append("")
    lines.append(FOOTER)
    return "\n".join(lines)


def do_delete(issue: dict, plan: Plan, slug: str | None) -> None:
    slug = slug or _slug_for_issue(issue)
    if not slug:
        raise sk.SiteError("找不到这个 issue 对应的页面，无法删除。")
    existed = sk.delete_site(slug)
    plan.changed = existed
    plan.should_deploy = existed
    plan.slug = slug
    plan.action = "delete"
    plan.message = f"已删除 `{slug}`" if existed else f"`{slug}` 不存在，无需删除"
    if existed:
        plan.comment = (
            f"🗑️ **已删除** `{slug}`\n\n"
            f"链接 <{sk.site_url(slug)}> 现在返回 404。\n\n"
            "想重新上线？编辑 issue 正文后评论 `/redeploy` 即可。\n\n" + FOOTER
        )
    else:
        plan.comment = f"ℹ️ 没有找到 `{slug}`，无需删除。\n\n{FOOTER}"


def do_set_status(issue: dict, plan: Plan, status: str, slug: str | None) -> None:
    slug = slug or _slug_for_issue(issue)
    if not slug:
        raise sk.SiteError("找不到这个 issue 对应的页面。")
    meta = sk.load_meta(slug)
    if not meta:
        raise sk.SiteError(f"页面 `{slug}` 还不存在，先部署再下线。")
    if meta.get("status") == status:
        plan.slug = slug
        plan.action = status
        plan.message = f"`{slug}` 已经是 {status} 状态"
        plan.comment = f"ℹ️ `{slug}` 已经处于该状态，无需重复操作。\n\n{FOOTER}"
        return
    meta["status"] = status
    meta["updated_at"] = sk.now_iso()
    sk.save_meta(meta)
    plan.changed = True
    plan.should_deploy = True
    plan.slug = slug
    plan.action = status
    if status == "offline":
        plan.message = f"已下线 `{slug}`"
        plan.comment = (
            f"🚧 **已下线** `{slug}`\n\n"
            f"链接 <{sk.site_url(slug)}> 现在返回 404，但源码仍保留在仓库里。\n\n"
            "评论 `/online` 可以恢复。\n\n" + FOOTER
        )
    else:
        plan.message = f"已上线 `{slug}`"
        plan.comment = (
            f"🚀 **已恢复上线** `{slug}` → <{sk.site_url(slug)}>\n\n" + FOOTER
        )


def do_rename(issue: dict, plan: Plan, new_slug: str, old_slug: str | None) -> None:
    old_slug = old_slug or _slug_for_issue(issue)
    if not old_slug:
        raise sk.SiteError("找不到这个 issue 对应的页面。")
    target = sk.normalize_slug(new_slug)
    if not target:
        raise sk.SiteError(f"新标识 `{new_slug}` 不合法，只能用字母、数字、`-`、`_`、`.`。")
    if target == old_slug:
        plan.slug = old_slug
        plan.action = "rename"
        plan.comment = f"ℹ️ 标识已经是 `{old_slug}`，无需改名。\n\n{FOOTER}"
        return
    if sk.load_meta(target):
        raise sk.SiteError(f"标识 `{target}` 已被占用，换一个吧。")

    old_dir = os.path.join(sk.SITES_DIR, old_slug)
    new_dir = os.path.join(sk.SITES_DIR, target)
    if os.path.isdir(old_dir):
        os.replace(old_dir, new_dir)
    meta = sk.load_meta(old_slug) or {"slug": old_slug, "issue": issue.get("number")}
    if os.path.exists(sk.meta_path(old_slug)):
        os.remove(sk.meta_path(old_slug))
    meta["slug"] = target
    meta["updated_at"] = sk.now_iso()
    sk.save_meta(meta)

    plan.changed = True
    plan.should_deploy = True
    plan.slug = target
    plan.action = "rename"
    plan.message = f"`{old_slug}` → `{target}`"
    plan.comment = (
        f"🔀 **已改名** `{old_slug}` → `{target}`\n\n"
        f"新链接：<{sk.site_url(target)}>\n\n"
        f"旧链接 <{sk.site_url(old_slug)}> 现在返回 404，记得更新外链。\n\n" + FOOTER
    )


def _slug_for_issue(issue: dict) -> str | None:
    """按 issue 号反查它拥有的页面。"""
    number = issue.get("number")
    for meta in sk.all_meta():
        if meta.get("issue") == number:
            return str(meta.get("slug"))
    return None


# --------------------------------------------------------------------------- #
# 事件分发
# --------------------------------------------------------------------------- #


def handle_issue_event(event: dict, plan: Plan) -> None:
    action = event.get("action", "")
    issue = event.get("issue") or {}
    if not issue:
        return

    if action == "labeled":
        label = ((event.get("label") or {}).get("name") or "").lower()
        what = _label_action(label)
        if what == "delete":
            do_delete(issue, plan, None)
        elif what == "offline":
            do_set_status(issue, plan, "offline", None)
        elif what == "online":
            do_set_status(issue, plan, "online", None)
        elif what == "deploy":
            do_deploy(issue, plan)
        return

    if action == "unlabeled":
        label = ((event.get("label") or {}).get("name") or "").lower()
        if _label_action(label) == "offline":
            do_set_status(issue, plan, "online", None)
        return

    if action == "closed":
        # 关闭 issue 不动线上内容，避免误删
        return

    if action in ("opened", "edited", "reopened"):
        # 已经下线过的页面，编辑时不自动恢复上线
        do_deploy(issue, plan)
        return


def handle_comment_event(event: dict, plan: Plan) -> None:
    issue = event.get("issue") or {}
    comment = event.get("comment") or {}
    if not issue or issue.get("pull_request"):
        return

    body = comment.get("body") or ""
    first_line = body.strip().splitlines()[0] if body.strip() else ""
    m = COMMAND_RE.match(first_line)
    if not m:
        return  # 不是命令，什么都不做

    cmd = m.group(1).lower()
    args = (m.group(2) or "").strip()

    # 只有 issue 作者本人或仓库协作者能操作
    author = (comment.get("user") or {}).get("login", "")
    issue_author = (issue.get("user") or {}).get("login", "")
    assoc = (comment.get("author_association") or "").upper()
    if author != issue_author and assoc not in TRUSTED_ASSOC:
        plan.comment = "🚫 只有 issue 作者或仓库协作者可以执行这个命令。"
        return

    if cmd in ("help", "?"):
        plan.comment = HELP_TEXT
        return
    if cmd in ("redeploy", "update", "deploy"):
        do_deploy(issue, plan)
        return
    if cmd == "delete":
        do_delete(issue, plan, None)
        return
    if cmd == "offline":
        do_set_status(issue, plan, "offline", None)
        return
    if cmd == "online":
        do_set_status(issue, plan, "online", None)
        return
    if cmd == "rename":
        if not args:
            raise sk.SiteError("用法：`/rename 新的-英文-标识`")
        do_rename(issue, plan, args, None)
        return
    plan.comment = f"❓ 未知命令 `/{cmd}`。\n\n{HELP_TEXT}"


HELP_TEXT = """### 可用命令

| 命令 | 作用 |
| --- | --- |
| `/redeploy` | 按当前 issue 正文重新部署 |
| `/delete` | 删除页面（源码也一起删掉） |
| `/offline` | 下线，链接返回 404，源码保留 |
| `/online` | 恢复上线 |
| `/rename <新标识>` | 改链接标识，例如 `/rename my-new-name` |
| `/help` | 显示这条帮助 |

也可以直接给 issue 打标签：`delete` / `offline` / `online` / `deploy`。
"""


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #


def run() -> int:
    name = event_name()
    event = load_event()
    plan = Plan()

    try:
        if name == "issue_comment":
            handle_comment_event(event, plan)
        elif name == "issues":
            handle_issue_event(event, plan)
        else:
            # push / workflow_dispatch / schedule：直接重建
            plan.should_deploy = True
            plan.action = "rebuild"
    except sk.SiteError as exc:
        plan.fail(str(exc))
    except Exception as exc:  # noqa: BLE001 - 兜底，避免 workflow 直接崩掉丢日志
        import traceback

        traceback.print_exc()
        plan.fail(f"内部错误：`{type(exc).__name__}: {exc}`\n\n请检查 Actions 日志。")

    comment_file = ""
    if plan.comment:
        tmpdir = os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()
        comment_file = os.path.join(tmpdir, "comment.md")
        with open(comment_file, "w", encoding="utf-8") as fh:
            fh.write(plan.comment + "\n")

    emit_outputs(
        {
            "changed": "true" if plan.changed else "false",
            "should_deploy": "true" if plan.should_deploy else "false",
            "comment_file": comment_file,
            "status": plan.status,
            "action": plan.action,
            "slug": plan.slug or "",
        }
    )
    emit_summary(
        f"### {plan.action} · {plan.status}\n\n{plan.message or '（无变化）'}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
