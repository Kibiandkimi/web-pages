#!/usr/bin/env python3
"""本地测试：单元测试 + 端到端流程模拟。

    python3 -m unittest discover -s tests -v
    # 或
    python3 tests/test_all.py
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import sitekit as sk  # noqa: E402


# --------------------------------------------------------------------------- #
# 工具
# --------------------------------------------------------------------------- #


def make_repo(tmp: Path) -> Path:
    """在 tmp 下造一个最小仓库副本。"""
    root = tmp / "repo"
    shutil.copytree(REPO / "scripts", root / "scripts")
    (root / "sites").mkdir()
    (root / "site.json").write_text(
        json.dumps({"title": "测试站", "description": "desc", "base_path": "/web-pages"}),
        encoding="utf-8",
    )
    return root


def run_script(root: Path, script: str, args: list[str] | None = None,
               event: dict | None = None, event_name: str | None = None) -> dict:
    """跑 scripts/<script>，返回解析后的 outputs 字典 + stdout/stderr。"""
    tmp = root.parent
    out_file = tmp / f"out-{script}.txt"
    if out_file.exists():
        out_file.unlink()

    env = os.environ.copy()
    env["SITEKIT_ROOT"] = str(root)
    env["GITHUB_OUTPUT"] = str(out_file)
    env["GITHUB_REPOSITORY"] = "kibiandkimi/web-pages"
    env.pop("GITHUB_EVENT_PATH", None)
    env.pop("GITHUB_STEP_SUMMARY", None)
    env.pop("RUNNER_TEMP", None)

    cmd = [sys.executable, str(root / "scripts" / script)] + (args or [])
    if event is not None:
        event_file = tmp / "event.json"
        event_file.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
        cmd += ["--event", str(event_file)]
    if event_name:
        cmd += ["--event-name", event_name]

    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(root))
    outputs = {}
    if out_file.exists():
        for line in out_file.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                outputs[k.strip()] = v.strip()
    return {"outputs": outputs, "stdout": proc.stdout, "stderr": proc.stderr, "code": proc.returncode}


def issue_event(action: str, number: int = 1, title: str = "我的页面", body: str = "",
                labels: list[str] | None = None, user: str = "kibiandkimi") -> dict:
    labels = labels or []
    event = {
        "action": action,
        "issue": {
            "number": number,
            "title": title,
            "body": body,
            "user": {"login": user},
            "labels": [{"name": name} for name in labels],
        },
    }
    if action in ("labeled", "unlabeled"):
        event["label"] = {"name": labels[0] if labels else ""}
    return event


def comment_event(number: int, body: str, issue_body: str = "",
                  user: str = "kibiandkimi", assoc: str = "OWNER",
                  issue_user: str = "kibiandkimi") -> dict:
    return {
        "issue": {
            "number": number,
            "title": "t",
            "body": issue_body,
            "user": {"login": issue_user},
            "labels": [],
        },
        "comment": {
            "body": body,
            "user": {"login": user},
            "author_association": assoc,
        },
    }


FORM_BODY = """### 页面标识（可选）

my-demo

### 页面标题

我的第一个页面

### 一句话说明（可选）

演示用的小页面

### 标签（可选）

工具, 演示

