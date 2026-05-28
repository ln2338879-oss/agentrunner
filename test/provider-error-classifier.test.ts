import { describe, expect, test } from "bun:test";
import { classifyProviderError } from "../src/providers/error-classifier";

describe("provider error classifier", () => {
  test("classifies usage limit errors as human-required", () => {
    const result = classifyProviderError({
      provider: "Claude Code",
      stderr: "usage limit reached for this account",
    });

    expect(result.kind).toBe("usage_limit");
    expect(result.needsHuman).toBe(true);
    expect(result.remediation).toContain("human");
  });

  test("classifies expired sessions as human-required", () => {
    const result = classifyProviderError({
      provider: "Codex",
      stderr: "session expired please login again",
    });

    expect(result.kind).toBe("session_expired");
    expect(result.needsHuman).toBe(true);
  });

  test("classifies network failures without forcing human escalation", () => {
    const result = classifyProviderError({
      provider: "Ollama",
      stderr: "connection refused localhost service unavailable",
    });

    expect(result.kind).toBe("network");
    expect(result.needsHuman).toBe(false);
  });
});
