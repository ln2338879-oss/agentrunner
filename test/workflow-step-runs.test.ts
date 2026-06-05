import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createTempStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-workflow-steps-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return store;
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("workflow step runs", () => {
  test("initializes workflow step rows when a task is created", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({ id: "TASK-STEPS-1", title: "Implement feature", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-STEPS-1.md", workflowPlan });

    const steps = store.listWorkflowStepRuns("TASK-STEPS-1");
    expect(steps.map((step) => step.stepId)).toEqual(["plan", "build", "review", "arbitrate-if-blocked"]);
    expect(steps.map((step) => step.status)).toEqual(["pending", "pending", "pending", "pending"]);
    expect(steps[1]?.workflowId).toBe("plan-build-review");
    expect(steps[1]?.role).toBe("builder");
    expect(steps[1]?.action).toBe("implement");
    expect(JSON.parse(steps[1]?.dependsOnJson ?? "[]")).toEqual(["plan"]);
  });

  test("updates workflow step status and output references", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "design");
    store.createTask({ id: "TASK-STEPS-2", title: "Create poster", type: "design", assignedTo: "designer", obsidianPath: "01_Tasks/TASK-STEPS-2.md", workflowPlan });

    store.updateWorkflowStepRun({ taskId: "TASK-STEPS-2", stepId: "design", status: "running", now: "2026-01-01T00:00:00.000Z" });
    store.updateWorkflowStepRun({ taskId: "TASK-STEPS-2", stepId: "design", status: "completed", outputRef: "06_DesignerOutputs/TASK-STEPS-2-designer-round-1.md", now: "2026-01-01T00:00:05.000Z" });

    const design = store.listWorkflowStepRuns("TASK-STEPS-2").find((step) => step.stepId === "design");
    expect(design?.status).toBe("completed");
    expect(design?.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(design?.finishedAt).toBe("2026-01-01T00:00:05.000Z");
    expect(design?.outputRef).toBe("06_DesignerOutputs/TASK-STEPS-2-designer-round-1.md");
  });

  test("includes workflow steps in dashboard status and task timeline", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "content");
    store.createTask({ id: "TASK-STEPS-3", title: "Generate content", type: "content", assignedTo: "factory", obsidianPath: "01_Tasks/TASK-STEPS-3.md", workflowPlan });
    store.updateWorkflowStepRun({ taskId: "TASK-STEPS-3", stepId: "generate", status: "completed", outputRef: "06_FactoryOutputs/TASK-STEPS-3-factory-round-1.md" });

    const status = store.getDashboardStatus();
    expect(status.workflowStepsByStatus.some((row) => row.status === "pending" && row.count >= 1)).toBe(true);
    expect(status.workflowStepsByStatus.some((row) => row.status === "completed" && row.count === 1)).toBe(true);
    const timeline = store.getTaskTimeline("TASK-STEPS-3");
    expect(timeline.map((event) => event.kind)).toContain("workflow_step");
    expect(timeline.find((event) => event.label.includes("generate"))?.path).toBe("06_FactoryOutputs/TASK-STEPS-3-factory-round-1.md");
  });

  test("claims a pending task only once", async () => {
    const store = await createTempStore();
    store.createTask({ id: "TASK-CLAIM-ONCE", title: "Claim once", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-CLAIM-ONCE.md" });

    const first = store.claimPendingTask({ role: "builder", owner: "worker:a", ttlMinutes: 30 });
    const second = store.claimPendingTask({ role: "builder", owner: "worker:b", ttlMinutes: 30 });

    expect(first?.id).toBe("TASK-CLAIM-ONCE");
    expect(first?.lockedBy).toBe("worker:a");
    expect(second).toBeNull();
    expect(store.getTask("TASK-CLAIM-ONCE")?.lockedBy).toBe("worker:a");
  });

  test("claims a ready workflow step only once", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({ id: "TASK-STEP-CLAIM-ONCE", title: "Step claim once", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-STEP-CLAIM-ONCE.md", workflowPlan });
    store.completeWorkflowStepRun({ taskId: "TASK-STEP-CLAIM-ONCE", stepId: "plan", outputRef: "01_Tasks/TASK-STEP-CLAIM-ONCE.md" });

    const first = store.claimReadyWorkflowStep({ roleId: "builder", owner: "worker:a", ttlMinutes: 30 });
    const second = store.claimReadyWorkflowStep({ roleId: "builder", owner: "worker:b", ttlMinutes: 30 });

    expect(first?.taskId).toBe("TASK-STEP-CLAIM-ONCE");
    expect(first?.stepId).toBe("build");
    expect(first?.lockedBy).toBe("worker:a");
    expect(second).toBeNull();
    expect(store.getWorkflowStepRun("TASK-STEP-CLAIM-ONCE", "build")?.lockedBy).toBe("worker:a");
  });

  test("records attempt ownership when claiming workflow steps", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({ id: "TASK-STEP-ATTEMPT-1", title: "Attempt ownership", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-STEP-ATTEMPT-1.md", workflowPlan });
    expect(store.completeWorkflowStepRun({ taskId: "TASK-STEP-ATTEMPT-1", stepId: "plan", outputRef: "01_Tasks/TASK-STEP-ATTEMPT-1.md" })).toBe(true);

    const first = store.claimReadyWorkflowStep({ roleId: "builder", owner: "worker:a", ttlMinutes: 1, now: "2026-01-01T00:00:00.000Z" });

    expect(first?.attemptNo).toBe(1);
    expect(first?.activeRunId).toMatch(/^RUN-/);
    expect(first?.lockedBy).toBe("worker:a");
  });

  test("creates a new attempt after a stale workflow step is requeued", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({ id: "TASK-STEP-ATTEMPT-2", title: "Attempt retry", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-STEP-ATTEMPT-2.md", workflowPlan });
    store.completeWorkflowStepRun({ taskId: "TASK-STEP-ATTEMPT-2", stepId: "plan", outputRef: "01_Tasks/TASK-STEP-ATTEMPT-2.md" });

    const first = store.claimReadyWorkflowStep({ roleId: "builder", owner: "worker:a", ttlMinutes: 1, now: "2026-01-01T00:00:00.000Z" });
    store.requeueWorkflowStepRun({ taskId: "TASK-STEP-ATTEMPT-2", stepId: "build", reason: "Recovered stale attempt.", now: "2026-01-01T00:02:00.000Z" });
    const second = store.claimReadyWorkflowStep({ roleId: "builder", owner: "worker:b", ttlMinutes: 1, now: "2026-01-01T00:02:01.000Z" });

    expect(first?.attemptNo).toBe(1);
    expect(second?.attemptNo).toBe(2);
    expect(second?.activeRunId).not.toBe(first?.activeRunId);
    expect(store.completeWorkflowStepRun({ taskId: "TASK-STEP-ATTEMPT-2", stepId: "build", owner: "worker:a", runId: first?.activeRunId, outputRef: "stale.md" })).toBe(false);
    expect(store.getWorkflowStepRun("TASK-STEP-ATTEMPT-2", "build")?.status).toBe("running");
    expect(store.getWorkflowStepRun("TASK-STEP-ATTEMPT-2", "build")?.outputRef).toBeNull();
  });

  test("uses continueOnFailure when checking workflow dependencies", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    workflowPlan.steps = workflowPlan.steps.map((step) => step.id === "review" ? { ...step, continueOnFailure: true } : step);

    store.createTask({ id: "TASK-CONTINUE-FAILURE", title: "Continue after failed review", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-CONTINUE-FAILURE.md", workflowPlan });
    store.completeWorkflowStepRun({ taskId: "TASK-CONTINUE-FAILURE", stepId: "plan", outputRef: "01_Tasks/TASK-CONTINUE-FAILURE.md" });
    store.completeWorkflowStepRun({ taskId: "TASK-CONTINUE-FAILURE", stepId: "build", outputRef: "05_BuilderReports/TASK-CONTINUE-FAILURE-build.md" });
    store.failWorkflowStepRun({ taskId: "TASK-CONTINUE-FAILURE", stepId: "review", error: "Reviewer blocked." });

    const arbiter = store.claimReadyWorkflowStep({ roleId: "arbiter", owner: "worker:director", ttlMinutes: 30 });

    expect(store.getWorkflowStepRun("TASK-CONTINUE-FAILURE", "review")?.continueOnFailure).toBe(1);
    expect(arbiter?.stepId).toBe("arbitrate-if-blocked");
  });

  test("blocks downstream claim when a failed dependency cannot continue", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({ id: "TASK-BLOCKED-DEPENDENCY", title: "Block after failed review", type: "implementation", assignedTo: "builder", obsidianPath: "01_Tasks/TASK-BLOCKED-DEPENDENCY.md", workflowPlan });
    store.completeWorkflowStepRun({ taskId: "TASK-BLOCKED-DEPENDENCY", stepId: "plan", outputRef: "01_Tasks/TASK-BLOCKED-DEPENDENCY.md" });
    store.completeWorkflowStepRun({ taskId: "TASK-BLOCKED-DEPENDENCY", stepId: "build", outputRef: "05_BuilderReports/TASK-BLOCKED-DEPENDENCY-build.md" });
    store.failWorkflowStepRun({ taskId: "TASK-BLOCKED-DEPENDENCY", stepId: "review", error: "Reviewer blocked." });

    const arbiter = store.claimReadyWorkflowStep({ roleId: "arbiter", owner: "worker:director", ttlMinutes: 30 });

    expect(store.getWorkflowStepRun("TASK-BLOCKED-DEPENDENCY", "review")?.continueOnFailure).toBe(0);
    expect(arbiter).toBeNull();
  });
});