### HTML 代码（方式 A）

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Hi</title></head>
<body>
### 这不是标题，只是代码里的井号
<h1>Hello</h1>
</body>
</html>
```

### 压缩包链接（方式 B）

_No response_

### 远程网址（方式 C）

_No response_

### 确认

- [X] 我确认这些内容可以公开托管
"""

# 可选字段全部留空时，GitHub issue form 渲染出来的是 `_No response_`
FORM_MINIMAL = """### 页面标识（可选）

_No response_

### 页面标题

只有标题和代码

### 一句话说明（可选）

_No response_

### 标签（可选）

_No response_

### HTML 代码（方式 A）

```html
<!doctype html>
<html><body><h1>minimal</h1></body></html>
```

### 压缩包链接（方式 B）

_No response_

### 远程网址（方式 C）

_No response_

### 确认

- [X] 我确认这些内容可以公开托管
"""


# --------------------------------------------------------------------------- #
# 单元测试
# --------------------------------------------------------------------------- #


class TestSlug(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(sk.normalize_slug("My Demo Page"), "my-demo-page")
        self.assertEqual(sk.normalize_slug("  Hello__World!! "), "hello-world")
        self.assertEqual(sk.normalize_slug("../../etc/passwd"), "etc-passwd")
        self.assertEqual(sk.normalize_slug(".hidden"), "hidden")

    def test_non_ascii_falls_back(self):
        self.assertEqual(sk.normalize_slug("我的页面"), "")
        self.assertEqual(sk.slug_from_title("我的页面", 7), "p7")
        self.assertEqual(sk.slug_from_title("Hello World", 7), "hello-world")

    def test_length_cap(self):
        slug = sk.normalize_slug("a" * 200)
        self.assertEqual(len(slug), sk.MAX_SLUG_LEN)


class TestParsing(unittest.TestCase):
    def test_form_body(self):
        p = sk.parse_issue(FORM_BODY, "我的页面", 1)
        self.assertEqual(p["slug"], "my-demo")
        self.assertEqual(p["title"], "我的第一个页面")
        self.assertEqual(p["description"], "演示用的小页面")
        self.assertEqual(p["tags"], ["工具", "演示"])
        self.assertEqual(p["mode"], "inline")
        self.assertIn("Hello", p["html"])
        self.assertIn("### 这不是标题", p["html"], "围栏内的井号不应破坏解析")
        self.assertEqual(p["errors"], [])

    def test_raw_html_paste(self):
        body = "### HTML 代码\n\n<!doctype html>\n<html><body><h1>x</h1></body></html>\n"
        p = sk.parse_issue(body, "raw", 2)
        self.assertEqual(p["mode"], "inline")
        self.assertIn("<h1>x</h1>", p["html"])

    def test_bare_fence_only(self):
        body = "```html\n<!doctype html><p>hi</p>\n```\n"
        p = sk.parse_issue(body, "fence", 3)
        self.assertEqual(p["mode"], "inline")
        self.assertIn("<p>hi</p>", p["html"])

    def test_zip_field(self):
        body = "### 压缩包链接（方式 B）\n\n[site.zip](https://example.com/a/site.zip)\n"
        p = sk.parse_issue(body, "z", 4)
        self.assertEqual(p["mode"], "zip")
        self.assertEqual(p["url"], "https://example.com/a/site.zip")

    def test_no_response_placeholder_is_cleaned(self):
        """GitHub issue form 空字段输出 `_No response_`，不能被当成真实内容。"""
        p = sk.parse_issue(FORM_MINIMAL, "只有标题和代码", 9)
        self.assertIsNone(p["slug"], "_No response_ 不应变成 slug")
        self.assertEqual(p["description"], "")
        self.assertEqual(p["tags"], [])
        self.assertEqual(p["title"], "只有标题和代码")
        self.assertEqual(p["mode"], "inline")
        self.assertNotIn("_No response_", p["html"] or "")

    def test_two_minimal_issues_do_not_collide(self):
        """两个都留空 slug 的 issue，不能都算出 no-response 然后撞车。"""
        a = sk.parse_issue(FORM_MINIMAL, "标题甲", 1)
        b = sk.parse_issue(FORM_MINIMAL, "标题乙", 2)
        slug_a = a["slug"] or sk.slug_from_title(a["title"], 1)
        slug_b = b["slug"] or sk.slug_from_title(b["title"], 2)
        self.assertNotEqual(slug_a, slug_b)
        self.assertNotEqual(sk.normalize_slug(slug_a), "no-response")

    def test_zip_attachment_without_extension(self):
        body = "### 压缩包链接（方式 B）\n\n[site.zip](https://github.com/user-attachments/assets/abc-123)\n"
        p = sk.parse_issue(body, "z", 4)
        self.assertEqual(p["mode"], "zip")
        self.assertEqual(p["url"], "https://github.com/user-attachments/assets/abc-123")

    def test_remote_url(self):
        body = "### 远程网址（方式 C）\n\nhttps://example.com/page.html\n"
        p = sk.parse_issue(body, "r", 5)
        self.assertEqual(p["mode"], "url")
        self.assertEqual(p["url"], "https://example.com/page.html")

    def test_no_content(self):
        p = sk.parse_issue("### 页面标题\n\n空\n", "t", 6)
        self.assertEqual(p["mode"], None)
        self.assertTrue(p["errors"])

    def test_zip_url_inside_html_is_not_hijacked(self):
        body = (
            "### HTML 代码\n\n```html\n<!doctype html>\n"
            '<a href="https://example.com/files/data.zip">下载</a>\n```\n'
        )
        p = sk.parse_issue(body, "t", 7)
        self.assertEqual(p["mode"], "inline", "内联 HTML 里的 .zip 链接不应被当成压缩包")

    def test_fence_masking(self):
        masked, blocks = sk.mask_fences("a\n```html\n### x\n```\nb\n")
        self.assertEqual(len(blocks), 1)
        self.assertNotIn("### x", masked)
        self.assertIn("@@FENCE0@@", masked)


