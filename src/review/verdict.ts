import type { ReviewVerdict } from "../runtime/types";

export function parseReviewVerdict(text: string): ReviewVerdict {
  const firstLines = text.split(/\r?\n/).slice(0, 8).join("\n").toUpperCase();

  if (firstLines.includes("VERDICT: APPROVED") || firstLines.includes("STATUS: APPROVED")) {
    return "APPROVED";
  }

  if (firstLines.includes("VERDICT: NEEDS_REVISION") || firstLines.includes("STATUS: NEEDS_REVISION")) {
    return "NEEDS_REVISION";
  }

  if (firstLines.includes("VERDICT: BLOCKED") || firstLines.includes("STATUS: BLOCKED")) {
    return "BLOCKED";
  }

  return "BLOCKED";
}
