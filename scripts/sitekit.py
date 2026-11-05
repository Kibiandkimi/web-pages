#!/usr/bin/env python3
"""sitekit —— web-pages 仓库的共享工具库（纯标准库，无第三方依赖）。

职责：
  * slug 规范化
  * issue 正文解析（GitHub issue form 的 ``### 标题`` 分节 + 围栏代码块）
  * 内容落盘（内联 HTML / 远程 URL / zip 压缩包）
  * 元数据读写（``.meta/<slug>.json``）
  * 安全的 zip 解包与下载
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import html as _htmlmod
import ipaddress
import json
import os
import re
import shutil
import socket
import tempfile
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile

# --------------------------------------------------------------------------- #
# 路径常量
# --------------------------------------------------------------------------- #


def _repo_root() -> str:
    env = os.environ.get("SITEKIT_ROOT")
    if env:
        return os.path.abspath(env)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ROOT = _repo_root()
SITES_DIR = os.path.join(ROOT, "sites")
META_DIR = os.path.join(ROOT, ".meta")
CONFIG_PATH = os.path.join(ROOT, "site.json")

# 限制，防止误传超大内容拖垮 runner / Pages
MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024  # 单次下载上限 30 MiB
MAX_SITE_BYTES = 80 * 1024 * 1024  # 解包后单站上限 80 MiB
MAX_FILES = 2000  # 单站文件数上限
MAX_SLUG_LEN = 64

DEFAULT_CONFIG = {
    "title": "网页托管站",
    "description": "用 issue 提交、自动部署到 GitHub Pages 的小网页合集。",
    "base_path": "",
}


class SiteError(Exception):
    """可预期的用户错误（会以友好文案回评到 issue）。"""


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #


def now_iso() -> str:
    return (
        _dt.datetime.now(_dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            cfg.update({k: v for k, v in data.items() if v is not None})
    except (OSError, ValueError):
        pass
    return cfg


def atomic_write(path: str, data: str | bytes, mode: str = "w") -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    if "b" in mode:
        with open(tmp, "wb") as fh:
            fh.write(data)  # type: ignore[arg-type]
    else:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(data)  # type: ignore[arg-type]
    os.replace(tmp, path)


def _truncate(text: str, limit: int = 120) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --------------------------------------------------------------------------- #
# slug
# --------------------------------------------------------------------------- #

_SLUG_BAD = re.compile(r"[^a-z0-9._-]+")
_SLUG_DASHES = re.compile(r"[-_.]{2,}")


def normalize_slug(raw: str | None) -> str:
    """把任意文本压成可安全用作目录名 / URL 片段的 slug。"""
    s = (raw or "").strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = _SLUG_BAD.sub("-", s)
    s = _SLUG_DASHES.sub("-", s)
    s = s.strip("-._")
    if len(s) > MAX_SLUG_LEN:
        s = s[:MAX_SLUG_LEN].rstrip("-._")
    return s


def slug_from_title(title: str, issue_number: int | None = None) -> str:
    """标题里没有 ASCII 可读字符时（比如纯中文）退回 ``p<issue 号>``。"""
    s = normalize_slug(title)
    if s:
        return s
    return f"p{issue_number}" if issue_number else "site"


# --------------------------------------------------------------------------- #
# Markdown / issue form 解析
# --------------------------------------------------------------------------- #

_HEADING_RE = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$")
_FENCE_OPEN_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$")

# issue form 里的小标题 -> 字段名（比较前会去掉括号补充、空格、冒号并转小写）
FIELD_ALIASES: dict[str, str] = {}
for _field, _names in {
    "slug": ["slug", "标识", "页面标识", "url标识", "路径", "path", "页面路径", "链接标识"],
    "title": ["标题", "页面标题", "title", "名称", "页面名称"],
    "description": ["说明", "描述", "简介", "description", "介绍", "一句话说明"],
    "tags": ["标签", "tags", "tag", "分类"],
    "html": ["html代码", "代码", "html", "内容", "html内容", "内联html", "源码", "html源码"],
    "zip": ["zip附件", "附件", "压缩包", "ziplink", "zip链接", "zip", "附件链接", "压缩包链接"],
    "remote": ["远程网址", "远程url", "网址", "url", "链接", "远程地址", "远程链接"],
}.items():
    for _name in _names:
        FIELD_ALIASES[_name] = _field


def _norm_heading(heading: str) -> str:
    h = re.sub(r"[（(][^）)]*[）)]", "", heading)
    h = h.replace("：", "").replace(":", "")
    h = re.sub(r"\s+", "", h)
    return h.strip().lower()


def mask_fences(body: str) -> tuple[str, list[tuple[str, str]]]:
    """把围栏代码块抽出来换成占位符，避免代码里的 ``### `` 干扰分节。"""
    lines = (body or "").split("\n")
    out: list[str] = []
    blocks: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        m = _FENCE_OPEN_RE.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        fence, info = m.group(1), m.group(2)
        closing = re.compile(r"^[ \t]{0,3}" + re.escape(fence[0]) + r"{" + str(len(fence)) + r",}[ \t]*$")
        buf: list[str] = []
        j = i + 1
        while j < len(lines) and not closing.match(lines[j]):
            buf.append(lines[j])
            j += 1
        out.append(f"@@FENCE{len(blocks)}@@")
        blocks.append((info.lower(), "\n".join(buf)))
        i = j + 1
    return "\n".join(out), blocks


