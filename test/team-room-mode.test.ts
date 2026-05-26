import { describe, expect, test } from "bun:test";
import { shouldProcessWorkerMessage } from "../src/discord/worker-bot";

describe("team room mode", () => {
  test("empty worker channel disables worker intake", () => {
    expect(shouldProcessWorkerMessage({ configuredChannelId: "", messageChannelId: "team", authorIsBot: false })).toBe(false);
  });

  test("worker intake ignores bot messages", () => {
    expect(shouldProcessWorkerMessage({ configuredChannelId: "team", messageChannelId: "team", authorIsBot: true })).toBe(false);
  });
});
