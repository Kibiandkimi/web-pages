#!/usr/bin/env bash
# 把 sites/ 和 .meta/ 的改动提交并推回 main。带 rebase 重试，避免并发冲突。
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -A -- sites .meta

if git diff --cached --quiet; then
  echo "没有需要提交的变更。"
  exit 0
fi

git commit -m "${COMMIT_MSG:-chore: update sites}"

BRANCH="${GITHUB_REF_NAME:-main}"
if [ -z "${BRANCH}" ] || [ "${BRANCH}" = "HEAD" ]; then
  BRANCH="main"
fi

for attempt in 1 2 3 4; do
  if git pull --rebase --autostash origin "${BRANCH}" && git push origin "HEAD:${BRANCH}"; then
    echo "已推送到 ${BRANCH}"
    exit 0
  fi
  echo "第 ${attempt} 次推送失败，稍后重试…"
  sleep $((attempt * 3))
done

echo "推送失败：多次重试仍无法写入 ${BRANCH}" >&2
exit 1
