import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];

async function createTempStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-workflow-steps-"));
  tempDirs.push(dir);
  return RuntimeStore.open(path.join(dir, "runtime.sqlite"));
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow step runs", () => {
  test("initializes workflow step rows when a task is created", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-STEPS-1",
      title: "Implement feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-STEPS-1.md",
      workflowPlan,
    });

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

    store.createTask({
      id: "TASK-STEPS-2",
      title: "Create poster",
      type: "design",
      assignedTo: "designer",
      obsidianPath: "01_Tasks/TASK-STEPS-2.md",
      workflowPlan,
    });

    store.updateWorkflowStepRun({
      taskId: "TASK-STEPS-2",
      stepId: "design",
      status: "running",
      now: "2026-01-01T00:00:00.000Z",
    });
    store.updateWorkflowStepRun({
      taskId: "TASK-STEPS-2",
      stepId: "design",
      status: "completed",
      outputRef: "06_DesignerOutputs/TASK-STEPS-2-designer-round-1.md",
      now: "2026-01-01T00:00:05.000Z",
    });

    const design = store.listWorkflowStepRuns("TASK-STEPS-2").find((step) => step.stepId === "design");
    expect(design?.status).toBe("completed");
    expect(design?.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(design?.finishedAt).toBe("2026-01-01T00:00:05.000Z");
    expect(design?.outputRef).toBe("06_DesignerOutputs/TASK-STEPS-2-designer-round-1.md");
  });

  test("includes workflow steps in dashboard status and task timeline", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "content");

    store.createTask({
      id: "TASK-STEPS-3",
      title: "Generate content",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-STEPS-3.md",
      workflowPlan,
    });
    store.updateWorkflowStepRun({
      taskId: "TASK-STEPS-3",
      stepId: "generate",
      status: "completed",
      outputRef: "06_FactoryOutputs/TASK-STEPS-3-factory-round-1.md",
    });

    const status = store.getDashboardStatus();
    expect(status.workflowStepsByStatus.some((row) => row.status === "pending" && row.count >= 1)).toBe(true);
    expect(status.workflowStepsByStatus.some((row) => row.status === "completed" && row.count === 1)).toBe(true);

    const timeline = store.getTaskTimeline("TASK-STEPS-3");
    expect(timeline.map((event) => event.kind)).toContain("workflow_step");
    expect(timeline.find((event) => event.label.includes("generate"))?.path).toBe("06_FactoryOutputs/TASK-STEPS-3-factory-round-1.md");
  });
});
