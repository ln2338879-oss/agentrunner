import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { reviewNote } from "../obsidian/templates";
import type { VaultManager } from "../obsidian/vault-manager";
import { parseReviewVerdict } from "./verdict";
import { buildDirectorReviewPrompt } from "../utils/prompt";
import type { AgentAdapter, AgentRole, ReviewVerdict } from "../runtime/types";

export async function runDirectorReview(input: {
  taskId: string;
  originalPrompt: string;
  workerRole: AgentRole;
  workerOutput: string;
  director: AgentAdapter;
  store: RuntimeStore;
  vault: VaultManager;
  config: RuntimeConfig;
}): Promise<{ verdict: ReviewVerdict; path: string; output: string }> {
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
  });

  const output = result.output || result.error || "Director review returned no output.";
  const verdict = result.ok ? parseReviewVerdict(output) : "BLOCKED";
  const path = `04_Reviews/${input.taskId}-review-round-1.md`;

  input.store.recordTaskRun({
    id: `RUN-${input.taskId}-director-${Date.now()}`,
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
    id: `REV-${input.taskId}-1-${Date.now()}`,
    taskId: input.taskId,
    verdict,
    round: 1,
    feedback: output,
  });

  await input.vault.writeNote(
    path,
    reviewNote({
      taskId: input.taskId,
      verdict,
      round: 1,
      body: output,
    }),
  );

  return { verdict, path, output };
}

export function statusFromVerdict(verdict: ReviewVerdict): "approved" | "needs_revision" | "blocked" {
  if (verdict === "APPROVED") return "approved";
  if (verdict === "NEEDS_REVISION") return "needs_revision";
  return "blocked";
}
