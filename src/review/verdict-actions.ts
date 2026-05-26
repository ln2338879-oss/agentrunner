import type { RuntimeStore } from "../db/runtime-store";
import type { RuntimeNotifier } from "../discord/notifier";
import type { VaultManager } from "../obsidian/vault-manager";
import type { ReviewVerdict, TaskType } from "../runtime/types";

export interface VerdictActionResult {
  status: "needs_human" | "split_task" | "blocked" | "failed";
  artifactPath?: string;
  childTaskIds?: string[];
}

export async function applyTerminalVerdictAction(input: {
  store: RuntimeStore;
  vault: VaultManager;
  notifier?: RuntimeNotifier;
  taskId: string;
  verdict: ReviewVerdict;
  feedback: string;
  reviewPath?: string;
  owner?: string;
  sourceStepId?: string;
}): Promise<VerdictActionResult> {
  if (input.verdict === "SPLIT_TASK") {
    return applySplitTaskAction(input);
  }

  if (input.verdict === "NEEDS_HUMAN" || input.verdict === "RETRY_WITH_DIFFERENT_AGENT") {
    return applyHumanInterventionAction(input);
  }

  const status = input.verdict === "BLOCKED" ? "blocked" : "failed";
  input.store.updateTaskStatus(input.taskId, status);
  input.store.recordRuntimeEvent({
    kind: "terminal_verdict",
    taskId: input.taskId,
    stepId: input.sourceStepId,
    owner: input.owner,
    message: `Terminal verdict ${input.verdict} applied with status=${status}.`,
    metadata: {
      verdict: input.verdict,
      reviewPath: input.reviewPath,
    },
  });
  return { status };
}

async function applyHumanInterventionAction(input: {
  store: RuntimeStore;
  vault: VaultManager;
  notifier?: RuntimeNotifier;
  taskId: string;
  verdict: ReviewVerdict;
  feedback: string;
  reviewPath?: string;
  owner?: string;
  sourceStepId?: string;
}): Promise<VerdictActionResult> {
  const artifactPath = `04_Reviews/${input.taskId}-${input.verdict.toLowerCase()}-action.md`;
  const reason = input.verdict === "RETRY_WITH_DIFFERENT_AGENT"
    ? "The reviewer requested a different agent/provider, but automatic provider switching is disabled. Human intervention is required."
    : "The reviewer requested human intervention.";

  await input.vault.writeNote(artifactPath, [
    "---",
    `task_id: ${input.taskId}`,
    `verdict: ${input.verdict}`,
    "status: needs_human",
    input.reviewPath ? `review_path: ${input.reviewPath}` : undefined,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    "# Human Intervention Required",
    "",
    reason,
    "",
    "## Review Feedback",
    "",
    input.feedback,
  ].filter(Boolean).join("\n"));

  input.store.updateTaskStatus(input.taskId, "needs_human");
  input.store.recordArtifact({
    id: `ART-${input.taskId}-${input.verdict.toLowerCase()}-${Date.now()}`,
    taskId: input.taskId,
    type: "human_intervention",
    path: artifactPath,
    createdBy: "director",
  });
  input.store.recordRuntimeEvent({
    kind: "human_intervention_required",
    taskId: input.taskId,
    stepId: input.sourceStepId,
    owner: input.owner,
    message: reason,
    metadata: {
      verdict: input.verdict,
      reviewPath: input.reviewPath,
      artifactPath,
    },
  });
  await input.notifier?.blocked({
    taskId: input.taskId,
    reviewPath: artifactPath,
    reason,
  });

  return { status: "needs_human", artifactPath };
}

