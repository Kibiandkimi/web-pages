#!/usr/bin/env bash
# 把 sites/ 和 .meta/ 的改动提交并推回 main。带 rebase 重试，避免并发冲突。
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# 两个目录正常情况下都有 .gitkeep，这里再兜一层，避免 pathspec 不存在导致 exit 128
mkdir -p sites .meta
git add -A -- sites .meta

if git diff --cached --quiet; then
  echo "没有需要提交的变更。"
  exit 0
fi

MSG="${COMMIT_MSG:-chore: update sites}"
case "${MSG}" in
  *"[skip ci]"*) ;;
  *) MSG="${MSG} [skip ci]" ;;
esac
git commit -m "${MSG}"

BRANCH="${GITHUB_REF_NAME:-main}"
if [ -z "${BRANCH}" ] || [ "${BRANCH}" = "HEAD" ]; then
  BRANCH="main"
fi

for attempt in 1 2 3 4; do
  # 上一轮 rebase 可能停在冲突中，必须先 abort，否则后面几轮全是 exit 128
  git rebase --abort >/dev/null 2>&1 || true
  git merge --abort >/dev/null 2>&1 || true

  if git pull --rebase --autostash origin "${BRANCH}" && git push origin "HEAD:${BRANCH}"; then
    echo "已推送到 ${BRANCH}"
    exit 0
  fi
  echo "第 ${attempt} 次推送失败，稍后重试…"
  sleep $((attempt * 3))
done

git rebase --abort >/dev/null 2>&1 || true
echo "推送失败：多次重试仍无法写入 ${BRANCH}" >&2
exit 1
