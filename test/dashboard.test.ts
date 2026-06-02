import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { handleDashboardRequest } from "../src/dashboard/server";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createStore() {
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

  test("returns office snapshot", async () => {
    const store = await createStore();

    store.createTask({
      id: "TASK-office-1",
      title: "Render office dashboard",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-office-1.md",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/office/snapshot"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totals.tasks).toBe(1);
    expect(payload.agents.map((agent: { role: string }) => agent.role)).toContain("builder");
    expect(payload.tasks[0].id).toBe("TASK-office-1");
    expect(payload.links.status).toBe("/api/status");
  });

  test("returns office bridge commands for a future DeskRPG adapter", async () => {
    const store = await createStore();

    store.createTask({
      id: "TASK-bridge-1",
      title: "Move Builder NPC",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-bridge-1.md",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/office/bridge"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.commands.map((command: { type: string }) => command.type)).toContain("npc:spawn-local");
    expect(payload.commands.map((command: { type: string }) => command.type)).toContain("npc:move-local");
    expect(payload.commands.map((command: { type: string }) => command.type)).toContain("npc:bubble");
    expect(payload.commands.map((command: { type: string }) => command.type)).toContain("taskboard:replace");
  });

  test("allows local DeskRPG-style dashboard origins", async () => {
    const store = await createStore();

    const response = handleDashboardRequest(
      new Request("http://localhost/api/office/snapshot", {
        headers: { origin: "http://localhost:3000" },
      }),
      store,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
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

  test("renders office dashboard HTML", async () => {
    const store = await createStore();

    const response = handleDashboardRequest(new Request("http://localhost/"), store);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("AgentRunner Dashboard");
    expect(html).toContain("AgentRunner Office Dashboard");
    expect(html).toContain("/api/office/snapshot");
    expect(html).toContain("/api/office/bridge");
  });
});