def split_sections(body: str) -> list[tuple[str, str]]:
    """按 markdown 标题切段，返回 ``[(原始标题, 正文)]``，首段标题为空串。"""
    masked, _blocks = mask_fences(body)
    sections: list[tuple[str, str]] = []
    heading = ""
    buf: list[str] = []
    for line in masked.split("\n"):
        m = _HEADING_RE.match(line)
        if m:
            sections.append((heading, "\n".join(buf)))
            heading = m.group(2)
            buf = []
        else:
            buf.append(line)
    sections.append((heading, "\n".join(buf)))
    return sections


def _restore_fences(value: str, blocks: list[tuple[str, str]]) -> str:
    """把段落里的 ``@@FENCEn@@`` 占位符换回原代码块内容。"""
    stripped = value.strip()
    m = re.fullmatch(r"@@FENCE(\d+)@@", stripped)
    if m:
        idx = int(m.group(1))
        if 0 <= idx < len(blocks):
            return blocks[idx][1]
        return ""
    return re.sub(
        r"@@FENCE(\d+)@@",
        lambda mm: blocks[int(mm.group(1))][1] if int(mm.group(1)) < len(blocks) else "",
        value,
    )


def strip_outer_fence(text: str) -> str:
    """如果整段内容被一对围栏包着，剥掉围栏。"""
    t = (text or "").strip("\n")
    m = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n(.*?)\n?[ \t]{0,3}\1[ \t]*$", t, re.S)
    return m.group(2) if m else t


HTML_HINT_RE = re.compile(
    r"<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>]|div[\s>]|main[\s>]|section[\s>]|"
    r"h[1-6][\s>]|p[\s>]|script[\s>]|style[\s>]|svg[\s>])",
    re.I,
)
URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]{}]+", re.I)

# issue form 空字段的占位符。GitHub 实际输出的是 ``_No response_``（带下划线），
# 不清掉的话会被当成 slug / 标题 / 标签的真实内容。
_PLACEHOLDER_RE = re.compile(
    r"^[ \t]*(?:_No response_|No response|_无_|无内容|无)[ \t]*$", re.M
)


def looks_like_html(text: str) -> bool:
    return bool(text and HTML_HINT_RE.search(text))


def find_urls(text: str) -> list[str]:
    out: list[str] = []
    for raw in URL_RE.findall(text or ""):
        url = raw.rstrip(".,;:!?，。；：、）)]}>'\"")
        if url and url not in out:
            out.append(url)
    return out


