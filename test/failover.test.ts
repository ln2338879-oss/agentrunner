import { describe, expect, test } from "bun:test";
import { formatFailoverHeader, parseCommandCandidates } from "../src/agents/failover";

describe("parseCommandCandidates", () => {
  test("keeps primary command and fallback candidates", () => {
    expect(parseCommandCandidates("claude", "claude --profile backup||claude --profile fallback")).toEqual([
      "claude",
      "claude --profile backup",
      "claude --profile fallback",
    ]);
  });

  test("trims empty entries and deduplicates commands", () => {
    expect(parseCommandCandidates("codex", " || codex || codex --profile backup || ")).toEqual([
      "codex",
      "codex --profile backup",
    ]);
  });
});

describe("formatFailoverHeader", () => {
  test("includes command metadata", () => {
    const header = formatFailoverHeader({
      command: "codex --profile backup",
      result: {
        ok: true,
        exitCode: 0,
        stdout: "done",
        stderr: "",
        timedOut: false,
      },
    });

    expect(header).toContain("command: codex --profile backup");
    expect(header).toContain("ok: true");
    expect(header).toContain("exit_code: 0");
  });
});
