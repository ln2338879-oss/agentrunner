import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config";
import type { AgentRole, ReviewVerdict } from "../runtime/types";
import { statusChannel } from "./channels";
import type { RuntimeNotifier } from "./notifier";
import { formatDoneTurn, formatReviewTurn, formatWorkerTurn } from "./team-turns";

type WorkerInput = { taskId: string; role: AgentRole; reportPath: string; round: number; output?: string };
type ReviewInput = { taskId: string; verdict: ReviewVerdict; reviewPath: string; round: number; output?: string };
type DoneInput = { taskId: string; approvedPath: string; reportPath: string; reviewPath: string; output?: string };

export class TeamRoomNotifier implements RuntimeNotifier {
  constructor(
    private readonly directorClient: Client,
    private readonly config: RuntimeConfig,
    private readonly clients: Partial<Record<AgentRole, Client>> = {},
  ) {}

  async taskCreated(input: { taskId: string; role: AgentRole; obsidianPath: string; content: string }): Promise<void> {
    await this.status(input.role, `task ${input.taskId} ${input.role}`);
    await this.say("director", `Director:\n${input.taskId} assigned to ${label(input.role)}.`);
  }

  async workerReport(input: WorkerInput): Promise<void> {
    await this.status(input.role, `report ${input.taskId} ${input.reportPath}`);
    if (input.output) await this.say(input.role, formatWorkerTurn({ role: input.role, output: input.output }));
  }

  async reviewResult(input: ReviewInput): Promise<void> {
    await this.status("director", `review ${input.taskId} ${input.verdict}`);
    await this.say("director", formatReviewTurn({ verdict: input.verdict, output: input.output }));
  }

  async approved(input: DoneInput): Promise<void> {
    await this.status("director", `done ${input.taskId}`);
    await this.say("director", formatDoneTurn({ taskId: input.taskId, output: input.output }));
  }

  async blocked(input: { taskId: string; reviewPath?: string; reason?: string }): Promise<void> {
    await this.status("director", `hold ${input.taskId}`);
    await this.say("director", `Director:\n${input.taskId} needs attention.${input.reason ? `\n${clip(input.reason, 900)}` : ""}`);
  }

  async failed(input: { taskId: string; reportPath?: string; reason?: string }): Promise<void> {
    await this.status("builder", `error ${input.taskId}`);
    await this.say("director", `Director:\n${input.taskId} could not finish.${input.reason ? `\n${clip(input.reason, 900)}` : ""}`);
  }

  async recovery(input: { count: number; path: string }): Promise<void> {
    await this.status("director", `recovery ${input.count} ${input.path}`);
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
