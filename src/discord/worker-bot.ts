import { Client, GatewayIntentBits } from "discord.js";
import { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export function createWorkerBot(input: {
  role: Extract<AgentRole, "builder" | "factory">;
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
      "Current runtime stores task state through the central Orchestrator.",
      "Next implementation step: connect this worker to Codex CLI or Ollama and return artifacts to Obsidian.",
    ].join("\n"));
  });

  return client;
}
