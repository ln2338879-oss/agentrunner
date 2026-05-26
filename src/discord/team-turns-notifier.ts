import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config";
import type { AgentRole, ReviewVerdict } from "../runtime/types";
import { statusChannel } from "./channels";
import type { RuntimeNotifier } from "./notifier";
import { formatDoneTurn, formatReviewTurn, formatWorkerTurn } from "./team-turns";

type WorkerInput = { taskId: string; role: AgentRole; reportPath: string; round: number; output?: string };
type ReviewInput = { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number; output?: string };
type DoneInput = { taskId: string; approvedPath: string; reportPath: string; reviewPath: string; output?: string };

export class TeamTurnsNotifier implements RuntimeNotifier {
  constructor(
    private readonly director: Client,
    private readonly config: RuntimeConfig,
    private readonly clients: Partial<Record<AgentRole, Client>> = {},
  ) {}

  async taskCreated(input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void> {
    await this.log(input.role, `task ${input.taskId} -> ${input.role}`);
    await this.room("director", `Director:\n${input.taskId} assigned to ${label(input.role)}.`);
  }

  async workerReport(input: WorkerInput): Promise<void> {
    await this.log(input.role, `report ${input.taskId} ${input.reportPath}`);
    if (input.output) await this.room(input.role, formatWorkerTurn({ role: input.role, output: input.output }));
  }

  async reviewResult(input: ReviewInput): Promise<void> {
    await this.log("director", `review ${input.taskId} ${input.verdict}`);
    await this.room("director", formatReviewTurn({ verdict: input.verdict, output: input.output }));
  }

  async approved(input: DoneInput): Promise<void> {
    await this.log("director", `done ${input.taskId}`);
    await this.room("director", formatDoneTurn({ taskId: input.taskId, output: input.output }));
  }

  async blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {
    await this.log("director", `hold ${input.taskId}`);
    await this.room("director", `Director:\n${input.taskId} is waiting.${input.reason ? `\n${clip(input.reason, 900)}` : ""}`);
  }

  async failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {
    await this.log("builder", `stop ${input.taskId}`);
    await this.room("director", `Director:\n${input.taskId} stopped.${input.reason ? `\n${clip(input.reason, 900)}` : ""}`);
  }

  async recovery(input: { count: number; path: string }): Promise<void> {
    await this.log("director", `recovery ${input.count} ${input.path}`);
  }

  private async log(role: AgentRole, text: string): Promise<void> {
    await send(this.director, statusChannel(this.config, role), text);
  }

  private async room(role: AgentRole, text: string): Promise<void> {
    await send(this.clients[role] ?? this.director, this.config.GAME_DIRECTOR_CHANNEL_ID, text);
  }
}

async function send(client: Client, channelId: string, text: string): Promise<void> {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const sendable = channel as { send?: (content: string) => Promise<unknown> } | null;
  if (typeof sendable?.send !== "function") return;
  await sendable.send(text);
}

function label(role: AgentRole): string {
  if (role === "builder") return "Builder";
  if (role === "factory") return "Factory";
  if (role === "designer") return "Designer";
  return "Director";
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
