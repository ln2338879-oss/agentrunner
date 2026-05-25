export function buildCliPrompt(input: {
  role: string;
  taskId: string;
  prompt: string;
  workspacePath?: string;
}): string {
  return [
    `You are the ${input.role} agent in AgentRunner.`,
    `Task ID: ${input.taskId}`,
    input.workspacePath ? `Workspace: ${input.workspacePath}` : undefined,
    "",
    "Follow the role contract exactly. Return concise Markdown with clear sections.",
    "",
    "User task:",
    input.prompt,
  ].filter(Boolean).join("\n");
}

export function buildDirectorReviewPrompt(input: {
  taskId: string;
  originalPrompt: string;
  workerRole: string;
  workerOutput: string;
}): string {
  return [
    "You are the Director reviewer for AgentRunner.",
    `Task ID: ${input.taskId}`,
    `Worker role: ${input.workerRole}`,
    "",
    "Review the worker result. You must start with exactly one verdict line:",
    "VERDICT: APPROVED",
    "VERDICT: NEEDS_REVISION",
    "VERDICT: BLOCKED",
    "VERDICT: NEEDS_HUMAN",
    "VERDICT: SPLIT_TASK",
    "VERDICT: RETRY_WITH_DIFFERENT_AGENT",
    "",
    "Use APPROVED only when the output fully satisfies the request.",
    "Use NEEDS_REVISION when the same worker can fix concrete issues in another round.",
    "Use BLOCKED when the task cannot continue safely or lacks critical information.",
    "Use NEEDS_HUMAN when explicit user approval, credentials, or a human decision is required.",
    "Use SPLIT_TASK when the request should be decomposed into smaller tasks before continuing.",
    "Use RETRY_WITH_DIFFERENT_AGENT when another role/provider is more appropriate than the current worker.",
    "",
    "Then explain the reason and, if needed, list concrete fixes.",
    "",
    "Original user request:",
    input.originalPrompt,
    "",
    "Worker output:",
    input.workerOutput,
  ].join("\n");
}
