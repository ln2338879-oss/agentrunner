import { describe, expect, test } from "bun:test";
import { workerBotDescription } from "../src/discord/worker-bot";

describe("workerBotDescription", () => {
  test("describes builder worker bot handoff", () => {
    expect(workerBotDescription("builder")).toContain("Builder worker bot");
    expect(workerBotDescription("builder")).toContain("implementation task handoff");
  });

  test("describes factory worker bot handoff", () => {
    expect(workerBotDescription("factory")).toContain("Factory worker bot");
    expect(workerBotDescription("factory")).toContain("content task handoff");
  });

  test("describes designer worker bot handoff", () => {
    expect(workerBotDescription("designer")).toContain("Designer worker bot");
    expect(workerBotDescription("designer")).toContain("Gemini image generation");
  });
});
