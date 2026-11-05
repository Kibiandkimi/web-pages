#!/usr/bin/env python3
"""把回评内容里的 ``{{STATUS}}`` 换成真实结果。

``handle_event.py`` 在解析阶段就写好了回评草稿，但那时还不知道提交 / 构建 /
上传 / 部署会不会成功。这个脚本在回评之前，按各步骤的 ``outcome`` 填入真正的
状态，避免「明明部署失败了，issue 里还写着 ✅ 部署完成」。
"""

from __future__ import annotations

import os
import sys

# 按「先发生、先报告」的顺序检查；任何一步失败都覆盖后面的成功
FAILURE_STEPS = [
    ("COMMIT_RESULT", "❌ **写入仓库失败** —— 内容没有保存，请重试一次或查看 Actions 日志。"),
    ("BUILD_RESULT", "❌ **构建失败** —— 内容已保存，但没有生成站点，请查看 Actions 日志。"),
    ("UPLOAD_RESULT", "❌ **上传产物失败** —— 内容已保存，但没送到 Pages，请查看 Actions 日志。"),
    (
        "DEPLOY_RESULT",
        "⚠️ **内容已保存，但部署失败** —— 稍后可以评论 `/redeploy` 重试，或查看 Actions 日志。",
    ),
]


def build_status() -> str:
    for env_name, message in FAILURE_STEPS:
        if os.environ.get(env_name) == "failure":
            return message
    url = os.environ.get("SITE_URL", "").strip()
    if url:
        return f"✅ **部署完成** → [打开页面]({url})"
    return "✅ **部署完成**"


def main() -> int:
    path = os.environ.get("COMMENT_FILE", "")
    if not path or not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if "{{STATUS}}" not in text:
        return 0
    text = text.replace("{{STATUS}}", build_status())
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"回评状态：{build_status()[:40]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
