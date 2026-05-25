import { Client, GatewayIntentBits, type Message } from "discord.js";
import { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import type { AgentRole } from "../runtime/types";
import { Orchestrator } from "../runtime/orchestrator";
import { persistAttachmentContext } from "./attachments";
import { handleDirectorCommand, isCommand, parseRetryCommand } from "./commands";

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

export function roleDisplayName(role: DiscordWorkerRole): string {
  if (role === "builder") return "Builder";
  if (role === "factory") return "Factory";
  return "Designer";
}

export function shouldProcessWorkerMessage(input: {
  configuredChannelId: string;
  messageChannelId: string;
  authorIsBot: boolean;
}): boolean {
  if (input.authorIsBot) return false;
  if (!input.configuredChannelId) return false;
  return input.messageChannelId === input.configuredChannelId;
}

export function roleRoutingInstruction(role: DiscordWorkerRole): string {
  if (role === "builder") {
    return "# Forced AgentRunner Role\nRoute this as a builder implementation/code/build/test task.\n\n# User Request";
  }

  if (role === "factory") {
    return "# Forced AgentRunner Role\nRoute this as a factory content/item/monster/NPC/dialogue/quest/JSON generation task.\n\n# User Request";
  }

  return "# Forced AgentRunner Role\nRoute this as a designer image/design/pixel art/sprite/icon/concept art task.\n\n# User Request";
}

export function createWorkerBot(input: {
  role: DiscordWorkerRole;
  token: string;
  channelId: string;
  config: RuntimeConfig;
  orchestrator: Orchestrator;
  store: RuntimeStore;
}): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", () => {
    const channelNote = input.channelId
      ? `listening on channel ${input.channelId}`
      : "message intake disabled: channel id is not configured";
    console.log(`[${input.role}] logged in as ${client.user?.tag ?? "unknown"}; ${channelNote}`);
  });

  client.on("messageCreate", async (message) => {
    if (
      !shouldProcessWorkerMessage({
        configuredChannelId: input.channelId,
        messageChannelId: message.channelId,
        authorIsBot: message.author.bot,
      })
    ) {
      return;
    }

    try {
      await handleWorkerMessage({
        message,
        role: input.role,
        orchestrator: input.orchestrator,
        store: input.store,
        config: input.config,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply(`${roleDisplayName(input.role)} bot failed: ${messageText}`);
    }
  });

  return client;
}

async function handleWorkerMessage(input: {
  message: Message;
  role: DiscordWorkerRole;
  orchestrator: Orchestrator;
  store: RuntimeStore;
  config: RuntimeConfig;
}): Promise<void> {
  const session = input.store.getOrCreateSession({
    discordChannelId: input.message.channelId,
    title: `${roleDisplayName(input.role)} Discord channel ${input.message.channelId}`,
  });

  const steer = parseSteeringCommand(input.message.content);
  if (steer) {
    input.store.recordSteeringMessage({
      id: `STEER-${Date.now()}`,
      taskId: steer.taskId,
      discordMessageId: input.message.id,
      content: steer.content,
    });
    await input.message.reply(`Steering queued for ${steer.taskId}.`);
    return;
  }

  if (isCommand(input.message.content) && !parseRetryCommand(input.message.content)) {
    const commandResult = await handleDirectorCommand({
      content: input.message.content,
      store: input.store,
    });
    if (commandResult) {
      await input.message.reply(commandResult);
      return;
    }
  }

  const attachmentContext = await persistAttachmentContext({
    attachments: input.message.attachments,
    attachmentsDir: input.config.ATTACHMENTS_DIR,
    messageId: input.message.id,
    maxAttachmentBytes: input.config.MAX_ATTACHMENT_BYTES,
  });
  const contentWithAttachments = withAttachmentContext(
    input.message.content,
    attachmentContext.markdown,
  );
  const retryTaskId = parseRetryCommand(input.message.content);

  if (retryTaskId) {
    const task = input.store.getTask(retryTaskId);
    if (!task) {
      await input.message.reply(`Task not found: ${retryTaskId}`);
      return;
    }

    const result = await input.orchestrator.handleUserRequest({
      content: withSessionContext(
        forceRoleContent(input.role, withAttachmentContext(buildRetryContent(retryTaskId, task), attachmentContext.markdown)),
        input.store,
        session.id,
      ),
      discordMessageId: input.message.id,
      discordChannelId: input.message.channelId,
    });
    await input.message.reply(
      formatTaskResult({
        result,
        prefix: `${roleDisplayName(input.role)} retry task created: ${result.taskId}\nSource task: ${retryTaskId}`,
      }),
    );
    return;
  }

  input.store.recordMessage({
    id: `MSG-${input.message.id}`,
    discordMessageId: input.message.id,
    discordChannelId: input.message.channelId,
    sessionId: session.id,
    senderRole: input.role,
    content: input.message.content,
  });

  const result = await input.orchestrator.handleUserRequest({
    content: withSessionContext(forceRoleContent(input.role, contentWithAttachments), input.store, session.id),
    discordMessageId: input.message.id,
    discordChannelId: input.message.channelId,
  });

  await input.message.reply(
    formatTaskResult({
      result,
      prefix: `${roleDisplayName(input.role)} task created: ${result.taskId}`,
    }),
  );
}

function forceRoleContent(role: DiscordWorkerRole, content: string): string {
  return [roleRoutingInstruction(role), "", content].join("\n");
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
    ...messages.map(
      (message) => `- ${message.createdAt} ${message.senderRole ?? "user"}: ${message.content}`,
    ),
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
    `Role: ${input.result.assignedTo}`,
    input.result.verdict ? `Director verdict: ${input.result.verdict}` : undefined,
    `Task note: ${input.result.obsidianPath}`,
    `Report: ${input.result.reportPath}`,
    input.result.reviewPath ? `Review: ${input.result.reviewPath}` : undefined,
    input.result.approvedPath ? `Final: ${input.result.approvedPath}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
