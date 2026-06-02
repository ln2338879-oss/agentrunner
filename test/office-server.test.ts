import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleOfficeRequest } from "../src/office/server";
import { RuntimeStore } from "../src/db/runtime-store";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-office-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return store;
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("built-in office server", () => {
  test("returns health payload", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/health"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("agentrunner-office");
  });

  test("renders office HTML", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/"), store);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("AgentRunner Office");
    expect(html).toContain("/api/office/bridge");
    expect(html).toContain("/api/office/scene");
    expect(html).toContain("virtual pixel office");
    expect(html).toContain("Search tasks");
    expect(html).toContain("Selected");
  });

  test("exposes office scene definition", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/api/office/scene"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.width).toBe(960);
    expect(payload.rooms.map((room: { id: string }) => room.id)).toContain("planning");
    expect(payload.furniture.map((item: { id: string }) => item.id)).toContain("builder-terminal");
  });

  test("exposes office bridge commands", async () => {
    const store = await createStore();
    store.createTask({
      id: "TASK-OFFICE-1",
      title: "Show Builder in Office",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-OFFICE-1.md",
    });

    const response = handleOfficeRequest(new Request("http://localhost/api/office/bridge"), store);
    const payload = await response.json();
    const commandTypes = payload.commands.map((command: { type: string }) => command.type);

    expect(response.status).toBe(200);
    expect(payload.snapshot.tasks[0].id).toBe("TASK-OFFICE-1");
    expect(commandTypes).toContain("npc:spawn-local");
    expect(commandTypes).toContain("npc:move-local");
    expect(commandTypes).toContain("npc:bubble");
  });
});
