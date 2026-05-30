import type { ReviewVerdict, TaskStatus } from "../runtime/types";

export const ReviewVerdicts: ReviewVerdict[] = [
  "APPROVED",
  "NEEDS_REVISION",
  "REQUEST_CHANGES",
  "NEEDS_TESTS",
  "NEEDS_SECURITY_REVIEW",
  "NEEDS_ARCHITECTURE_REVIEW",
  "BLOCKED",
  "NEEDS_HUMAN",
  "SPLIT_TASK",
  "RETRY_WITH_DIFFERENT_AGENT",
];

export const ReviewVerdictStatus: Record<ReviewVerdict, TaskStatus> = {
  APPROVED: "approved",
  NEEDS_REVISION: "needs_revision",
  REQUEST_CHANGES: "needs_revision",
  NEEDS_TESTS: "needs_revision",
  NEEDS_SECURITY_REVIEW: "needs_revision",
  NEEDS_ARCHITECTURE_REVIEW: "needs_revision",
  BLOCKED: "blocked",
  NEEDS_HUMAN: "needs_human",
  SPLIT_TASK: "split_task",
  RETRY_WITH_DIFFERENT_AGENT: "retry_with_different_agent",
};

export function parseReviewVerdict(text: string): ReviewVerdict {
  const firstLines = text.split(/\r?\n/).slice(0, 8);

  for (const verdict of ReviewVerdicts) {
    const pattern = new RegExp(`^\\s*(VERDICT|STATUS)\\s*:\\s*${verdict}\\s*$`, "i");
    if (firstLines.some((line) => pattern.test(line))) {
      return verdict;
    }
  }

  return "BLOCKED";
}

export function statusFromReviewVerdict(verdict: ReviewVerdict): TaskStatus {
  return ReviewVerdictStatus[verdict];
}

export function isTerminalReviewVerdict(verdict: ReviewVerdict): boolean {
  return ReviewVerdictStatus[verdict] !== "needs_revision";
}
