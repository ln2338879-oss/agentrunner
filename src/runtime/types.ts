export type AgentRole = "director" | "builder" | "factory";

export type TaskType = "planning" | "implementation" | "content" | "review";

export type TaskStatus =
  | "pending"
  | "running"
  | "needs_revision"
  | "completed"
  | "approved"
  | "blocked"
  | "failed";

export type ReviewVerdict = "APPROVED" | "NEEDS_REVISION" | "BLOCKED";

export interface RuntimeTask {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  assignedTo: AgentRole;
  obsidianPath: string;
  currentRound: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunInput {
  taskId: string;
  role: AgentRole;
  prompt: string;
  workspacePath?: string;
  filesToInspect?: string[];
}

export interface AgentRunResult {
  ok: boolean;
  output: string;
  artifacts?: string[];
  error?: string;
}

export interface AgentAdapter {
  role: AgentRole;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
