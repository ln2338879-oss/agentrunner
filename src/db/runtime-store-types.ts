import type { ReviewVerdict } from "../runtime/types";

export type WorkflowStepRunStatus = "pending" | "running" | "completed" | "skipped" | "failed";
export type StartupRecoveryMode = "requeue" | "block";

export interface TaskSummaryRow {
  id: string;
  title: string;
  type: string;
  status: string;
  assignedTo: string;
  currentRound: number;
  obsidianPath: string;
  workflowId: string | null;
  workflowPlanJson: string | null;
  sessionId: string | null;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRow {
  type: string;
  path: string;
  createdBy: string;
  createdAt: string;
}

export interface ReviewRow {
  verdict: ReviewVerdict;
  round: number;
  feedback: string;
  createdAt: string;
}

export interface TaskRunRow {
  id: string;
  taskId: string;
  role: string;
  model: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface WorkflowStepRunRow {
  id: string;
  taskId: string;
  workflowId: string;
  stepId: string;
  stepIndex: number;
  role: string;
  resolvedRoleId: string;
  action: string;
  status: WorkflowStepRunStatus;
  dependsOnJson: string;
  required: number;
  requiresReview: number;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outputRef: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimelineEvent {
  kind: "task" | "workflow_step" | "run" | "review" | "artifact";
  label: string;
  status?: string;
  role?: string;
  path?: string;
  createdAt: string;
}

export interface DashboardStatus {
  generatedAt: string;
  totals: {
    tasks: number;
    openTasks: number;
    blockedTasks: number;
    approvedTasks: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byRole: Array<{ role: string; status: string; count: number }>;
  workflowStepsByStatus: Array<{ status: string; count: number }>;
  recentFailures: Array<{ id: string; title: string; status: string; assignedTo: string; updatedAt: string }>;
  activeLocks: Array<{ id: string; title: string; assignedTo: string; lockedBy: string | null; lockExpiresAt: string | null }>;
}

export interface SessionRow {
  id: string;
  discordChannelId: string;
  title: string;
  status: string;
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SteeringMessageRow {
  id: string;
  taskId: string;
  discordMessageId: string;
  content: string;
  createdAt: string;
}
