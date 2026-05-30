import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { reviewNote } from "../obsidian/templates";
import type { VaultManager } from "../obsidian/vault-manager";
import { isTerminalReviewVerdict, parseReviewVerdict, statusFromReviewVerdict } from "./verdict";
import { buildDirectorReviewPrompt } from "../utils/prompt";
import type { AgentAdapter, AgentRole, ReviewVerdict, TaskStatus } from "../runtime/types";

export async function runDirectorReview(input: {
  taskId: string;
  originalPrompt: string;
  workerRole: AgentRole;
  workerOutput: string;
  director: AgentAdapter;
  store: RuntimeStore;
  vault: VaultManager;
  config: RuntimeConfig;
  round?: number;
}): Promise<{ verdict: ReviewVerdict; path: string; output: string }> {
  const round = input.round ?? 1;
  const prompt = buildDirectorReviewPrompt({
    taskId: input.taskId,
    originalPrompt: input.originalPrompt,
    workerRole: input.workerRole,
    workerOutput: input.workerOutput,
  });

  const startedAt = new Date().toISOString();
  const result = await input.director.run({
    taskId: input.taskId,
    role: "director",
    prompt,
    workspacePath: input.config.PROJECT_ROOT,
    runtimeConfig: input.config,
  });

  const output = result.output || result.error || "Director review returned no output.";
  const verdict = result.ok ? parseReviewVerdict(output) : "BLOCKED";
  const path = `04_Reviews/${input.taskId}-review-round-${round}.md`;

  input.store.recordTaskRun({
    id: `RUN-${input.taskId}-director-r${round}-${Date.now()}`,
    taskId: input.taskId,
    role: "director",
    model: input.config.CLAUDE_CODE_COMMAND,
    prompt,
    output,
    status: result.ok ? "completed" : "failed",
    error: result.error,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  input.store.recordReview({
    id: `REV-${input.taskId}-${round}-${Date.now()}`,
    taskId: input.taskId,
    verdict,
    round,
    feedback: output,
  });

  await input.vault.writeNote(
    path,
    reviewNote({
      taskId: input.taskId,
      verdict,
      round,
      body: output,
    }),
  );

  return { verdict, path, output };
}

export function statusFromVerdict(verdict: ReviewVerdict): TaskStatus {
  return statusFromReviewVerdict(verdict);
}

export { isTerminalReviewVerdict };
