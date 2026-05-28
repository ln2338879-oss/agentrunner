import type { RuntimeConfig } from "../config";

export type AgentRole = "director" | "builder" | "factory" | "designer";

export type TaskType = "planning" | "implementation" | "content" | "design" | "review";

export type TaskStatus =
  | "pending"
  | "running"
  | "needs_revision"
  | "needs_human"
  | "split_task"
  | "retry_with_different_agent"
  | "completed"
  | "approved"
  | "blocked"
  | "failed";

export type ReviewVerdict =
  | "APPROVED"
  | "NEEDS_REVISION"
  | "BLOCKED"
  | "NEEDS_HUMAN"
  | "SPLIT_TASK"
  | "RETRY_WITH_DIFFERENT_AGENT";

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
  runtimeConfig?: RuntimeConfig;
  filesToInspect?: string[];
}

export interface AgentRunResult {
  ok: boolean;
  output: string;
  artifacts?: string[];
  error?: string;
  errorKind?: string;
  needsHuman?: boolean;
}

export interface AgentAdapter {
  role: AgentRole;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
