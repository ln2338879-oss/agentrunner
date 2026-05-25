import type { RuntimeConfig } from "../config";
import type { DiscordWorkerRole } from "./worker-bot";

export interface EnabledDiscordBotConfig {
  role: "director" | DiscordWorkerRole;
  token: string;
  channelId: string;
}

export function enabledDiscordBots(config: RuntimeConfig): EnabledDiscordBotConfig[] {
  const bots: EnabledDiscordBotConfig[] = [
    {
      role: "director",
      token: config.DIRECTOR_DISCORD_TOKEN,
      channelId: config.GAME_DIRECTOR_CHANNEL_ID,
    },
    {
      role: "builder",
      token: config.BUILDER_DISCORD_TOKEN,
      channelId: config.DEV_TASKS_CHANNEL_ID,
    },
    {
      role: "factory",
      token: config.FACTORY_DISCORD_TOKEN,
      channelId: config.CONTENT_FACTORY_CHANNEL_ID,
    },
    {
      role: "designer",
      token: config.DESIGNER_DISCORD_TOKEN,
      channelId: config.DESIGN_TASKS_CHANNEL_ID,
    },
  ];
  return bots.filter((bot) => bot.token);
}

export function validateDiscordMultiBotConfig(config: RuntimeConfig): void {
  const enabled = enabledDiscordBots(config);
  const duplicateTokens = duplicates(enabled.map((bot) => bot.token));
  if (duplicateTokens.length > 0) {
    const roles = enabled
      .filter((bot) => duplicateTokens.includes(bot.token))
      .map((bot) => bot.role)
      .join(", ");
    throw new Error(
      `Discord multi-bot config is invalid: each role needs its own bot token. Duplicate token roles: ${roles}`,
    );
  }

  const intakeBots = enabled.filter((bot) => bot.channelId);
  const duplicateChannels = duplicates(intakeBots.map((bot) => bot.channelId));
  if (duplicateChannels.length > 0) {
    const roles = intakeBots
      .filter((bot) => duplicateChannels.includes(bot.channelId))
      .map((bot) => bot.role)
      .join(", ");
    throw new Error(
      `Discord multi-bot config is invalid: enabled bots must not share the same intake channel. Duplicate channel roles: ${roles}`,
    );
  }
}

export function discordMultiBotWarnings(config: RuntimeConfig): string[] {
  const warnings: string[] = [];
  for (const bot of enabledDiscordBots(config)) {
    if (bot.role !== "director" && !bot.channelId) {
      warnings.push(
        `${bot.role} bot has a token but no channel id; message intake is disabled for that bot.`,
      );
    }
  }
  return warnings;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}
