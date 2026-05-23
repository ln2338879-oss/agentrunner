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
