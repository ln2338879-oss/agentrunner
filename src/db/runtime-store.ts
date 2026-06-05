import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import { extendedRuntimeSchemaSql } from "./extended-schema";
import type {
  ArtifactRow,
  DashboardStatus,
  ReviewRow,
  SessionRow,
  SteeringMessageRow,
  TaskRunRow,
  TaskSummaryRow,
  TaskTimelineEvent,
  VerificationEvidenceKind,
  VerificationEvidenceRow,
  VerificationEvidenceStatus,
  WorkflowStepRunRow,
  WorkflowStepRunStatus,
  StartupRecoveryMode,
} from "./runtime-store-types";
export type {
  ArtifactRow,
  DashboardStatus,
  ReviewRow,
  SessionRow,
  SteeringMessageRow,
  TaskRunRow,
  TaskSummaryRow,
  TaskTimelineEvent,
  VerificationEvidenceKind,
  VerificationEvidenceRow,
  VerificationEvidenceStatus,
  WorkflowStepRunRow,
  WorkflowStepRunStatus,
  StartupRecoveryMode,
} from "./runtime-store-types";
import type { AgentRole, ReviewVerdict, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";
import type { WorkflowPlan } from "../workflows/types";
import * as reviewStore from "./runtime-store/reviews";
import * as runtimeEventStore from "./runtime-store/runtime-events";
import * as sessionMessageStore from "./runtime-store/sessions-messages";
import * as taskStore from "./runtime-store/tasks";
import * as workflowStepStore from "./runtime-store/workflow-steps";

export interface StartupRecoveryRow {
  taskId: string;
  taskStatus: string;
  stepId: string | null;
  stepStatus: string | null;
  role: string | null;
  lockedBy: string | null;
  lockExpiresAt: string | null;
}

export interface WorkerHeartbeatRow {
  owner: string;
  role: string;
  pid: number | null;
  status: string;
  lastSeenAt: string;
  metadataJson: string | null;
}

export class RuntimeStore {
  private readonly db: Database;

  constructor(private readonly databasePath: string) {
    this.db = new Database(databasePath);
  }

  static async open(databasePath: string): Promise<RuntimeStore> {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const store = new RuntimeStore(databasePath);
    store.migrate();
    return store;
  }

  migrate(): void {
    this.db.exec(runtimeSchemaSql);
    this.db.exec(extendedRuntimeSchemaSql);
    this.ensureColumn("tasks", "session_id", "TEXT");
    this.ensureColumn("tasks", "group_id", "TEXT");
    this.ensureColumn("tasks", "workflow_id", "TEXT");
    this.ensureColumn("tasks", "workflow_plan_json", "TEXT");
    this.ensureColumn("messages", "session_id", "TEXT");
    this.ensureColumn("attachments", "local_path", "TEXT");
    this.ensureColumn("attachments", "kind", "TEXT");
    this.ensureColumn("workflow_step_runs", "locked_by", "TEXT");
    this.ensureColumn("workflow_step_runs", "lock_expires_at", "TEXT");
    this.ensureColumn("workflow_step_runs", "continue_on_failure", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("workflow_step_runs", "attempt_no", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("workflow_step_runs", "active_run_id", "TEXT");
  }

  close(): void {
    this.db.close();
  }

  createTask(input: {
    id: string;
    title: string;
    type: TaskType;
    assignedTo: AgentRole;
    obsidianPath: string;
    sessionId?: string;
    groupId?: string;
    workflowPlan?: WorkflowPlan;
  }): RuntimeTask {
    return taskStore.createTask(this.db, {
      ...input,
      initializeWorkflowStepRuns: (workflowInput) => this.initializeWorkflowStepRuns(workflowInput),
    });
  }

  initializeWorkflowStepRuns(input: { taskId: string; workflowPlan: WorkflowPlan }): void {
    workflowStepStore.initializeWorkflowStepRuns(this.db, input);
  }

  claimReadyWorkflowStep(input: {
    roleId: string;
    owner: string;
    ttlMinutes: number;
    now?: string;
  }): WorkflowStepRunRow | null {
    return workflowStepStore.claimReadyWorkflowStep(this.db, input);
  }

  completeWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    owner?: string;
    runId?: string | null;
    outputRef?: string;
    now?: string;
  }): boolean {
    return workflowStepStore.completeWorkflowStepRun(this.db, input);
  }

  failWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    owner?: string;
    runId?: string | null;
    outputRef?: string;
    error?: string;
    now?: string;
  }): boolean {
    return workflowStepStore.failWorkflowStepRun(this.db, input);
  }

  releaseWorkflowStepLease(input: { taskId: string; stepId: string; owner: string }): void {
    workflowStepStore.releaseWorkflowStepLease(this.db, input);
  }

  refreshWorkflowStepLease(input: {
    taskId: string;
    stepId: string;
    owner: string;
    ttlMinutes: number;
    now?: string;
  }): boolean {
    return workflowStepStore.refreshWorkflowStepLease(this.db, input);
  }

  updateWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    status: WorkflowStepRunStatus;
    outputRef?: string;
    error?: string;
    now?: string;
  }): void {
    workflowStepStore.updateWorkflowStepRun(this.db, input);
  }

  requeueWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    reason?: string;
    now?: string;
  }): void {
    workflowStepStore.requeueWorkflowStepRun(this.db, input);
  }

  getWorkflowStepRun(taskId: string, stepId: string): WorkflowStepRunRow | null {
    return workflowStepStore.getWorkflowStepRun(this.db, taskId, stepId);
  }

  listWorkflowStepRuns(taskId: string): WorkflowStepRunRow[] {
    return workflowStepStore.listWorkflowStepRuns(this.db, taskId);
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    taskStore.updateTaskStatus(this.db, id, status);
  }

  transitionTaskStatus(id: string, status: TaskStatus): boolean {
    return taskStore.transitionTaskStatus(this.db, id, status);
  }

  setTaskReviewRound(id: string, round: number): void {
    taskStore.setTaskReviewRound(this.db, id, round);
  }

  getTask(id: string): TaskSummaryRow | null {
    return taskStore.getTask(this.db, id);
  }

  listRecentTasks(limit = 10): TaskSummaryRow[] {
    return taskStore.listRecentTasks(this.db, limit);
  }

  getDashboardStatus(): DashboardStatus {
    return taskStore.getDashboardStatus(this.db);
  }

  claimPendingTask(input: {
    role: AgentRole;
    owner: string;
    ttlMinutes: number;
  }): TaskSummaryRow | null {
    return taskStore.claimPendingTask(this.db, { ...input, getTask: (id) => this.getTask(id) });
  }

  getTaskPrompt(taskId: string): string {
    return sessionMessageStore.getTaskPrompt(
      this.db,
      taskId,
      () => this.getTask(taskId)?.title ?? "",
    );
  }

  getOrCreateSession(input: {
    discordChannelId: string;
    title: string;
    groupId?: string;
  }): SessionRow {
    return sessionMessageStore.getOrCreateSession(this.db, input);
  }

  listRecentSessionMessages(
    sessionId: string,
    limit = 8,
  ): Array<{ content: string; senderRole: string | null; createdAt: string }> {
    return sessionMessageStore.listRecentSessionMessages(this.db, sessionId, limit);
  }

  recordSteeringMessage(input: {
    id: string;
    taskId: string;
    discordMessageId: string;
    content: string;
  }): void {
    sessionMessageStore.recordSteeringMessage(this.db, input);
  }

  consumeSteeringMessages(taskId: string): SteeringMessageRow[] {
    return sessionMessageStore.consumeSteeringMessages(this.db, taskId);
  }

  listTaskArtifacts(taskId: string): ArtifactRow[] {
    return reviewStore.listTaskArtifacts(this.db, taskId);
  }

  listVerificationEvidence(taskId: string): VerificationEvidenceRow[] {
    return reviewStore.listVerificationEvidence(this.db, taskId);
  }

  listTaskReviews(taskId: string): ReviewRow[] {
    return reviewStore.listTaskReviews(this.db, taskId);
  }

  listTaskRuns(taskId: string): TaskRunRow[] {
    return reviewStore.listTaskRuns(this.db, taskId);
  }

  getTaskTimeline(taskId: string): TaskTimelineEvent[] {
    const task = this.getTask(taskId);
    if (!task) return [];

    const events: TaskTimelineEvent[] = [
      {
        kind: "task",
        label: `Task created: ${task.title}`,
        status: task.status,
        role: task.assignedTo,
        path: task.obsidianPath,
        createdAt: task.createdAt,
      },
      ...this.listWorkflowStepRuns(taskId).map(
        (step): TaskTimelineEvent => ({
          kind: "workflow_step",
          label: `Workflow step ${step.stepIndex + 1}: ${step.stepId}`,
          status: step.status,
          role: step.role,
          path: step.outputRef ?? undefined,
          createdAt: step.startedAt ?? step.updatedAt,
        }),
      ),
      ...this.listTaskRuns(taskId).map(
        (run): TaskTimelineEvent => ({
          kind: "run",
          label: `Run ${run.id}`,
          status: run.status,
          role: run.role,
          createdAt: run.startedAt,
        }),
      ),
      ...this.listTaskReviews(taskId).map(
        (review): TaskTimelineEvent => ({
          kind: "review",
          label: `Review round ${review.round}: ${review.verdict}`,
          status: review.verdict,
          role: "director",
          createdAt: review.createdAt,
        }),
      ),
      ...this.listTaskArtifacts(taskId).map(
        (artifact): TaskTimelineEvent => ({
          kind: "artifact",
          label: artifact.type,
          role: artifact.createdBy,
          path: artifact.path,
          createdAt: artifact.createdAt,
        }),
      ),
    ];

    return events.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  acquireTaskLease(input: { taskId: string; owner: string; ttlMinutes: number }): boolean {
    return taskStore.acquireTaskLease(this.db, input);
  }

  refreshTaskLease(input: { taskId: string; owner: string; ttlMinutes: number }): void {
    taskStore.refreshTaskLease(this.db, input);
  }

  releaseTaskLease(input: { taskId: string; owner: string }): void {
    taskStore.releaseTaskLease(this.db, input);
  }

  recoverStaleTasks(input: {
    staleMinutes: number;
  }): Array<{ id: string; status: string; lockedBy: string | null }> {
    return taskStore.recoverStaleTasks(this.db, input);
  }

  recoverInterruptedWorkflowSteps(input: {
    staleMinutes: number;
    mode: StartupRecoveryMode;
  }): StartupRecoveryRow[] {
    return workflowStepStore.recoverInterruptedWorkflowSteps(this.db, {
      ...input,
      getTask: (id) => this.getTask(id),
    });
  }

  recordRuntimeEvent(input: {
    kind: string;
    taskId?: string;
    stepId?: string;
    owner?: string;
    message: string;
    metadata?: unknown;
  }): void {
    runtimeEventStore.recordRuntimeEvent(this.db, input);
  }

  upsertWorkerHeartbeat(input: {
    owner: string;
    role: AgentRole | "scheduler";
    pid?: number;
    status: string;
    metadata?: unknown;
  }): void {
    runtimeEventStore.upsertWorkerHeartbeat(this.db, input);
  }

  recordTaskRun(input: {
    id: string;
    taskId: string;
    role: AgentRole;
    model?: string;
    prompt: string;
    output?: string;
    status: "running" | "completed" | "failed";
    error?: string;
    startedAt: string;
    finishedAt?: string;
  }): void {
    reviewStore.recordTaskRun(this.db, input);
  }

  recordArtifact(input: {
    id: string;
    taskId: string;
    type: string;
    path: string;
    createdBy: AgentRole;
  }): void {
    reviewStore.recordArtifact(this.db, input);
  }

  recordVerificationEvidence(input: {
    id: string;
    taskId: string;
    stepId?: string;
    kind: VerificationEvidenceKind;
    command?: string;
    status: VerificationEvidenceStatus;
    artifactPath?: string;
    summary: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): void {
    reviewStore.recordVerificationEvidence(this.db, input);
  }

  recordReview(input: {
    id: string;
    taskId: string;
    verdict: ReviewVerdict;
    round: number;
    feedback: string;
  }): void {
    reviewStore.recordReview(this.db, input);
  }

  recordMessage(input: {
    id: string;
    discordMessageId: string;
    discordChannelId: string;
    taskId?: string;
    sessionId?: string;
    senderRole?: AgentRole;
    content: string;
  }): void {
    sessionMessageStore.recordMessage(this.db, input);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