def _clean_text(value: str) -> str:
    """去掉占位符残留、首尾空白和多余空行。"""
    v = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    v = _PLACEHOLDER_RE.sub("", v)
    return v.strip()


def parse_issue(body: str, title: str = "", number: int | None = None) -> dict:
    """把 issue 正文解析成建站所需的结构。"""
    body = body or ""
    masked, blocks = mask_fences(body)
    fields: dict[str, str] = {}
    for heading, content in split_sections(body):
        key = FIELD_ALIASES.get(_norm_heading(heading))
        if key and key not in fields:
            fields[key] = _restore_fences(content, blocks)

    result: dict = {
        "slug": None,
        "title": None,
        "description": "",
        "tags": [],
        "html": None,
        "url": None,
        "mode": None,
        "warnings": [],
        "errors": [],
    }

    raw_slug = _clean_text(fields.get("slug", ""))
    if raw_slug:
        # 允许用户直接写 URL 或带斜杠
        raw_slug = raw_slug.strip("/").rsplit("/", 1)[-1]
        result["slug"] = normalize_slug(raw_slug)
        if not result["slug"]:
            result["warnings"].append(f"标识 `{raw_slug}` 不含可用字符，已自动改用其它标识。")

    raw_title = _clean_text(fields.get("title", ""))
    result["title"] = _truncate(raw_title or (title or ""), 80) or "未命名页面"

    result["description"] = _truncate(_clean_text(fields.get("description", "")), 200)

    tags_raw = _clean_text(fields.get("tags", ""))
    tags: list[str] = []
    for part in re.split(r"[,，、;；\s]+", tags_raw):
        part = _truncate(part, 24)
        if part and part not in tags:
            tags.append(part)
    result["tags"] = tags[:8]

    # ---- 内容来源 -------------------------------------------------------- #
    html_value = _clean_text(fields.get("html", ""))
    if html_value:
        html_value = strip_outer_fence(html_value)
    if not html_value:
        for info, block in blocks:
            if info in ("html", "htm", "xhtml", "") and looks_like_html(block):
                html_value = block
                break
    if not html_value and looks_like_html(body):
        html_value = strip_outer_fence(body)

    zip_url = None
    for url in find_urls(fields.get("zip", "")):
        zip_url = url
        break
    remote_url = None
    for url in find_urls(fields.get("remote", "")):
        remote_url = url
        break
    # 正文里直接贴了压缩包链接也算数（仅在没提供其它内容时兜底，
    # 免得内联 HTML 里出现的 .zip 链接把整页误判成压缩包）
    if not zip_url and not remote_url and not html_value:
        for url in find_urls(body):
            if urllib.parse.urlsplit(url).path.lower().endswith(".zip"):
                zip_url = url
                break

    if zip_url:
        result["url"] = zip_url
        result["mode"] = "zip"
    elif remote_url:
        result["url"] = remote_url
        result["mode"] = "url"
    elif html_value:
        result["html"] = html_value if html_value.endswith("\n") else html_value + "\n"
        result["mode"] = "inline"
    else:
        result["errors"].append(
            "没有找到任何页面内容。请在 issue 里填写 **HTML 代码**、"
            "**压缩包链接** 或 **远程网址** 中的任意一项。"
        )

    return result


