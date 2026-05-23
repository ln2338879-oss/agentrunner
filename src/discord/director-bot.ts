import { Client, GatewayIntentBits } from "discord.js";
import { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { handleDirectorCommand, isCommand, parseRetryCommand } from "./commands";
import { Orchestrator } from "../runtime/orchestrator";

export function createDirectorBot(config: RuntimeConfig, orchestrator: Orchestrator, store: RuntimeStore): Client {
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
      const retryTaskId = parseRetryCommand(message.content);
      if (retryTaskId) {
        const task = store.getTask(retryTaskId);
        if (!task) {
          await message.reply(`재시도할 작업을 찾을 수 없습니다: ${retryTaskId}`);
          return;
        }

        const result = await orchestrator.handleUserRequest({
          content: [
            `Retry previous AgentRunner task ${retryTaskId}.`,
            "",
            "Original task summary:",
            task.title,
            "",
            `Previous status: ${task.status}`,
            `Previous assigned role: ${task.assignedTo}`,
            `Previous round: ${task.currentRound}`,
            `Previous task note: ${task.obsidianPath}`,
          ].join("\n"),
          discordMessageId: message.id,
          discordChannelId: message.channelId,
        });

        await message.reply([
          `재시도 작업 생성: ${result.taskId}`,
          `원본 작업: ${retryTaskId}`,
          `담당 역할: ${result.assignedTo}`,
          result.verdict ? `Director 리뷰: ${result.verdict}` : undefined,
          `Obsidian Task: ${result.obsidianPath}`,
          `Report: ${result.reportPath}`,
          result.reviewPath ? `Review: ${result.reviewPath}` : undefined,
          result.approvedPath ? `Approved: ${result.approvedPath}` : undefined,
        ].filter(Boolean).join("\n"));
        return;
      }

      if (isCommand(message.content)) {
        const commandResult = await handleDirectorCommand({ content: message.content, store });
        if (commandResult) {
          await message.reply(commandResult);
          return;
        }
      }

      const result = await orchestrator.handleUserRequest({
        content: message.content,
        discordMessageId: message.id,
        discordChannelId: message.channelId,
      });

      await message.reply([
        `작업 생성: ${result.taskId}`,
        `담당 역할: ${result.assignedTo}`,
        result.verdict ? `Director 리뷰: ${result.verdict}` : undefined,
        `Obsidian Task: ${result.obsidianPath}`,
        `Report: ${result.reportPath}`,
        result.reviewPath ? `Review: ${result.reviewPath}` : undefined,
        result.approvedPath ? `Approved: ${result.approvedPath}` : undefined,
      ].filter(Boolean).join("\n"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply(`AgentRunner 처리 실패: ${messageText}`);
    }
  });

  return client;
}
