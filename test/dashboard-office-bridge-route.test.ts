import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleDashboardRequest } from "../src/dashboard/server";
import { RuntimeStore } from "../src/db/runtime-store";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-office-bridge-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return store;
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("office bridge route", () => {
  test("returns bridge commands for a DeskRPG adapter", async () => {
    const store = await createStore();
    store.createTask({
      id: "TASK-BRIDGE-ROUTE",
      title: "Move Builder NPC",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-BRIDGE-ROUTE.md",
    });

    const response = handleDashboardRequest(new Request("http://localhost/api/office/bridge"), store);
    const payload = await response.json();
    const types = payload.commands.map((item: { type: string }) => item.type);

    expect(response.status).toBe(200);
    expect(payload.snapshot.tasks[0].id).toBe("TASK-BRIDGE-ROUTE");
    expect(types).toContain("office:summary");
    expect(types).toContain("npc:spawn-local");
    expect(types).toContain("npc:move-local");
    expect(types).toContain("npc:bubble");
    expect(types).toContain("taskboard:replace");
  });

  test("reflects allowed local office origin", async () => {
    const store = await createStore();
    const response = handleDashboardRequest(
      new Request("http://localhost/api/office/snapshot", { headers: { origin: "http://localhost:3000" } }),
      store,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
