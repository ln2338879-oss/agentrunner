#!/usr/bin/env bash
set -euo pipefail

# Triggers the GitHub Actions workflow that creates an approved-task PR.
#
# Requirements:
# - GitHub CLI installed
# - gh auth login completed
# - Run from the repository root
#
# AgentRunner passes TASK_ID, REPORT_PATH, REVIEW_PATH through stdin.

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

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required. Install it and run: gh auth login" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

BASE_BRANCH="${AGENTRUNNER_BASE_BRANCH:-main}"
BRANCH_NAME="${AGENTRUNNER_BRANCH_NAME:-agent/${TASK_ID}}"
DRAFT="${AGENTRUNNER_PR_DRAFT:-true}"

gh workflow run approved-task-pr.yml \
  -f task_id="$TASK_ID" \
  -f branch_name="$BRANCH_NAME" \
  -f report_path="$REPORT_PATH" \
  -f review_path="$REVIEW_PATH" \
  -f base_branch="$BASE_BRANCH" \
  -f draft="$DRAFT"

echo "Triggered approved-task-pr workflow for ${TASK_ID}."
echo "Branch: ${BRANCH_NAME}"
echo "Base: ${BASE_BRANCH}"
