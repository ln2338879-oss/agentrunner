import { Client, GatewayIntentBits } from "discord.js";
import { RuntimeConfig } from "../config";
import { Orchestrator } from "../runtime/orchestrator";

export function createDirectorBot(config: RuntimeConfig, orchestrator: Orchestrator): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", () => {
    console.log(`[director] logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (config.GAME_DIRECTOR_CHANNEL_ID && message.channelId !== config.GAME_DIRECTOR_CHANNEL_ID) return;

    try {
      const result = await orchestrator.handleUserRequest({
        content: message.content,
        discordMessageId: message.id,
        discordChannelId: message.channelId,
      });

      await message.reply([
        `작업 생성: ${result.taskId}`,
        `담당 역할: ${result.assignedTo}`,
        `Obsidian Task: ${result.obsidianPath}`,
        `Report: ${result.reportPath}`,
      ].join("\n"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply(`AgentRunner 처리 실패: ${messageText}`);
    }
  });

  return client;
}
