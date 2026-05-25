import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import {
  discordMultiBotWarnings,
  enabledDiscordBots,
  validateDiscordMultiBotConfig,
} from "../src/discord/multi-bot-config";
import { shouldProcessWorkerMessage } from "../src/discord/worker-bot";

describe("discord multi-bot config", () => {
  test("lists the enabled role bots", () => {
    const config = loadConfig({
      DIRECTOR_DISCORD_TOKEN: "director-token",
      BUILDER_DISCORD_TOKEN: "builder-token",
      GAME_DIRECTOR_CHANNEL_ID: "director-channel",
      DEV_TASKS_CHANNEL_ID: "builder-channel",
    });

    expect(enabledDiscordBots(config).map((bot) => bot.role)).toEqual(["director", "builder"]);
  });

  test("rejects duplicate tokens across enabled bots", () => {
    const config = loadConfig({
      DIRECTOR_DISCORD_TOKEN: "same-token",
      BUILDER_DISCORD_TOKEN: "same-token",
      GAME_DIRECTOR_CHANNEL_ID: "director-channel",
      DEV_TASKS_CHANNEL_ID: "builder-channel",
    });

    expect(() => validateDiscordMultiBotConfig(config)).toThrow(
      "each role needs its own bot token",
    );
  });

  test("rejects duplicate intake channels across enabled bots", () => {
    const config = loadConfig({
      DIRECTOR_DISCORD_TOKEN: "director-token",
      BUILDER_DISCORD_TOKEN: "builder-token",
      GAME_DIRECTOR_CHANNEL_ID: "same-channel",
      DEV_TASKS_CHANNEL_ID: "same-channel",
    });

    expect(() => validateDiscordMultiBotConfig(config)).toThrow(
      "must not share the same intake channel",
    );
  });

  test("warns and disables worker intake when a worker channel is missing", () => {
    const config = loadConfig({ BUILDER_DISCORD_TOKEN: "builder-token" });
    expect(discordMultiBotWarnings(config)).toContain(
      "builder bot has a token but no channel id; message intake is disabled for that bot.",
    );
    expect(
      shouldProcessWorkerMessage({
        configuredChannelId: "",
        messageChannelId: "any",
        authorIsBot: false,
      }),
    ).toBe(false);
  });
});
