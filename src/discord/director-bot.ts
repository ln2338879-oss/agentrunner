import { Client, GatewayIntentBits } from "discord.js";
import { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { Orchestrator } from "../runtime/orchestrator";
import { buildDesignChoiceReply } from "./design-choice";
import { persistAttachmentContext } from "./attachments";
import { handleDirectorCommand, isCommand, parseRetryCommand } from "./commands";
import { formatUserTaskResponse } from "./user-response";

export function createDirectorBot(config: RuntimeConfig, orchestrator: Orchestrator, store: RuntimeStore): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.once("ready", () => {
    console.log(`[director] logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (config.GAME_DIRECTOR_CHANNEL_ID && interaction.channelId !== config.GAME_DIRECTOR_CHANNEL_ID) {
        await interaction.reply({ content: "Use AgentRunner in the Director channel.", ephemeral: true });
        return;
      }

      if (["help", "tasks"].includes(interaction.commandName)) {
        const commandResult = await handleDirectorCommand({ content: `!${interaction.commandName}`, store });
        await interaction.reply(commandResult ?? "Command failed.");
        return;
      }

      if (interaction.commandName === "task") {
        const taskId = interaction.options.getString("id", true);
        await interaction.reply(await handleDirectorCommand({ content: `!task ${taskId}`, store }) ?? `Task not found: ${taskId}`);
        return;
      }

      if (interaction.commandName === "retry") {
        await interaction.deferReply();
        const taskId = interaction.options.getString("id", true);
        const task = store.getTask(taskId);
        if (!task) {
          await interaction.editReply(`Task not found: ${taskId}`);
          return;
        }
        const result = await orchestrator.handleUserRequest({
          content: retryContent(taskId, task.title),
          discordMessageId: interaction.id,
          discordChannelId: interaction.channelId,
        });
        await interaction.editReply(formatUserTaskResponse({ result, prefix: `Retry task ${result.taskId}` }));
        return;
      }

      if (interaction.commandName === "run") {
        const prompt = interaction.options.getString("prompt", true);
        const designReply = buildDesignChoiceReply({ content: prompt, userId: interaction.user.id });
        if (designReply) {
          await interaction.reply(designReply);
          return;
        }
        await interaction.deferReply();
        const result = await orchestrator.handleUserRequest({
          content: prompt,
          discordMessageId: interaction.id,
          discordChannelId: interaction.channelId,
        });
        await interaction.editReply(formatUserTaskResponse({ result, prefix: `Task ${result.taskId}` }));
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (interaction.deferred || interaction.replied) await interaction.editReply(`AgentRunner failed: ${messageText}`);
      else await interaction.reply({ content: `AgentRunner failed: ${messageText}`, ephemeral: true });
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (config.GAME_DIRECTOR_CHANNEL_ID && message.channelId !== config.GAME_DIRECTOR_CHANNEL_ID) return;

    try {
      const session = store.getOrCreateSession({ discordChannelId: message.channelId, title: `Discord channel ${message.channelId}` });
      const steer = parseSteeringCommand(message.content);
      if (steer) {
        store.recordSteeringMessage({ id: `STEER-${Date.now()}`, taskId: steer.taskId, discordMessageId: message.id, content: steer.content });
        await message.reply(`Steering queued for ${steer.taskId}.`);
        return;
      }

      const attachmentContext = await persistAttachmentContext({
        attachments: message.attachments,
        attachmentsDir: config.ATTACHMENTS_DIR,
        messageId: message.id,
        maxAttachmentBytes: config.MAX_ATTACHMENT_BYTES,
      });
      const contentWithAttachments = withAttachmentContext(message.content, attachmentContext.markdown);
      const retryTaskId = parseRetryCommand(message.content);

      if (retryTaskId) {
        const task = store.getTask(retryTaskId);
        if (!task) {
          await message.reply(`Task not found: ${retryTaskId}`);
          return;
        }
        const result = await orchestrator.handleUserRequest({
          content: withSessionContext(retryContent(retryTaskId, task.title), store, session.id),
          discordMessageId: message.id,
          discordChannelId: message.channelId,
        });
        await message.reply(formatUserTaskResponse({ result, prefix: `Retry task ${result.taskId}` }));
        return;
      }

      if (isCommand(message.content)) {
        const commandResult = await handleDirectorCommand({ content: message.content, store });
        if (commandResult) {
          await message.reply(commandResult);
          return;
        }
      }

      const designReply = buildDesignChoiceReply({ content: contentWithAttachments, userId: message.author.id });
      if (designReply) {
        await message.reply(designReply);
        return;
      }

      store.recordMessage({
        id: `MSG-${message.id}`,
        discordMessageId: message.id,
        discordChannelId: message.channelId,
        sessionId: session.id,
        senderRole: "director",
        content: message.content,
      });

      const result = await orchestrator.handleUserRequest({
        content: withSessionContext(contentWithAttachments, store, session.id),
        discordMessageId: message.id,
        discordChannelId: message.channelId,
      });
      await message.reply(formatUserTaskResponse({ result, prefix: `Task ${result.taskId}` }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply(`AgentRunner failed: ${messageText}`);
    }
  });

  return client;
}

function retryContent(taskId: string, title: string): string {
  return [`Retry AgentRunner task ${taskId}.`, "", title].join("\n");
}

function withAttachmentContext(content: string, attachmentContext: string): string {
  if (!attachmentContext) return content;
  return [content, "", attachmentContext].join("\n");
}

function withSessionContext(content: string, store: RuntimeStore, sessionId: string): string {
  const messages = store.listRecentSessionMessages(sessionId, 6).reverse();
  if (messages.length === 0) return content;
  return [
    "# Session Context",
    "",
    ...messages.map((message) => `- ${message.createdAt} ${message.senderRole ?? "user"}: ${message.content}`),
    "",
    "# Current Message",
    "",
    content,
  ].join("\n");
}

function parseSteeringCommand(content: string): { taskId: string; content: string } | null {
  const match = content.trim().match(/^!steer\s+(TASK-\S+)\s+([\s\S]+)$/i);
  if (!match) return null;
  return { taskId: match[1], content: match[2].trim() };
}
