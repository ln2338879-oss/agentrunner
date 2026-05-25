import type { ReviewVerdict } from "../runtime/types";

export const ReviewVerdicts: ReviewVerdict[] = [
  "APPROVED",
  "NEEDS_REVISION",
  "BLOCKED",
  "NEEDS_HUMAN",
  "SPLIT_TASK",
  "RETRY_WITH_DIFFERENT_AGENT",
];

export function parseReviewVerdict(text: string): ReviewVerdict {
  const firstLines = text.split(/\r?\n/).slice(0, 8).join("\n").toUpperCase();

  for (const verdict of ReviewVerdicts) {
    if (firstLines.includes(`VERDICT: ${verdict}`) || firstLines.includes(`STATUS: ${verdict}`)) {
      return verdict;
    }
  }

  return "BLOCKED";
}
