import { describe, expect, test } from "bun:test";
import { parseReviewVerdict } from "./verdict";

describe("parseReviewVerdict", () => {
  test("parses approved verdict", () => {
    expect(parseReviewVerdict("VERDICT: APPROVED\nLooks good.")).toBe("APPROVED");
  });

  test("parses needs revision verdict", () => {
    expect(parseReviewVerdict("VERDICT: NEEDS_REVISION\nFix balance." )).toBe("NEEDS_REVISION");
  });

  test("parses blocked verdict", () => {
    expect(parseReviewVerdict("VERDICT: BLOCKED\nMissing context." )).toBe("BLOCKED");
  });

  test("defaults to blocked when no verdict exists", () => {
    expect(parseReviewVerdict("This response forgot the verdict." )).toBe("BLOCKED");
  });
});