# --------------------------------------------------------------------------- #
# 下载
# --------------------------------------------------------------------------- #


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """每次跳转都重新校验目标地址，并禁止 https → http 降级。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        old = urllib.parse.urlsplit(req.full_url)
        new_parts = urllib.parse.urlsplit(newurl)
        if old.scheme == "https" and new_parts.scheme != "https":
            raise SiteError(f"拒绝 https → {new_parts.scheme} 的重定向：`{newurl}`")
        # 关键：重定向目标也要过一遍内网校验，否则 302 就能绕过 SSRF 防护
        _assert_public_host(newurl)

        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            if (old.scheme, old.netloc) != (new_parts.scheme, new_parts.netloc):
                for key in list(new.headers):
                    if key.lower() == "authorization":
                        del new.headers[key]
                for key in list(new.unredirected_hdrs):
                    if key.lower() == "authorization":
                        del new.unredirected_hdrs[key]
        return new


def _assert_public_host(url: str) -> None:
    if os.environ.get("SITEKIT_ALLOW_PRIVATE") == "1":
        return
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise SiteError(f"只支持 http/https 链接，收到：`{url}`")
    host = (parts.hostname or "").lower()
    if not host:
        raise SiteError(f"网址不合法：`{url}`")
    if host in ("localhost", "localhost.localdomain") or host.endswith(".localhost"):
        raise SiteError(f"不允许下载本机地址：`{url}`")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        # 解析不了就别放行：宁可报错，也不要绕过内网校验
        raise SiteError(f"无法解析域名 `{host}`：{exc}") from exc
    for info in infos:
        try:
            ip = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        except ValueError:
            raise SiteError(f"无法识别 `{host}` 解析出的地址，已拒绝：`{url}`")
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise SiteError(f"不允许下载内网地址（{ip}）：`{url}`")


def fetch_url(url: str, dest_path: str, max_bytes: int = MAX_DOWNLOAD_BYTES) -> str:
    """下载 url 到 dest_path，返回 Content-Type（可能为空串）。"""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise SiteError(f"只支持 http/https 链接，收到：`{url}`")
    _assert_public_host(url)

    headers = {
        "User-Agent": "web-pages-deploy/1.0 (+https://github.com)",
        "Accept": "*/*",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and parts.hostname in ("github.com", "api.github.com", "raw.githubusercontent.com"):
        headers["Authorization"] = f"Bearer {token}"

    opener = urllib.request.build_opener(_SafeRedirectHandler())
    req = urllib.request.Request(url, headers=headers)
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    try:
        with opener.open(req, timeout=60) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            total = 0
            with open(dest_path, "wb") as fh:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise SiteError(
                            f"下载内容超过上限（{max_bytes // 1024 // 1024} MiB）：`{url}`"
                        )
                    fh.write(chunk)
    except urllib.error.HTTPError as exc:
        raise SiteError(f"下载失败（HTTP {exc.code}）：`{url}`") from exc
    except urllib.error.URLError as exc:
        raise SiteError(f"下载失败（{exc.reason}）：`{url}`") from exc
    return ctype


# --------------------------------------------------------------------------- #
# zip 解包
# --------------------------------------------------------------------------- #

_JUNK_PREFIXES = ("__MACOSX/",)
_JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def _safe_rel_path(name: str) -> str | None:
    n = (name or "").replace("\\", "/")
    if n.startswith("/") or re.match(r"^[A-Za-z]:", n):
        raise SiteError(f"压缩包内含绝对路径，已拒绝：`{name}`")
    parts = [p for p in n.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise SiteError(f"压缩包内含 `..` 路径穿越，已拒绝：`{name}`")
    if not parts:
        return None
    return "/".join(parts)


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return ((info.external_attr >> 16) & 0o170000) == 0o120000


def safe_extract_zip(zip_path: str, dest_dir: str, skipped: list[str] | None = None) -> list[str]:
    """安全解包，自动去掉统一的顶层目录。返回写入的相对路径列表。

    以 ``.`` 开头的文件 / 目录一律跳过（``.env``、``.git/``、``.github/`` 之类），
    被跳过的名字会追加到 ``skipped`` 里，方便回评提示用户。
    """
    written: list[str] = []
    total = 0
    os.makedirs(dest_dir, exist_ok=True)
    dest_root = os.path.realpath(dest_dir)

    with zipfile.ZipFile(zip_path) as zf:
        infos: list[tuple[zipfile.ZipInfo, str]] = []
        for info in zf.infolist():
            if info.is_dir() or _is_symlink(info):
                continue
            rel = _safe_rel_path(info.filename)
            if rel is None:
                continue
            if rel.startswith(_JUNK_PREFIXES) or os.path.basename(rel) in _JUNK_NAMES:
                continue
            if any(part.startswith(".") for part in rel.split("/")):
                if skipped is not None and rel not in skipped:
                    skipped.append(rel)
                continue
            infos.append((info, rel))

        if not infos:
            raise SiteError("压缩包是空的。")
        if len(infos) > MAX_FILES:
            raise SiteError(f"压缩包文件数 {len(infos)} 超过上限 {MAX_FILES}。")

        # 如果所有文件都在同一个顶层目录下，剥掉它
        tops = {rel.split("/", 1)[0] for _i, rel in infos}
        strip_prefix = ""
        if len(tops) == 1:
            top = next(iter(tops))
            if all(rel.startswith(top + "/") for _i, rel in infos):
                strip_prefix = top + "/"

        for info, rel in infos:
            target_rel = rel[len(strip_prefix):] if strip_prefix else rel
            if not target_rel:
                continue
            total += info.file_size
            if total > MAX_SITE_BYTES:
                raise SiteError(f"解包后体积超过上限（{MAX_SITE_BYTES // 1024 // 1024} MiB）。")
            out_path = os.path.realpath(os.path.join(dest_root, target_rel))
            if not (out_path == dest_root or out_path.startswith(dest_root + os.sep)):
                raise SiteError(f"压缩包内路径越界，已拒绝：`{info.filename}`")
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with zf.open(info) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst, length=256 * 1024)
            written.append(target_rel)

    return written


def _zip_looks_valid(path: str) -> bool:
    try:
        with open(path, "rb") as fh:
            return fh.read(4)[:2] == b"PK"
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# 内容落盘
# --------------------------------------------------------------------------- #

FALLBACK_PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
  :root{{color-scheme:light dark}}
  body{{margin:0;min-height:100vh;display:grid;place-items:center;
       font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
       background:#0d1117;color:#e6edf3;padding:24px}}
  .box{{max-width:560px}}
  h1{{font-size:1.35rem;margin:0 0 .6rem}}
  p{{color:#9da7b3;margin:.4rem 0}}
  a{{color:#6ea8fe}}
</style>
</head>
<body><div class="box">
<h1>{title}</h1>
<p>这个页面还没有内容。请编辑对应 issue 补充 HTML、压缩包或远程网址，然后评论 <code>/redeploy</code>。</p>
</div></body>
</html>
"""


