import { describe, expect, test } from "bun:test";
import { reviewNote } from "../src/obsidian/templates";
import { statusFromVerdict } from "../src/review/review-loop";
import { parseReviewVerdict } from "../src/review/verdict";

describe("expanded review verdicts", () => {
  test("parses all supported verdicts from review output", () => {
    expect(parseReviewVerdict("VERDICT: APPROVED\nLooks good.")).toBe("APPROVED");
    expect(parseReviewVerdict("VERDICT: NEEDS_REVISION\nFix concrete issues.")).toBe("NEEDS_REVISION");
    expect(parseReviewVerdict("VERDICT: REQUEST_CHANGES\nFix concrete issues.")).toBe("REQUEST_CHANGES");
    expect(parseReviewVerdict("VERDICT: NEEDS_TESTS\nAdd coverage.")).toBe("NEEDS_TESTS");
    expect(parseReviewVerdict("VERDICT: NEEDS_SECURITY_REVIEW\nAuth risk.")).toBe("NEEDS_SECURITY_REVIEW");
    expect(parseReviewVerdict("VERDICT: NEEDS_ARCHITECTURE_REVIEW\nDesign risk.")).toBe("NEEDS_ARCHITECTURE_REVIEW");
    expect(parseReviewVerdict("VERDICT: BLOCKED\nCannot continue safely.")).toBe("BLOCKED");
    expect(parseReviewVerdict("VERDICT: NEEDS_HUMAN\nNeeds credentials.")).toBe("NEEDS_HUMAN");
    expect(parseReviewVerdict("VERDICT: SPLIT_TASK\nToo large.")).toBe("SPLIT_TASK");
    expect(parseReviewVerdict("VERDICT: RETRY_WITH_DIFFERENT_AGENT\nUse builder instead.")).toBe("RETRY_WITH_DIFFERENT_AGENT");
  });

  test("falls back to BLOCKED for unrecognized verdicts", () => {
    expect(parseReviewVerdict("Looks okay but no explicit verdict.")).toBe("BLOCKED");
    expect(parseReviewVerdict("VERDICT: APPROVED_WITH_RISKS\nMostly fine.")).toBe("BLOCKED");
  });

  test("maps verdicts to task statuses", () => {
    expect(statusFromVerdict("APPROVED")).toBe("approved");
    expect(statusFromVerdict("NEEDS_REVISION")).toBe("needs_revision");
    expect(statusFromVerdict("REQUEST_CHANGES")).toBe("needs_revision");
    expect(statusFromVerdict("NEEDS_TESTS")).toBe("needs_revision");
    expect(statusFromVerdict("NEEDS_SECURITY_REVIEW")).toBe("needs_revision");
    expect(statusFromVerdict("NEEDS_ARCHITECTURE_REVIEW")).toBe("needs_revision");
    expect(statusFromVerdict("BLOCKED")).toBe("blocked");
    expect(statusFromVerdict("NEEDS_HUMAN")).toBe("needs_human");
    expect(statusFromVerdict("SPLIT_TASK")).toBe("split_task");
    expect(statusFromVerdict("RETRY_WITH_DIFFERENT_AGENT")).toBe("retry_with_different_agent");
  });

  test("renders expanded verdicts in review notes", () => {
    const note = reviewNote({
      taskId: "TASK-VERDICT-1",
      verdict: "NEEDS_HUMAN",
      round: 2,
      body: "Need API credentials before continuing.",
    });

    expect(note).toContain("verdict: NEEDS_HUMAN");
    expect(note).toContain("Need API credentials before continuing.");
  });
});
