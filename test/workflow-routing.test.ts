import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { taskNote } from "../src/obsidian/templates";
import { classifyTask } from "../src/router/classify";
import { planWorkflowForTask } from "../src/router/workflow-routing";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];

async function createTempStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-workflow-routing-"));
  tempDirs.push(dir);
  return RuntimeStore.open(path.join(dir, "runtime.sqlite"));
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow routing integration", () => {
  test("plans implementation workflow from classified task", () => {
    const classified = classifyTask("버그 수정하고 테스트 추가해줘");
    const workflowPlan = planWorkflowForTask({
      classified,
      workflowRegistry: createDefaultWorkflowRegistry(),
    });

    expect(classified.type).toBe("implementation");
    expect(classified.assignedTo).toBe("builder");
    expect(workflowPlan.workflowId).toBe("plan-build-review");
    expect(workflowPlan.steps.map((step) => step.id)).toEqual(["plan", "build", "review", "arbitrate-if-blocked"]);
  });

  test("persists workflow plan metadata on task rows", async () => {
    const store = await createTempStore();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "content");

    store.createTask({
      id: "TASK-WORKFLOW-1",
      title: "Generate items",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-WORKFLOW-1.md",
      workflowPlan,
    });

    const task = store.getTask("TASK-WORKFLOW-1");
    expect(task?.workflowId).toBe("plan-generate-review");
    expect(task?.workflowPlanJson).toContain("plan-generate-review");
    expect(JSON.parse(task?.workflowPlanJson ?? "{}").steps.map((step: { id: string }) => step.id)).toEqual([
      "plan",
      "generate",
      "review",
    ]);
  });

  test("renders workflow plan in task notes", () => {
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    const note = taskNote({
      id: "TASK-WORKFLOW-2",
      title: "Fix bug",
      type: "implementation",
      assignedTo: "builder",
      request: "Fix the bug and add tests.",
      workflowPlan,
    });

    expect(note).toContain("workflow_id: plan-build-review");
    expect(note).toContain("# Workflow Plan");
    expect(note).toContain("| build | builder | builder | implement | plan | yes |");
    expect(note).toContain("| arbitrate-if-blocked | arbiter | arbiter | arbitrate | review | no |");
  });
});
