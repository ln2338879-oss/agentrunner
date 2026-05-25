import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { handleDashboardRequest } from "../src/dashboard/server";

const tempDirs: string[] = [];

async function createStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-dashboard-"));
  tempDirs.push(dir);
  return RuntimeStore.open(path.join(dir, "runtime.sqlite"));
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dashboard routes", () => {
  test("returns health payload", async () => {
    const store = await createStore();

    const response = handleDashboardRequest(new Request("http://localhost/health"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("agentrunner-dashboard");
  });

  test("returns recent tasks", async () => {
    const store = await createStore();

    store.createTask({
      id: "TASK-dashboard-1",
      title: "Dashboard task",
      type: "planning",
      assignedTo: "director",
      obsidianPath: "01_Tasks/TASK-dashboard-1.md",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/tasks"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].id).toBe("TASK-dashboard-1");
  });

  test("returns task details with artifacts and reviews", async () => {
    const store = await createStore();

    store.createTask({
      id: "TASK-dashboard-2",
      title: "Dashboard detail",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-dashboard-2.md",
    });

    store.recordReview({
      id: "REV-dashboard-1",
      taskId: "TASK-dashboard-2",
      verdict: "APPROVED",
      round: 1,
      feedback: "VERDICT: APPROVED",
    });

    store.recordArtifact({
      id: "ART-dashboard-1",
      taskId: "TASK-dashboard-2",
      type: "review",
      path: "04_Reviews/TASK-dashboard-2.md",
      createdBy: "director",
    });

    const response = handleDashboardRequest(
      new Request("http://localhost/api/tasks/TASK-dashboard-2"),
      store,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.task.id).toBe("TASK-dashboard-2");
    expect(payload.reviews).toHaveLength(1);
    expect(payload.artifacts).toHaveLength(1);
  });

  test("renders dashboard HTML", async () => {
    const store = await createStore();

    const response = handleDashboardRequest(new Request("http://localhost/"), store);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("AgentRunner Dashboard");
  });
});