def materialize(site_dir: str, parsed: dict) -> list[str]:
    """把解析结果写成站点文件，返回相对文件列表。

    先写到同级临时目录，成功后再整体替换，避免下载失败时把旧站点弄坏。
    """
    parent = os.path.dirname(os.path.abspath(site_dir))
    os.makedirs(parent, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(prefix=".build-", dir=parent)
    try:
        mode = parsed.get("mode")
        if mode == "inline":
            atomic_write(os.path.join(tmp_dir, "index.html"), parsed["html"])
        elif mode in ("zip", "url"):
            url = parsed["url"]
            download = os.path.join(tmp_dir, ".download.bin")
            ctype = fetch_url(url, download)
            if _zip_looks_valid(download) or url.split("?")[0].lower().endswith(".zip"):
                extract_dir = os.path.join(tmp_dir, ".extracted")
                os.makedirs(extract_dir, exist_ok=True)
                skipped: list[str] = []
                safe_extract_zip(download, extract_dir, skipped=skipped)
                if skipped:
                    preview = "、".join(f"`{s}`" for s in skipped[:5])
                    more = f" 等 {len(skipped)} 个" if len(skipped) > 5 else ""
                    parsed.setdefault("warnings", []).append(
                        f"已忽略压缩包里以点开头的文件：{preview}{more}"
                        "（GitHub Pages 上这些文件本来也会被公开，出于安全默认丢弃）"
                    )
                os.remove(download)
                for name in os.listdir(extract_dir):
                    shutil.move(os.path.join(extract_dir, name), os.path.join(tmp_dir, name))
                shutil.rmtree(extract_dir, ignore_errors=True)
            else:
                with open(download, "rb") as fh:
                    head = fh.read(4096)
                if looks_like_html(head.decode("utf-8", "replace")):
                    os.replace(download, os.path.join(tmp_dir, "index.html"))
                else:
                    raise SiteError(
                        f"链接内容既不是 HTML 也不是 zip（Content-Type: `{ctype or '未知'}`）：`{url}`"
                    )
        else:
            raise SiteError("没有可部署的内容。")

        files = collect_files(tmp_dir)
        if not any(os.path.basename(f) == "index.html" for f in files):
            # 没有 index.html 就补一个跳转页
            first_html = next((f for f in files if f.lower().endswith(".html")), None)
            if first_html:
                atomic_write(
                    os.path.join(tmp_dir, "index.html"),
                    '<!doctype html><meta charset="utf-8">'
                    f'<meta http-equiv="refresh" content="0;url={urllib.parse.quote(first_html)}">'
                    f'<a href="{urllib.parse.quote(first_html)}">打开页面</a>\n',
                )
                files = collect_files(tmp_dir)
            else:
                raise SiteError(
                    "压缩包里没有 `index.html`，也没有任何 `.html` 文件。"
                    "请把入口页命名为 `index.html`。"
                )

        # 原子替换
        if os.path.isdir(site_dir):
            shutil.rmtree(site_dir)
        shutil.move(tmp_dir, site_dir)
        return files
    finally:
        if os.path.isdir(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)


def collect_files(root: str) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            out.append(rel.replace(os.sep, "/"))
    return out


def dir_digest(path: str) -> str:
    """目录内容摘要，用来判断一次「重新部署」是不是真的有变化。"""
    if not os.path.isdir(path):
        return ""
    digest = hashlib.sha256()
    for rel in collect_files(path):
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        with open(os.path.join(path, rel), "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


# --------------------------------------------------------------------------- #
# 元数据
# --------------------------------------------------------------------------- #


def meta_path(slug: str) -> str:
    return os.path.join(META_DIR, f"{slug}.json")


def load_meta(slug: str) -> dict | None:
    try:
        with open(meta_path(slug), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save_meta(meta: dict) -> None:
    atomic_write(
        meta_path(meta["slug"]),
        json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def all_meta() -> list[dict]:
    out: list[dict] = []
    if not os.path.isdir(META_DIR):
        return out
    for name in sorted(os.listdir(META_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(META_DIR, name), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("slug"):
            out.append(data)
    return out


def delete_site(slug: str) -> bool:
    removed = False
    site_dir = os.path.join(SITES_DIR, slug)
    if os.path.isdir(site_dir):
        shutil.rmtree(site_dir)
        removed = True
    if os.path.exists(meta_path(slug)):
        os.remove(meta_path(slug))
        removed = True
    return removed


# --------------------------------------------------------------------------- #
# 线上地址
# --------------------------------------------------------------------------- #


def pages_base_url() -> str:
    """根据 GITHUB_REPOSITORY 推导 Pages 根地址。"""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        if name.lower() == f"{owner.lower()}.github.io":
            return f"https://{owner.lower()}.github.io"
        return f"https://{owner.lower()}.github.io/{name}"
    cfg = load_config()
    return (cfg.get("site_url") or "").rstrip("/")


def site_url(slug: str) -> str:
    base = pages_base_url()
    return f"{base}/{slug}/" if base else f"/{slug}/"


def pages_base_path() -> str:
    """Pages 站点在域名下的挂载路径：项目站点是 ``/<repo>``，用户站点是 ``""``。"""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        if name.lower() == f"{owner.lower()}.github.io":
            return ""
        return "/" + name
    return (load_config().get("base_path") or "").rstrip("/")


def escape(text: str) -> str:
    return _htmlmod.escape(text or "", quote=True)
