import type { AgentRole, ReviewVerdict } from "../runtime/types";

export function roleLabel(role: AgentRole): string {
  if (role === "builder") return "Builder";
  if (role === "factory") return "Factory";
  if (role === "designer") return "Designer";
  return "Director";
}

export function formatWorkerTurn(input: { role: AgentRole; output: string }): string {
  return `${roleLabel(input.role)}:\n${clip(input.output, 1700)}`;
}

export function formatReviewTurn(input: { verdict: ReviewVerdict; output?: string }): string {
  return `Director:\nReview: ${input.verdict}${input.output ? `\n${clip(input.output, 1200)}` : ""}`;
}

export function formatDoneTurn(input: { taskId: string; output?: string }): string {
  return `Director:\n${input.taskId} complete.${input.output ? `\n${clip(input.output, 1200)}` : ""}`;
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
