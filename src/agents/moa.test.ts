import { describe, expect, test } from "bun:test";
import { parseMoaCommands, shouldUseMoaForPrompt } from "./moa";

describe("parseMoaCommands", () => {
  test("parses unique pipe-separated commands", () => {
    expect(parseMoaCommands("codex||ollama run qwen||codex||  ")).toEqual([
      "codex",
      "ollama run qwen",
    ]);
  });

  test("returns empty array for empty config", () => {
    expect(parseMoaCommands("")).toEqual([]);
  });
});

describe("shouldUseMoaForPrompt", () => {
  test("enables MoA for review prompts", () => {
    expect(shouldUseMoaForPrompt("# AgentRunner Review Step\nAction: review")).toBe(true);
  });

  test("enables MoA for arbitration prompts", () => {
    expect(shouldUseMoaForPrompt("# AgentRunner Arbitration Step\nAction: arbitrate")).toBe(true);
  });

  test("does not enable MoA for planning prompts", () => {
    expect(shouldUseMoaForPrompt("# AgentRunner Planning Step\nAction: plan")).toBe(false);
  });
});
