import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { handleDashboardRequest } from "../src/dashboard/server";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createTempStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-dashboard-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return store;
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

async function readJson(response: Response): Promise<any> {
  return await response.json();
}

describe("dashboard status", () => {
  test("returns runtime status summary", async () => {
    const store = await createTempStore();
    store.createTask({
      id: "TASK-DASH-1",
      title: "Build feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-DASH-1.md",
      workflowPlan: createDefaultWorkflowRegistry().plan(undefined, "implementation"),
    });
    store.updateTaskStatus("TASK-DASH-1", "blocked");

    const response = handleDashboardRequest(new Request("http://localhost/api/status"), store);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.totals.tasks).toBe(1);
    expect(body.totals.blockedTasks).toBe(1);
    expect(body.byStatus).toContainEqual({ status: "blocked", count: 1 });
    expect(body.byRole).toContainEqual({ role: "builder", status: "blocked", count: 1 });
    expect(body.workflowStepsByStatus).toContainEqual({ status: "pending", count: 4 });
    expect(body.recentFailures[0].id).toBe("TASK-DASH-1");
  });

  test("returns task details with workflow steps, runs, and timeline", async () => {
    const store = await createTempStore();
    store.createTask({
      id: "TASK-DASH-2",
      title: "Generate content",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-DASH-2.md",
      workflowPlan: createDefaultWorkflowRegistry().plan(undefined, "content"),
    });
    store.updateWorkflowStepRun({
      taskId: "TASK-DASH-2",
      stepId: "generate",
      status: "completed",
      outputRef: "06_FactoryOutputs/TASK-DASH-2.md",
    });
    store.recordTaskRun({
      id: "RUN-DASH-2",
      taskId: "TASK-DASH-2",
      role: "factory",
      model: "gemma",
      prompt: "Generate content",
      output: "Done",
      status: "completed",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
    });
    store.recordReview({
      id: "REV-DASH-2",
      taskId: "TASK-DASH-2",
      verdict: "APPROVED",
      round: 1,
      feedback: "Looks good",
    });
    store.recordArtifact({
      id: "ART-DASH-2",
      taskId: "TASK-DASH-2",
      type: "agent_report",
      path: "06_FactoryOutputs/TASK-DASH-2.md",
      createdBy: "factory",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/tasks/TASK-DASH-2"), store);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.task.id).toBe("TASK-DASH-2");
    expect(body.workflowSteps.map((step: { stepId: string }) => step.stepId)).toEqual(["plan", "generate", "review"]);
    expect(body.runs).toHaveLength(1);
    expect(body.reviews).toHaveLength(1);
    expect(body.artifacts).toHaveLength(1);
    expect(body.timeline.map((event: { kind: string }) => event.kind)).toContain("workflow_step");
    expect(body.timeline.map((event: { kind: string }) => event.kind)).toContain("run");
    expect(body.timeline.map((event: { kind: string }) => event.kind)).toContain("review");
    expect(body.timeline.map((event: { kind: string }) => event.kind)).toContain("artifact");
  });

  test("returns timeline endpoint", async () => {
    const store = await createTempStore();
    store.createTask({
      id: "TASK-DASH-3",
      title: "Plan something",
      type: "planning",
      assignedTo: "director",
      obsidianPath: "01_Tasks/TASK-DASH-3.md",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/tasks/TASK-DASH-3/timeline"), store);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.taskId).toBe("TASK-DASH-3");
    expect(body.timeline[0].kind).toBe("task");
  });

  test("renders dashboard html with summary sections", async () => {
    const store = await createTempStore();
    const response = handleDashboardRequest(new Request("http://localhost/"), store);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("AgentRunner Dashboard");
    expect(html).toContain("Workflow Steps");
    expect(html).toContain("Attention Queue");
    expect(html).toContain("Active Locks");
    expect(html).toContain("/api/status");
  });
});
