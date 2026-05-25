import { Client, GatewayIntentBits } from "discord.js";
import { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export type DiscordWorkerRole = Extract<AgentRole, "builder" | "factory" | "designer">;

export function workerBotDescription(role: DiscordWorkerRole): string {
  if (role === "designer") {
    return "Designer worker bot received the visual task handoff. The central runtime can route design work to Gemini image generation and save artifacts to Obsidian.";
  }

  if (role === "factory") {
    return "Factory worker bot received the content task handoff. The central runtime stores generated outputs and artifacts through Obsidian.";
  }

  return "Builder worker bot received the implementation task handoff. The central runtime stores build outputs and artifacts through Obsidian.";
}

export function createWorkerBot(input: {
  role: DiscordWorkerRole;
  token: string;
  channelId: string;
  config: RuntimeConfig;
}): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", () => {
    console.log(`[${input.role}] logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (input.channelId && message.channelId !== input.channelId) return;

    await message.reply([
      `${input.role} bot received the task handoff.`,
      workerBotDescription(input.role),
      "Worker execution is coordinated by AgentRunner runtime adapters and Obsidian artifacts.",
    ].join("\n"));
  });

  return client;
}
