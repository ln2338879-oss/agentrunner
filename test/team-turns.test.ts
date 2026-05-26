import { describe, expect, test } from "bun:test";
import { formatDoneTurn, formatReviewTurn, formatWorkerTurn, roleLabel } from "../src/discord/team-turns";

describe("team turn formatting", () => {
  test("labels roles", () => {
    expect(roleLabel("director")).toBe("Director");
    expect(roleLabel("builder")).toBe("Builder");
    expect(roleLabel("factory")).toBe("Factory");
    expect(roleLabel("designer")).toBe("Designer");
  });

  test("formats worker output", () => {
    expect(formatWorkerTurn({ role: "builder", output: "done" })).toBe("Builder:\ndone");
  });

  test("formats review and done output", () => {
    expect(formatReviewTurn({ verdict: "APPROVED", output: "ok" })).toContain("Review: APPROVED");
    expect(formatDoneTurn({ taskId: "TASK-1", output: "ok" })).toContain("TASK-1 complete");
  });
});