class TestZip(unittest.TestCase):
    def _zip(self, path: Path, entries: dict[str, bytes]) -> None:
        with zipfile.ZipFile(path, "w") as zf:
            for name, data in entries.items():
                zf.writestr(name, data)

    def test_strip_common_prefix(self):
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "s.zip"
            self._zip(zpath, {"site/index.html": b"<h1>hi</h1>", "site/a.css": b"body{}"})
            out = Path(td) / "out"
            written = sk.safe_extract_zip(str(zpath), str(out))
            self.assertEqual(sorted(written), ["a.css", "index.html"])
            self.assertTrue((out / "index.html").is_file())

    def test_reject_traversal(self):
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "s.zip"
            self._zip(zpath, {"../evil.html": b"x"})
            with self.assertRaises(sk.SiteError):
                sk.safe_extract_zip(str(zpath), str(Path(td) / "out"))

    def test_reject_absolute(self):
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "s.zip"
            self._zip(zpath, {"/etc/passwd": b"x"})
            with self.assertRaises(sk.SiteError):
                sk.safe_extract_zip(str(zpath), str(Path(td) / "out"))

    def test_skip_junk(self):
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "s.zip"
            self._zip(zpath, {"index.html": b"x", "__MACOSX/._index.html": b"y",
                              ".DS_Store": b"z"})
            out = Path(td) / "out"
            written = sk.safe_extract_zip(str(zpath), str(out))
            self.assertEqual(written, ["index.html"])

    def test_skip_dotfiles_and_dotdirs(self):
        """.env / .git/ / .github/ 之类必须丢弃，否则会被公开托管。"""
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "s.zip"
            self._zip(zpath, {
                "index.html": b"x",
                ".env": b"SECRET=1",
                ".git/config": b"[core]",
                ".github/workflows/evil.yml": b"on: push",
                "assets/logo.png": b"\x89PNG",
            })
            out = Path(td) / "out"
            skipped: list[str] = []
            written = sk.safe_extract_zip(str(zpath), str(out), skipped=skipped)
            self.assertEqual(sorted(written), ["assets/logo.png", "index.html"])
            self.assertIn(".env", skipped)
            self.assertFalse((out / ".env").exists())
            self.assertFalse((out / ".git").exists())
            self.assertFalse((out / ".github").exists())


class TestUrlGuard(unittest.TestCase):
    def test_rejects_private_hosts(self):
        for url in ["http://127.0.0.1/x", "http://localhost/x",
                    "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/x"]:
            with self.assertRaises(sk.SiteError, msg=url):
                sk._assert_public_host(url)

    def test_rejects_bad_scheme(self):
        with self.assertRaises(sk.SiteError):
            sk._assert_public_host("file:///etc/passwd")

    def test_redirect_is_rechecked(self):
        """302 跳到内网也必须被拦（否则 SSRF 防护形同虚设）。"""
        calls: list[str] = []

        def fake_guard(url):
            calls.append(url)
            if "169.254.169.254" in url:
                raise sk.SiteError("内网地址")

        original = sk._assert_public_host
        sk._assert_public_host = fake_guard
        try:
            handler = sk._SafeRedirectHandler()
            req = __import__("urllib.request", fromlist=["Request"]).Request(
                "http://example.com/a"
            )
            with self.assertRaises(sk.SiteError):
                handler.redirect_request(req, None, 302, "Found", {}, "http://169.254.169.254/x")
            self.assertIn("http://169.254.169.254/x", calls)
        finally:
            sk._assert_public_host = original

    def test_redirect_rejects_https_downgrade(self):
        original = sk._assert_public_host
        sk._assert_public_host = lambda url: None
        try:
            handler = sk._SafeRedirectHandler()
            req = __import__("urllib.request", fromlist=["Request"]).Request(
                "https://example.com/a"
            )
            with self.assertRaises(sk.SiteError):
                handler.redirect_request(req, None, 302, "Found", {}, "http://example.com/a")
        finally:
            sk._assert_public_host = original


