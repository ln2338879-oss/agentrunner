import { describe, expect, test } from "bun:test";
import { runWithFailover } from "../src/agents/failover";

describe("runWithFailover", () => {
  test("falls back to secondary command after failure", async () => {
    const result = await runWithFailover({
      commands: [
        process.platform === "win32"
          ? "cmd /c exit 1"
          : "sh -lc 'exit 1'",
        process.platform === "win32"
          ? "cmd /c echo fallback-success"
          : "echo fallback-success",
      ],
      cwd: process.cwd(),
      input: "test",
      timeoutMs: 10_000,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("fallback-success");
    expect(result.attempts.length).toBe(2);
    expect(result.attempts[0].result.ok).toBe(false);
    expect(result.attempts[1].result.ok).toBe(true);
  });
});
