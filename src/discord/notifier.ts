import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config";
import type { AgentRole, ReviewVerdict } from "../runtime/types";

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
    await this.send(this.config.GAME_DIRECTOR_CHANNEL_ID, [
      `🎮 작업 생성: ${input.taskId}`,
      `담당 역할: ${input.role}`,
      `Obsidian Task: ${input.obsidianPath}`,
      `요청: ${trim(input.content, 500)}`,
    ].join("\n"));
  }

  async workerReport(input: { taskId: string; role: AgentRole; reportPath: string; round: number }): Promise<void> {
    const channelId = input.role === "builder" ? this.config.DEV_TASKS_CHANNEL_ID : input.role === "factory" ? this.config.CONTENT_FACTORY_CHANNEL_ID : this.config.REVIEW_LOG_CHANNEL_ID;
    await this.send(channelId, [
      `🛠️ ${input.role} round ${input.round} 완료: ${input.taskId}`,
      `Report: ${input.reportPath}`,
    ].join("\n"));
  }

  async reviewResult(input: { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number }): Promise<void> {
    await this.send(this.config.REVIEW_LOG_CHANNEL_ID, [
      `🔎 Director review round ${input.round}: ${input.taskId}`,
      `Verdict: ${input.verdict}`,
      `Review: ${input.reviewPath}`,
    ].join("\n"));
  }

  async approved(input: { taskId: string; approvedPath: string; reportPath: string; reviewPath: string }): Promise<void> {
    await this.send(this.config.REVIEW_LOG_CHANNEL_ID, [
      `✅ 승인 완료: ${input.taskId}`,
      `Approved: ${input.approvedPath}`,
      `Report: ${input.reportPath}`,
      `Review: ${input.reviewPath}`,
    ].join("\n"));
  }

  async blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {
    await this.send(this.config.REVIEW_LOG_CHANNEL_ID, [
      `🚫 차단됨: ${input.taskId}`,
      input.reviewPath ? `Review: ${input.reviewPath}` : undefined,
      input.reason ? `Reason: ${trim(input.reason, 800)}` : undefined,
    ].filter(Boolean).join("\n"));
  }

  async failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {
    await this.send(this.config.BUILD_LOG_CHANNEL_ID || this.config.REVIEW_LOG_CHANNEL_ID, [
      `❌ 실패: ${input.taskId}`,
      input.reportPath ? `Report: ${input.reportPath}` : undefined,
      input.reason ? `Reason: ${trim(input.reason, 800)}` : undefined,
    ].filter(Boolean).join("\n"));
  }

  async recovery(input: { count: number; path: string }): Promise<void> {
    await this.send(this.config.REVIEW_LOG_CHANNEL_ID || this.config.GAME_DIRECTOR_CHANNEL_ID, [
      `♻️ 시작 복구 완료: stale task ${input.count}개 차단 처리`,
      `Recovery note: ${input.path}`,
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
