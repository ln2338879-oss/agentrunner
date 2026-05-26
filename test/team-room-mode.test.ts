import { describe, expect, test } from "bun:test";
import { workerBotDescription, shouldProcessWorkerMessage } from "../src/discord/worker-bot";

describe("team room mode", () => {
  test("worker bots can be output-only when no intake channel is configured", () => {
    expect(shouldProcessWorkerMessage({ configuredChannelId: "", messageChannelId: "team", authorIsBot: false })).toBe(false);
  });

  test("worker bot descriptions mention shared team room presence", () => {
    expect(workerBotDescription("builder")).toContain("shared team room");
    expect(workerBotDescription("factory")).toContain("shared team room");
    expect(workerBotDescription("designer")).toContain("shared team room");
  });
});
