#!/usr/bin/env bash
set -euo pipefail

# AgentRunner approved task hook example.
# The orchestrator passes TASK_ID, REPORT_PATH and REVIEW_PATH through stdin.
# This script reads them, creates a branch, commits current changes, and prints
# the next manual PR command. It intentionally does not push by default.

TASK_ID=""
REPORT_PATH=""
REVIEW_PATH=""

while IFS='=' read -r key value; do
  case "$key" in
    TASK_ID) TASK_ID="$value" ;;
    REPORT_PATH) REPORT_PATH="$value" ;;
    REVIEW_PATH) REVIEW_PATH="$value" ;;
  esac
done

if [[ -z "$TASK_ID" ]]; then
  echo "TASK_ID is required" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git work tree" >&2
  exit 1
fi

BRANCH="agent/${TASK_ID}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  git checkout -B "$BRANCH"
fi

if git diff --quiet && git diff --cached --quiet; then
  echo "No git changes to commit for ${TASK_ID}."
  exit 0
fi

git add -A
git commit -m "feat(agent): apply ${TASK_ID}"

echo "Committed ${TASK_ID} on branch ${BRANCH}."
echo "Report: ${REPORT_PATH}"
echo "Review: ${REVIEW_PATH}"
echo "To push and open a PR manually:"
echo "  git push -u origin ${BRANCH}"
echo "  gh pr create --fill"
