import { describe, expect, test } from "bun:test";
import type { RuntimeStore } from "../src/db/runtime-store";
import type { DashboardStatus, TaskSummaryRow } from "../src/db/runtime-store-types";
import { buildOfficeBridgePayload, buildOfficeSnapshot, zoneForTask } from "../src/dashboard/office-model";

const status: DashboardStatus = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  totals: { tasks: 0, openTasks: 0, blockedTasks: 0, approvedTasks: 0 },
  byStatus: [],
  byRole: [],
  workflowStepsByStatus: [],
  recentFailures: [],
  activeLocks: [],
};

function task(overrides: Partial<TaskSummaryRow>): TaskSummaryRow {
  return {
    id: "TASK-OFFICE",
    title: "Office integration",
    type: "implementation",
    status: "pending",
    assignedTo: "builder",
    currentRound: 1,
    obsidianPath: "01_Tasks/TASK-OFFICE.md",
    workflowId: null,
    workflowPlanJson: null,
    sessionId: null,
    lockedBy: null,
    lockExpiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function storeWith(tasks: TaskSummaryRow[]): RuntimeStore {
  return {
    getDashboardStatus: () => ({ ...status, totals: { tasks: tasks.length, openTasks: tasks.length, blockedTasks: 0, approvedTasks: 0 } }),
    listRecentTasks: () => tasks,
  } as unknown as RuntimeStore;
}

describe("office dashboard model", () => {
  test("maps AgentRunner roles to office zones", () => {
    expect(zoneForTask(task({ assignedTo: "director" }))).toBe("planning");
    expect(zoneForTask(task({ assignedTo: "builder" }))).toBe("builder");
    expect(zoneForTask(task({ assignedTo: "factory" }))).toBe("factory");
    expect(zoneForTask(task({ assignedTo: "designer" }))).toBe("designer");
  });

  test("routes blocked and human-needed work to the attention queue", () => {
    expect(zoneForTask(task({ status: "blocked" }))).toBe("attention");
    expect(zoneForTask(task({ status: "failed" }))).toBe("attention");
    expect(zoneForTask(task({ status: "needs_human" }))).toBe("attention");
  });

  test("builds bridge commands for a DeskRPG EventBus adapter", () => {
    const snapshot = buildOfficeSnapshot(storeWith([task({ id: "TASK-BRIDGE", assignedTo: "builder", lockedBy: "builder-worker" })]));
    const bridge = buildOfficeBridgePayload(snapshot);

    expect(bridge.commands.map((command) => command.type)).toContain("office:summary");
    expect(bridge.commands.map((command) => command.type)).toContain("npc:spawn-local");
    expect(bridge.commands.map((command) => command.type)).toContain("npc:move-local");
    expect(bridge.commands.map((command) => command.type)).toContain("npc:bubble");
    expect(bridge.commands.map((command) => command.type)).toContain("taskboard:replace");
    expect(snapshot.agents.find((agent) => agent.role === "builder")?.message).toBe("builder-worker 실행 중");
  });
});
