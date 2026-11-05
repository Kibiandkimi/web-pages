#!/usr/bin/env python3
"""把 ``sites/`` + ``.meta/`` 构建成 ``_site/``（可直接部署到 GitHub Pages 的静态产物）。

用法：
    python3 scripts/build_site.py            # 构建
    python3 scripts/build_site.py --serve    # 构建并在 http://127.0.0.1:8000 预览
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sitekit as sk  # noqa: E402

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
OUT_DIR = os.path.join(sk.ROOT, "_site")
IGNORE_NAMES = {".git", ".github", "__pycache__", ".DS_Store"}


def read_template(name: str) -> str:
    with open(os.path.join(TEMPLATE_DIR, name), encoding="utf-8") as fh:
        return fh.read()


def fill(template: str, mapping: dict) -> str:
    for key, value in mapping.items():
        template = template.replace("{{" + key + "}}", str(value))
    return template


def human_date(value: str | None) -> str:
    if not value:
        return "—"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
    return m.group(0) if m else value


def dir_size(path: str) -> int:
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass
    return total


def has_index(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "index.html"))


def render_cards(sites: list[dict]) -> str:
    if not sites:
        return ""
    out: list[str] = []
    for site in sites:
        slug = site["slug"]
        title = sk.escape(site.get("title") or slug)
        desc = sk.escape(site.get("description") or "")
        tags = site.get("tags") or []
        tag_html = ""
        if tags:
            tag_html = '<div class="tags">' + "".join(
                f'<span class="tag">{sk.escape(t)}</span>' for t in tags
            ) + "</div>"
        search = " ".join([slug, site.get("title") or "", site.get("description") or "", *tags])
        out.append(
            f'    <a class="card" href="{sk.escape(slug)}/" '
            f'data-search="{sk.escape(search)}">\n'
            f'      <h2>{title}</h2>\n'
            + (f'      <p>{desc}</p>\n' if desc else "")
            + (f"      {tag_html}\n" if tag_html else "")
            + '      <div class="foot">'
            f'<span class="slug">{sk.escape(slug)}</span>'
            f'<span>{human_date(site.get("updated_at"))}</span></div>\n'
            "    </a>"
        )
    return "\n".join(out)


def collect_sites() -> tuple[list[dict], list[str], list[str]]:
    """返回 (可发布站点列表, 下线站点, 警告)。"""
    metas = {str(m["slug"]): m for m in sk.all_meta()}
    published: list[dict] = []
    offline: list[str] = []
    warnings: list[str] = []

    if os.path.isdir(sk.SITES_DIR):
        for name in sorted(os.listdir(sk.SITES_DIR)):
            path = os.path.join(sk.SITES_DIR, name)
            if not os.path.isdir(path) or name.startswith("."):
                continue
            if not has_index(path):
                warnings.append(f"`sites/{name}/` 没有 index.html，已跳过")
                continue
            meta = metas.pop(name, None)
            if meta is None:
                # 手动放进来的目录：用目录名兜底
                meta = {
                    "slug": name,
                    "title": name,
                    "description": "",
                    "tags": [],
                    "updated_at": None,
                    "status": "active",
                }
                warnings.append(f"`sites/{name}/` 没有对应元数据，已按目录名发布")
            if meta.get("status") == "offline":
                offline.append(name)
                continue
            meta.setdefault("title", name)
            meta.setdefault("tags", [])
            published.append(meta)

    for slug in metas:
        warnings.append(f"`.meta/{slug}.json` 没有对应的站点目录，已忽略")

    published.sort(key=lambda m: (m.get("updated_at") or "", m["slug"]), reverse=True)
    return published, offline, warnings


def build() -> int:
    cfg = sk.load_config()
    base = (os.environ.get("PAGES_BASE_PATH") or sk.pages_base_path() or "").rstrip("/")
    if base and not base.startswith("/"):
        base = "/" + base

    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR, exist_ok=True)

    published, offline, warnings = collect_sites()

    for site in published:
        slug = site["slug"]
        src = os.path.join(sk.SITES_DIR, slug)
        dst = os.path.join(OUT_DIR, slug)
        shutil.copytree(
            src,
            dst,
            ignore=shutil.ignore_patterns(*IGNORE_NAMES),
            dirs_exist_ok=True,
        )

    generated_at = sk.now_iso()
    cards = render_cards(published)
    gallery = fill(
        read_template("index.html"),
        {
            "TITLE": sk.escape(cfg.get("title", "网页托管站")),
            "DESCRIPTION": sk.escape(cfg.get("description", "")),
            "COUNT": len(published),
            "GENERATED_AT": generated_at,
            "CARDS": cards,
        },
    )
    sk.atomic_write(os.path.join(OUT_DIR, "index.html"), gallery)

    not_found = fill(read_template("404.html"), {"BASE": base})
    sk.atomic_write(os.path.join(OUT_DIR, "404.html"), not_found)

    manifest = {
        "generated_at": generated_at,
        "count": len(published),
        "sites": [
            {
                "slug": s["slug"],
                "title": s.get("title"),
                "description": s.get("description") or "",
                "tags": s.get("tags") or [],
                "updated_at": s.get("updated_at"),
                "url": f"{base}/{s['slug']}/",
            }
            for s in published
        ],
    }
    sk.atomic_write(
        os.path.join(OUT_DIR, "manifest.json"),
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    )

    # 万一以后切成「分支部署」，也避免 Jekyll 吃掉下划线开头的文件
    sk.atomic_write(os.path.join(OUT_DIR, ".nojekyll"), "")

    print(f"构建完成：{len(published)} 个站点 → {OUT_DIR}")
    if offline:
        print(f"  下线中：{', '.join(offline)}")
    for warning in warnings:
        print(f"  [warn] {warning}")
    for site in published:
        size = dir_size(os.path.join(OUT_DIR, site["slug"]))
        print(f"  - {site['slug']:<28} {size / 1024:>8.1f} KiB")
    return 0


def serve(port: int = 8000) -> None:
    import functools
    import http.server
    import socketserver

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=OUT_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print(f"预览：http://127.0.0.1:{port}/  （Ctrl+C 退出）")
        httpd.serve_forever()


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        serve()