async function applySplitTaskAction(input: {
  store: RuntimeStore;
  vault: VaultManager;
  notifier?: RuntimeNotifier;
  taskId: string;
  verdict: ReviewVerdict;
  feedback: string;
  reviewPath?: string;
  owner?: string;
  sourceStepId?: string;
}): Promise<VerdictActionResult> {
  const childPrompts = extractSplitTaskPrompts(input.feedback);
  const childTaskIds: string[] = [];
  const now = Date.now();

  for (const [index, prompt] of childPrompts.entries()) {
    const childTaskId = `TASK-${now}-S${index + 1}`;
    const title = prompt.slice(0, 60).replace(/\s+/g, " ") || `Split task ${index + 1}`;
    const obsidianPath = `01_Tasks/${childTaskId}.md`;
    const taskType = inferChildTaskType(prompt);

    input.store.createTask({
      id: childTaskId,
      title,
      type: taskType,
      assignedTo: "director",
      obsidianPath,
    });
    input.store.recordMessage({
      id: `MSG-${childTaskId}-${Date.now()}-${index}`,
      discordMessageId: `split-${input.taskId}-${index + 1}`,
      discordChannelId: "split-task",
      taskId: childTaskId,
      senderRole: "director",
      content: [
        `Parent task: ${input.taskId}`,
        input.reviewPath ? `Parent review: ${input.reviewPath}` : undefined,
        "",
        prompt,
      ].filter(Boolean).join("\n"),
    });
    await input.vault.writeNote(obsidianPath, [
      "---",
      `id: ${childTaskId}`,
      `parent_task_id: ${input.taskId}`,
      `type: ${taskType}`,
      "assigned_to: director",
      "status: pending",
      input.reviewPath ? `parent_review_path: ${input.reviewPath}` : undefined,
      `created_at: ${new Date().toISOString()}`,
      "---",
      "",
      `# ${title}`,
      "",
      `Parent task: ${input.taskId}`,
      input.reviewPath ? `Parent review: ${input.reviewPath}` : undefined,
      "",
      "## Split Task Request",
      "",
      prompt,
    ].filter(Boolean).join("\n"));
    childTaskIds.push(childTaskId);
  }

  const artifactPath = `04_Reviews/${input.taskId}-split-task-action.md`;
  await input.vault.writeNote(artifactPath, [
    "---",
    `task_id: ${input.taskId}`,
    "verdict: SPLIT_TASK",
    "status: split_task",
    `child_task_count: ${childTaskIds.length}`,
    input.reviewPath ? `review_path: ${input.reviewPath}` : undefined,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    "# Split Task Action",
    "",
    "The parent task was split into child planning tasks.",
    "",
    "## Child Tasks",
    "",
    childTaskIds.length > 0 ? childTaskIds.map((id) => `- ${id}`).join("\n") : "No child tasks could be extracted.",
    "",
    "## Original Review Feedback",
    "",
    input.feedback,
  ].filter(Boolean).join("\n"));

  input.store.updateTaskStatus(input.taskId, childTaskIds.length > 0 ? "split_task" : "needs_human");
  input.store.recordArtifact({
    id: `ART-${input.taskId}-split-task-${Date.now()}`,
    taskId: input.taskId,
    type: childTaskIds.length > 0 ? "split_task_plan" : "human_intervention",
    path: artifactPath,
    createdBy: "director",
  });
  input.store.recordRuntimeEvent({
    kind: childTaskIds.length > 0 ? "split_task_created" : "human_intervention_required",
    taskId: input.taskId,
    stepId: input.sourceStepId,
    owner: input.owner,
    message: childTaskIds.length > 0
      ? `Created ${childTaskIds.length} child task(s) from SPLIT_TASK verdict.`
      : "SPLIT_TASK verdict did not contain extractable child tasks; human intervention required.",
    metadata: {
      verdict: input.verdict,
      reviewPath: input.reviewPath,
      artifactPath,
      childTaskIds,
    },
  });

  if (childTaskIds.length === 0) {
    await input.notifier?.blocked({
      taskId: input.taskId,
      reviewPath: artifactPath,
      reason: "SPLIT_TASK verdict did not contain extractable child tasks.",
    });
    return { status: "needs_human", artifactPath, childTaskIds };
  }

  return { status: "split_task", artifactPath, childTaskIds };
}

export function extractSplitTaskPrompts(feedback: string): string[] {
  const lines = feedback
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .map((line) => line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter((line) => line.length >= 12)
    .filter((line) => !/^verdict:/i.test(line));

  if (candidates.length > 0) return dedupe(candidates).slice(0, 5);

  return feedback
    .split(/[.;]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20)
    .filter((part) => !/^verdict:/i.test(part))
    .slice(0, 3);
}

function inferChildTaskType(prompt: string): TaskType {
  if (/구현|코드|버그|테스트|fix|bug|code|test/i.test(prompt)) return "implementation";
  if (/이미지|디자인|포스터|스프라이트|로고|image|design|sprite|logo/i.test(prompt)) return "design";
  if (/아이템|몬스터|npc|csv|json|대사|퀘스트|item|monster|dialogue|quest/i.test(prompt)) return "content";
  return "planning";
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