class TestMaterialize(unittest.TestCase):
    def test_inline(self):
        with tempfile.TemporaryDirectory() as td:
            site = os.path.join(td, "sites", "demo")
            files = sk.materialize(site, {"mode": "inline", "html": "<h1>hi</h1>\n"})
            self.assertEqual(files, ["index.html"])
            with open(os.path.join(site, "index.html"), encoding="utf-8") as fh:
                self.assertIn("<h1>hi</h1>", fh.read())

    def test_replace_clears_old_files(self):
        with tempfile.TemporaryDirectory() as td:
            site = os.path.join(td, "sites", "demo")
            os.makedirs(site)
            Path(site, "old.css").write_text("x")
            sk.materialize(site, {"mode": "inline", "html": "<h1>new</h1>\n"})
            self.assertFalse(os.path.exists(os.path.join(site, "old.css")))

    def test_rejects_non_http(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(sk.SiteError):
                sk.materialize(os.path.join(td, "s", "demo"), {"mode": "url", "url": "file:///etc/passwd"})


class TestMaterializeRemote(unittest.TestCase):
    """用本地 HTTP 服务验证「远程网址 / 压缩包链接」两种模式。"""

    @classmethod
    def setUpClass(cls):
        import functools
        import http.server
        import socketserver
        import threading

        cls.serve_dir = tempfile.mkdtemp()
        with zipfile.ZipFile(os.path.join(cls.serve_dir, "site.zip"), "w") as zf:
            zf.writestr("bundle/index.html", "<h1>from zip</h1>")
            zf.writestr("bundle/style.css", "body{color:red}")
        with zipfile.ZipFile(os.path.join(cls.serve_dir, "noindex.zip"), "w") as zf:
            zf.writestr("page.html", "<h1>single</h1>")
        Path(cls.serve_dir, "page.html").write_text("<!doctype html><h1>remote</h1>", encoding="utf-8")

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=cls.serve_dir)
        socketserver.TCPServer.allow_reuse_address = True
        cls.httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls._old = os.environ.get("SITEKIT_ALLOW_PRIVATE")
        os.environ["SITEKIT_ALLOW_PRIVATE"] = "1"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.serve_dir, ignore_errors=True)
        if cls._old is None:
            os.environ.pop("SITEKIT_ALLOW_PRIVATE", None)
        else:
            os.environ["SITEKIT_ALLOW_PRIVATE"] = cls._old

    def url(self, name):
        return f"http://127.0.0.1:{self.port}/{name}"

    def test_zip_mode(self):
        with tempfile.TemporaryDirectory() as td:
            site = os.path.join(td, "sites", "demo")
            files = sk.materialize(site, {"mode": "zip", "url": self.url("site.zip")})
            self.assertEqual(sorted(files), ["index.html", "style.css"])
            self.assertIn("from zip", Path(site, "index.html").read_text(encoding="utf-8"))

    def test_zip_without_index_gets_fallback(self):
        with tempfile.TemporaryDirectory() as td:
            site = os.path.join(td, "sites", "demo")
            files = sk.materialize(site, {"mode": "url", "url": self.url("noindex.zip")})
            self.assertIn("index.html", files)
            self.assertIn("page.html", Path(site, "index.html").read_text(encoding="utf-8"))

    def test_plain_html_url(self):
        with tempfile.TemporaryDirectory() as td:
            site = os.path.join(td, "sites", "demo")
            files = sk.materialize(site, {"mode": "url", "url": self.url("page.html")})
            self.assertEqual(files, ["index.html"])
            self.assertIn("remote", Path(site, "index.html").read_text(encoding="utf-8"))

    def test_404_raises(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(sk.SiteError):
                sk.materialize(os.path.join(td, "sites", "demo"),
                               {"mode": "url", "url": self.url("nope.html")})



# --------------------------------------------------------------------------- #
# 端到端
# --------------------------------------------------------------------------- #


class TestEndToEnd(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.root = make_repo(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def meta(self, slug):
        path = self.root / ".meta" / f"{slug}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def build(self):
        res = run_script(self.root, "build_site.py")
        self.assertEqual(res["code"], 0, res["stderr"])
        return res

    def test_full_lifecycle(self):
        # 1. 新开 issue 部署
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("opened", 1, "我的页面", FORM_BODY),
                         event_name="issues")
        self.assertEqual(res["code"], 0, res["stderr"])
        out = res["outputs"]
        self.assertEqual(out["changed"], "true")
        self.assertEqual(out["should_deploy"], "true")
        self.assertEqual(out["slug"], "my-demo")
        self.assertTrue((self.root / "sites" / "my-demo" / "index.html").is_file())
        self.assertEqual(self.meta("my-demo")["status"], "active")
        comment = Path(out["comment_file"]).read_text(encoding="utf-8")
        self.assertIn("{{STATUS}}", comment, "状态由 prepare_comment.py 回填")
        self.assertIn("kibiandkimi.github.io/web-pages/my-demo/", comment)

        # 2. 构建
        self.build()
        gallery = (self.root / "_site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("my-demo", gallery)
        self.assertIn("我的第一个页面", gallery)
        self.assertTrue((self.root / "_site" / "my-demo" / "index.html").is_file())
        manifest = json.loads((self.root / "_site" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["count"], 1)

        # 3. 编辑 issue → 更新内容
        updated = FORM_BODY.replace("Hello", "Hello Again")
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("edited", 1, "我的页面", updated),
                         event_name="issues")
        self.assertEqual(res["outputs"]["changed"], "true")
        page = (self.root / "sites" / "my-demo" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Hello Again", page)

        # 4. /offline 下线
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "/offline", updated), event_name="issue_comment")
        self.assertEqual(res["outputs"]["should_deploy"], "true")
        self.assertEqual(self.meta("my-demo")["status"], "offline")
        self.build()
        self.assertFalse((self.root / "_site" / "my-demo").exists())
        gallery = (self.root / "_site" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("my-demo", gallery)

        # 5. /online 恢复
        run_script(self.root, "handle_event.py",
                   event=comment_event(1, "/online", updated), event_name="issue_comment")
        self.build()
        self.assertTrue((self.root / "_site" / "my-demo" / "index.html").is_file())

        # 6. /rename
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "/rename better-name", updated),
                         event_name="issue_comment")
        self.assertEqual(res["outputs"]["slug"], "better-name")
        self.assertTrue((self.root / "sites" / "better-name" / "index.html").is_file())
        self.assertFalse((self.root / "sites" / "my-demo").exists())
        self.assertIsNone(self.meta("my-demo"))
        self.assertEqual(self.meta("better-name")["slug"], "better-name")

        # 7. /delete
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "/delete", updated), event_name="issue_comment")
        self.assertEqual(res["outputs"]["changed"], "true")
        self.assertFalse((self.root / "sites" / "better-name").exists())
        self.assertIsNone(self.meta("better-name"))

    def test_plain_comment_does_nothing(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "看起来不错 👍"), event_name="issue_comment")
        self.assertEqual(res["outputs"]["should_deploy"], "false")
        self.assertEqual(res["outputs"]["comment_file"], "")

    def test_unauthorized_comment(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "/delete", FORM_BODY,
                                             user="stranger", assoc="NONE"),
                         event_name="issue_comment")
        self.assertEqual(res["outputs"]["changed"], "false")
        comment = Path(res["outputs"]["comment_file"]).read_text(encoding="utf-8")
        self.assertIn("只有 issue 作者", comment)
        self.assertTrue((self.root / "sites" / "my-demo").exists())

    def test_label_actions(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("labeled", 1, "t", FORM_BODY, labels=["offline"]),
                         event_name="issues")
        self.assertEqual(res["outputs"]["changed"], "true")
        self.assertEqual(self.meta("my-demo")["status"], "offline")

        res = run_script(self.root, "handle_event.py",
                         event=issue_event("unlabeled", 1, "t", FORM_BODY, labels=["offline"]),
                         event_name="issues")
        self.assertEqual(self.meta("my-demo")["status"], "online")

        run_script(self.root, "handle_event.py",
                   event=issue_event("labeled", 1, "t", FORM_BODY, labels=["delete"]),
                   event_name="issues")
        self.assertIsNone(self.meta("my-demo"))

    def test_slug_conflict(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("opened", 2, "other", FORM_BODY),
                         event_name="issues")
        self.assertEqual(res["outputs"]["status"], "failed")
        comment = Path(res["outputs"]["comment_file"]).read_text(encoding="utf-8")
        self.assertIn("已被 issue #1 占用", comment)
        # 原站点不能被破坏
        self.assertIn("Hello", (self.root / "sites" / "my-demo" / "index.html").read_text(encoding="utf-8"))

    def test_chinese_title_gets_number_slug(self):
        body = "### 页面标题\n\n纯中文标题\n\n### HTML 代码\n\n```html\n<h1>x</h1>\n```\n"
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("opened", 42, "纯中文标题", body), event_name="issues")
        self.assertEqual(res["outputs"]["slug"], "p42")

    def test_push_event_rebuilds(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py", event={}, event_name="push")
        self.assertEqual(res["outputs"]["should_deploy"], "true")
        self.assertEqual(res["outputs"]["changed"], "false")

    def test_manual_folder_without_meta(self):
        site = self.root / "sites" / "handmade"
        site.mkdir(parents=True)
        (site / "index.html").write_text("<h1>manual</h1>", encoding="utf-8")
        self.build()
        self.assertTrue((self.root / "_site" / "handmade" / "index.html").is_file())
        gallery = (self.root / "_site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("handmade", gallery)

    def test_empty_repo_builds(self):
        self.build()
        gallery = (self.root / "_site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("共 <strong>0</strong> 个页面", gallery)
        self.assertTrue((self.root / "_site" / "404.html").is_file())
        self.assertTrue((self.root / "_site" / ".nojekyll").is_file())

    def test_redeploy_without_change_is_noop(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("edited", 1, "t", FORM_BODY), event_name="issues")
        self.assertEqual(res["outputs"]["changed"], "false", "内容没变就不该产生空提交")
        self.assertEqual(res["outputs"]["should_deploy"], "false")
        self.assertIn("没有需要重新部署", Path(res["outputs"]["comment_file"]).read_text(encoding="utf-8"))

    def test_rename_into_existing_dir_is_rejected(self):
        run_script(self.root, "handle_event.py",
                   event=issue_event("opened", 1, "t", FORM_BODY), event_name="issues")
        other = self.root / "sites" / "manual-site"
        other.mkdir(parents=True)
        (other / "index.html").write_text("x", encoding="utf-8")
        res = run_script(self.root, "handle_event.py",
                         event=comment_event(1, "/rename manual-site", FORM_BODY),
                         event_name="issue_comment")
        self.assertEqual(res["outputs"]["status"], "failed")
        self.assertIn("已被占用", Path(res["outputs"]["comment_file"]).read_text(encoding="utf-8"))
        self.assertTrue((self.root / "sites" / "my-demo").exists())

    def test_commit_message_has_skip_ci(self):
        res = run_script(self.root, "handle_event.py",
                         event=issue_event("opened", 7, "t", FORM_BODY), event_name="issues")
        msg = res["outputs"]["commit_msg"]
        self.assertIn("my-demo", msg)
        self.assertIn("#7", msg)
        self.assertIn("[skip ci]", msg)


class TestPrepareComment(unittest.TestCase):
    def _run(self, text: str, **env) -> str:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "comment.md"
            path.write_text(text, encoding="utf-8")
            full_env = os.environ.copy()
            for key in ("COMMIT_RESULT", "BUILD_RESULT", "UPLOAD_RESULT", "DEPLOY_RESULT", "SITE_URL"):
                full_env.pop(key, None)
            full_env.update({"COMMENT_FILE": str(path)})
            full_env.update(env)
            proc = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "prepare_comment.py")],
                capture_output=True, text=True, env=full_env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return path.read_text(encoding="utf-8")

    def test_success(self):
        out = self._run("{{STATUS}}\n\ntable", SITE_URL="https://x.io/p/a/",
                        COMMIT_RESULT="success", BUILD_RESULT="success",
                        UPLOAD_RESULT="success", DEPLOY_RESULT="success")
        self.assertIn("✅ **部署完成**", out)
        self.assertIn("https://x.io/p/a/", out)
        self.assertNotIn("{{STATUS}}", out)

    def test_deploy_failure_is_not_reported_as_success(self):
        out = self._run("{{STATUS}}\n\ntable", SITE_URL="https://x.io/p/a/",
                        COMMIT_RESULT="success", BUILD_RESULT="success",
                        UPLOAD_RESULT="success", DEPLOY_RESULT="failure")
        self.assertNotIn("✅", out)
        self.assertIn("部署失败", out)

    def test_commit_failure_takes_priority(self):
        out = self._run("{{STATUS}}", COMMIT_RESULT="failure", DEPLOY_RESULT="skipped")
        self.assertIn("写入仓库失败", out)

    def test_non_deploy_comment_untouched(self):
        out = self._run("ℹ️ 没有变化", SITE_URL="https://x.io/")
        self.assertEqual(out, "ℹ️ 没有变化")



if __name__ == "__main__":
    unittest.main(verbosity=2)
