import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config";
import type { AgentRole, ReviewVerdict } from "../runtime/types";
import { statusChannel } from "./channels";
import type { RuntimeNotifier } from "./notifier";

export class TeamRoomNotifier implements RuntimeNotifier {
  constructor(
    private readonly directorClient: Client,
    private readonly config: RuntimeConfig,
    private readonly clients: Partial<Record<AgentRole, Client>> = {},
  ) {}

  async taskCreated(input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void> {
    await this.status(input.role, `task created: ${input.taskId}\nrole: ${input.role}\nnote: ${input.obsidianPath}`);
    await this.say("director", `Director:\nI received the request and assigned it to ${roleLabel(input.role)}.\nTask: ${input.taskId}`);
  }

  async workerReport(input: { taskId: string; role: AgentRole; reportPath: string; round: number }): Promise<void> {
    await this.status(input.role, `worker report: ${input.taskId}\nrole: ${input.role}\nround: ${input.round}\nreport: ${input.reportPath}`);
  }

  async reviewResult(input: { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number }): Promise<void> {
    await this.status("director", `director review: ${input.taskId}\nround: ${input.round}\nverdict: ${input.verdict}\nreview: ${input.reviewPath}`);
    await this.say("director", `Director:\nReview result for ${input.taskId}: ${input.verdict}`);
  }

  async approved(input: { taskId: string; approvedPath: string; reportPath: string; reviewPath: string }): Promise<void> {
    await this.status("director", `approved: ${input.taskId}\nfinal: ${input.approvedPath}`);
    await this.say("director", `Director:\nTask ${input.taskId} is complete.`);
  }

  async blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {
    await this.status("director", `stopped: ${input.taskId}${input.reason ? `\nreason: ${trim(input.reason, 800)}` : ""}`);
    await this.say("director", `Director:\nTask ${input.taskId} needs attention.${input.reason ? `\n${trim(input.reason, 900)}` : ""}`);
  }

  async failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {
    await this.status("builder", `failed: ${input.taskId}${input.reportPath ? `\nreport: ${input.reportPath}` : ""}`);
    await this.say("director", `Director:\nTask ${input.taskId} failed.${input.reason ? `\n${trim(input.reason, 900)}` : ""}`);
  }

  async recovery(input: { count: number; path: string }): Promise<void> {
    await this.status("director", `startup recovery: ${input.count}\nnote: ${input.path}`);
  }

  private async status(role: AgentRole, message: string): Promise<void> {
    await send(this.directorClient, statusChannel(this.config, role), message);
  }

  private async say(role: AgentRole, message: string): Promise<void> {
    await send(this.clients[role] ?? this.directorClient, this.config.GAME_DIRECTOR_CHANNEL_ID, message);
  }
}

async function send(client: Client, channelId: string, message: string): Promise<void> {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const sendable = channel as { send?: (content: string) => Promise<unknown> } | null;
  if (typeof sendable?.send !== "function") return;
  await sendable.send(message);
}

function roleLabel(role: AgentRole): string {
  if (role === "builder") return "Builder";
  if (role === "factory") return "Factory";
  if (role === "designer") return "Designer";
  return "Director";
}

function trim(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
