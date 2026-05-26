import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config";
import type { AgentRole, ReviewVerdict } from "../runtime/types";
import { statusChannel } from "./channels";

export interface RuntimeNotifier {
  taskCreated(input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void>;
  workerReport(input: { taskId: string; role: AgentRole; reportPath: string; round: number }): Promise<void>;
  reviewResult(input: { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number }): Promise<void>;
  approved(input: { taskId: string; approvedPath: string; reportPath: string; reviewPath: string }): Promise<void>;
  blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void>;
  failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void>;
  recovery(input: { count: number; path: string }): Promise<void>;
}

export class NullNotifier implements RuntimeNotifier {
  async taskCreated(_input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void> {}
  async workerReport(_input: { taskId: string; role: AgentRole; reportPath: string; round: number }): Promise<void> {}
  async reviewResult(_input: { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number }): Promise<void> {}
  async approved(_input: { taskId: string; approvedPath: string; reportPath: string; reviewPath: string }): Promise<void> {}
  async blocked(_input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {}
  async failed(_input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {}
  async recovery(_input: { count: number; path: string }): Promise<void> {}
}

export class DiscordNotifier implements RuntimeNotifier {
  constructor(
    private readonly client: Client,
    private readonly config: RuntimeConfig,
  ) {}

  async taskCreated(input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void> {
    await this.send(statusChannel(this.config, input.role), [
      `task created: ${input.taskId}`,
      `role: ${input.role}`,
      `note: ${input.obsidianPath}`,
      `request: ${trim(input.content, 500)}`,
    ].join("\n"));
  }

  async workerReport(input: { taskId: string; role: AgentRole; reportPath: string; round: number }): Promise<void> {
    await this.send(statusChannel(this.config, input.role), [
      `worker report: ${input.taskId}`,
      `role: ${input.role}`,
      `round: ${input.round}`,
      `report: ${input.reportPath}`,
    ].join("\n"));
  }

  async reviewResult(input: { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number }): Promise<void> {
    await this.send(statusChannel(this.config, "director"), [
      `director review: ${input.taskId}`,
      `round: ${input.round}`,
      `verdict: ${input.verdict}`,
      `review: ${input.reviewPath}`,
    ].join("\n"));
  }

  async approved(input: { taskId: string; approvedPath: string; reportPath: string; reviewPath: string }): Promise<void> {
    await this.send(statusChannel(this.config, "director"), [
      `approved: ${input.taskId}`,
      `final: ${input.approvedPath}`,
      `report: ${input.reportPath}`,
      `review: ${input.reviewPath}`,
    ].join("\n"));
  }

  async blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {
    await this.send(statusChannel(this.config, "director"), [
      `blocked: ${input.taskId}`,
      input.reviewPath ? `review: ${input.reviewPath}` : undefined,
      input.reason ? `reason: ${trim(input.reason, 800)}` : undefined,
    ].filter(Boolean).join("\n"));
  }

  async failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {
    await this.send(statusChannel(this.config, "builder"), [
      `failed: ${input.taskId}`,
      input.reportPath ? `report: ${input.reportPath}` : undefined,
      input.reason ? `reason: ${trim(input.reason, 800)}` : undefined,
    ].filter(Boolean).join("\n"));
  }

  async recovery(input: { count: number; path: string }): Promise<void> {
    await this.send(statusChannel(this.config, "director"), [
      `startup recovery: ${input.count} task(s) updated`,
      `note: ${input.path}`,
    ].join("\n"));
  }

  private async send(channelId: string, message: string): Promise<void> {
    if (!channelId) return;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    const sendable = channel as { send?: (content: string) => Promise<unknown> } | null;
    if (typeof sendable?.send !== "function") return;
    await sendable.send(message);
  }
}

function trim(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
