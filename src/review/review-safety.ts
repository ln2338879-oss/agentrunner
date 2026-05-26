import type { RuntimeConfig } from "../config";
import { runShellCommand } from "../utils/command";

export interface ReviewSafetySnapshot {
  supported: boolean;
  status: string;
  reason?: string;
}

export interface ReviewSafetyResult {
  ok: boolean;
  before: ReviewSafetySnapshot;
  after: ReviewSafetySnapshot;
  violation?: string;
}

export async function captureReviewSafetySnapshot(workspacePath: string): Promise<ReviewSafetySnapshot> {
  const insideWorkTree = await runShellCommand({
    command: "git rev-parse --is-inside-work-tree",
    cwd: workspacePath,
    timeoutMs: 30000,
  });

  if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
    return {
      supported: false,
      status: "",
      reason: "Workspace is not a git work tree; read-only mutation guard is skipped.",
    };
  }

  const status = await runShellCommand({
    command: "git status --porcelain=v1 --untracked-files=all",
    cwd: workspacePath,
    timeoutMs: 30000,
  });

  return {
    supported: true,
    status: normalizeStatus(status.stdout || status.stderr),
    reason: status.ok ? undefined : "Failed to capture git status snapshot.",
  };
}

export function compareReviewSafetySnapshots(
  before: ReviewSafetySnapshot,
  after: ReviewSafetySnapshot,
): ReviewSafetyResult {
  if (!before.supported || !after.supported) {
    return { ok: true, before, after };
  }

  if (before.status === after.status) {
    return { ok: true, before, after };
  }

  return {
    ok: false,
    before,
    after,
    violation: [
      "READ_ONLY_VIOLATION: Review or arbitration step changed the workspace.",
      "Reviewer-family steps must inspect and decide only; they must not modify project files.",
      "",
      "## Before git status",
      before.status || "<clean>",
      "",
      "## After git status",
      after.status || "<clean>",
    ].join("\n"),
  };
}

export async function buildReviewSafetyContext(input: {
  workspacePath: string;
  config: RuntimeConfig;
}): Promise<string> {
  const sections = [
    "## Review Safety Contract",
    "- You are in read-only review mode.",
    "- Do not create, edit, delete, move, format, or commit files.",
    "- Inspect dependency outputs, validation results, and diffs only.",
    "- If changes are needed, return VERDICT: NEEDS_REVISION with concrete fixes for Builder.",
    "- If the task cannot be reviewed safely, return VERDICT: BLOCKED or NEEDS_HUMAN.",
  ];

  if (!input.config.REVIEW_DIFF_COMMAND) return sections.join("\n");

  const result = await runShellCommand({
    command: input.config.REVIEW_DIFF_COMMAND,
    cwd: input.workspacePath,
    timeoutMs: input.config.REVIEW_CONTEXT_COMMAND_TIMEOUT_MS,
  });

  sections.push(
    "",
    "## Workspace Diff / Static Review Context",
    `Command: ${input.config.REVIEW_DIFF_COMMAND}`,
    `Status: ${result.ok ? "PASSED" : "FAILED"}`,
    "",
    "```text",
    trimLongOutput(result.stdout || result.stderr || "No diff output."),
    "```",
  );

  return sections.join("\n");
}

function normalizeStatus(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort()
    .join("\n");
}

function trimLongOutput(value: string, maxLength = 16000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}
