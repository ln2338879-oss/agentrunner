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

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (config.GAME_DIRECTOR_CHANNEL_ID && interaction.channelId !== config.GAME_DIRECTOR_CHANNEL_ID) {
        await interaction.reply({ content: "AgentRunner Director 채널에서만 사용할 수 있습니다.", ephemeral: true });
        return;
      }

      if (interaction.commandName === "help") {
        await interaction.reply(await handleDirectorCommand({ content: "!help", store }) ?? "명령어를 불러오지 못했습니다.");
        return;
      }

      if (interaction.commandName === "tasks") {
        await interaction.reply(await handleDirectorCommand({ content: "!tasks", store }) ?? "작업 목록을 불러오지 못했습니다.");
        return;
      }

      if (interaction.commandName === "task") {
        const taskId = interaction.options.getString("id", true);
        await interaction.reply(await handleDirectorCommand({ content: `!task ${taskId}`, store }) ?? `작업을 찾을 수 없습니다: ${taskId}`);
        return;
      }

      if (interaction.commandName === "retry") {
        await interaction.deferReply();
        const taskId = interaction.options.getString("id", true);
        const task = store.getTask(taskId);
        if (!task) {
          await interaction.editReply(`재시도할 작업을 찾을 수 없습니다: ${taskId}`);
          return;
        }

        const result = await orchestrator.handleUserRequest({
          content: buildRetryContent(taskId, task),
          discordMessageId: interaction.id,
          discordChannelId: interaction.channelId,
        });

        await interaction.editReply(formatTaskResult({ result, prefix: `재시도 작업 생성: ${result.taskId}\n원본 작업: ${taskId}` }));
        return;
      }

      if (interaction.commandName === "run") {
        await interaction.deferReply();
        const prompt = interaction.options.getString("prompt", true);
        const result = await orchestrator.handleUserRequest({
          content: prompt,
          discordMessageId: interaction.id,
          discordChannelId: interaction.channelId,
        });
        await interaction.editReply(formatTaskResult({ result, prefix: `작업 생성: ${result.taskId}` }));
        return;
      }

      await interaction.reply({ content: `알 수 없는 명령어: ${interaction.commandName}`, ephemeral: true });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`AgentRunner 처리 실패: ${messageText}`);
      } else {
        await interaction.reply({ content: `AgentRunner 처리 실패: ${messageText}`, ephemeral: true });
      }
    }
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
          content: buildRetryContent(retryTaskId, task),
          discordMessageId: message.id,
          discordChannelId: message.channelId,
        });

        await message.reply(formatTaskResult({ result, prefix: `재시도 작업 생성: ${result.taskId}\n원본 작업: ${retryTaskId}` }));
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

      await message.reply(formatTaskResult({ result, prefix: `작업 생성: ${result.taskId}` }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply(`AgentRunner 처리 실패: ${messageText}`);
    }
  });

  return client;
}

function buildRetryContent(taskId: string, task: ReturnType<RuntimeStore["getTask"]>): string {
  if (!task) return `Retry previous AgentRunner task ${taskId}.`;
  return [
    `Retry previous AgentRunner task ${taskId}.`,
    "",
    "Original task summary:",
    task.title,
    "",
    `Previous status: ${task.status}`,
    `Previous assigned role: ${task.assignedTo}`,
    `Previous round: ${task.currentRound}`,
    `Previous task note: ${task.obsidianPath}`,
  ].join("\n");
}

function formatTaskResult(input: {
  result: {
    taskId: string;
    assignedTo: string;
    obsidianPath: string;
    reportPath: string;
    reviewPath?: string;
    approvedPath?: string;
    verdict?: string;
  };
  prefix: string;
}): string {
  return [
    input.prefix,
    `담당 역할: ${input.result.assignedTo}`,
    input.result.verdict ? `Director 리뷰: ${input.result.verdict}` : undefined,
    `Obsidian Task: ${input.result.obsidianPath}`,
    `Report: ${input.result.reportPath}`,
    input.result.reviewPath ? `Review: ${input.result.reviewPath}` : undefined,
    input.result.approvedPath ? `Approved: ${input.result.approvedPath}` : undefined,
  ].filter(Boolean).join("\n");
}
