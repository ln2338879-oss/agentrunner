import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { handleOfficeRequest } from "../src/office/server";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-office-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return store;
}

function seedTaskDetail(store: RuntimeStore): void {
  store.createTask({
    id: "TASK-DETAIL-1",
    title: "Render task detail panel",
    type: "implementation",
    assignedTo: "builder",
    obsidianPath: "01_Tasks/TASK-DETAIL-1.md",
    workflowPlan: {
      workflowId: "office-detail-flow",
      label: "Office detail flow",
      steps: [
        {
          id: "plan",
          role: "director",
          resolvedRoleId: "director",
          action: "plan",
          dependsOn: [],
          required: true,
          continueOnFailure: false,
          requiresReview: false,
        },
        {
          id: "build",
          role: "builder",
          resolvedRoleId: "builder",
          action: "implement",
          dependsOn: ["plan"],
          required: true,
          continueOnFailure: false,
          requiresReview: true,
        },
      ],
    },
  });
  store.recordTaskRun({
    id: "RUN-DETAIL-1",
    taskId: "TASK-DETAIL-1",
    role: "builder",
    model: "test-model",
    prompt: "Render detail",
    output: "Done",
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  });
  store.recordArtifact({
    id: "ART-DETAIL-1",
    taskId: "TASK-DETAIL-1",
    type: "report",
    path: "02_Reports/TASK-DETAIL-1.md",
    createdBy: "builder",
  });
  store.recordReview({
    id: "REV-DETAIL-1",
    taskId: "TASK-DETAIL-1",
    verdict: "APPROVED",
    round: 1,
    feedback: "Looks ready.",
  });
  store.recordVerificationEvidence({
    id: "EVIDENCE-DETAIL-1",
    taskId: "TASK-DETAIL-1",
    stepId: "build",
    kind: "workflow_step_validation",
    command: "bun run quality:check",
    status: "passed",
    artifactPath: "artifacts/TASK-DETAIL-1/quality.log",
    summary: "typecheck, lint, test, and build passed",
    createdBy: "builder",
    createdAt: "2026-01-01T00:02:00.000Z",
  });
  store.recordMessage({
    id: "MSG-DETAIL-1",
    discordMessageId: "message-456",
    discordChannelId: "channel-456",
    taskId: "TASK-DETAIL-1",
    senderRole: "director",
    content: "Show me detail",
  });
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
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

  test("renders office HTML with sprite atlas hooks and task detail fetch markers", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/"), store);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("AgentRunner Office");
    expect(html).toContain("/api/office/assets");
    expect(html).toContain("/api/office/bridge");
    expect(html).toContain("/api/office/scene");
    expect(html).toContain("drawImage sprites");
    expect(html).toContain("loadAssets");
    expect(html).toContain("drawAgent");
    expect(html).toContain("Search tasks");
    expect(html).toContain("Selected");
    expect(html).toContain("fetchTaskDetail");
    expect(html).toContain("Open Discord thread");
    expect(html).toContain("workflowSteps");
    expect(html).toContain("runs");
    expect(html).toContain("artifacts");
    expect(html).toContain("verificationEvidence");
    expect(html).toContain("reviews");
    expect(html).toContain("timeline");
  });

  test("exposes office sprite assets", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/api/office/assets"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.maleWalkRow).toStartWith("data:image/png;base64,");
    expect(payload.furnitureAtlas).toStartWith("data:image/png;base64,");
    expect(payload.source).toContain("DeskRPG");
  });

  test("exposes browser preview SVGs", async () => {
    const store = await createStore();
    const officeResponse = handleOfficeRequest(
      new Request("http://localhost/office-preview.svg"),
      store,
    );
    const sheetResponse = handleOfficeRequest(
      new Request("http://localhost/agent-sheet.svg"),
      store,
    );
    const officeSvg = await officeResponse.text();
    const sheetSvg = await sheetResponse.text();

    expect(officeResponse.status).toBe(200);
    expect(sheetResponse.status).toBe(200);
    expect(officeResponse.headers.get("content-type")).toContain("image/svg+xml");
    expect(officeSvg).toContain("Planning Board");
    expect(officeSvg).toContain("Builder");
    expect(sheetSvg).toContain("AgentRunner Agent Characters");
  });

  test("exposes office scene definition", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(new Request("http://localhost/api/office/scene"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.width).toBe(960);
    expect(payload.palette.glow).toContain("rgba");
    expect(payload.rooms.map((room: { id: string }) => room.id)).toContain("planning");
    expect(payload.furniture.map((item: { id: string }) => item.id)).toContain("builder-terminal");
    expect(payload.furniture.map((item: { id: string }) => item.id)).toContain("design-board");
    expect(payload.furniture.map((item: { id: string }) => item.id)).toContain("done-plant");
  });

  test("exposes office bridge commands and Discord task links", async () => {
    const previousGuildId = process.env.DISCORD_GUILD_ID;
    process.env.DISCORD_GUILD_ID = "guild-123";
    const store = await createStore();
    store.createTask({
      id: "TASK-OFFICE-1",
      title: "Show Builder in Office",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-OFFICE-1.md",
    });
    store.recordMessage({
      id: "MSG-OFFICE-1",
      discordMessageId: "message-123",
      discordChannelId: "channel-123",
      taskId: "TASK-OFFICE-1",
      senderRole: "director",
      content: "Create the office view",
    });

    const response = handleOfficeRequest(new Request("http://localhost/api/office/bridge"), store);
    const payload = await response.json();
    const commandTypes = payload.commands.map((command: { type: string }) => command.type);

    expect(response.status).toBe(200);
    expect(payload.snapshot.tasks[0].id).toBe("TASK-OFFICE-1");
    expect(payload.snapshot.tasks[0].discordUrl).toBe(
      "https://discord.com/channels/guild-123/channel-123/message-123",
    );
    expect(commandTypes).toContain("npc:spawn-local");
    expect(commandTypes).toContain("npc:move-local");
    expect(commandTypes).toContain("npc:bubble");

    if (previousGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuildId;
  });

  test("serves /api/tasks with limit", async () => {
    const store = await createStore();
    seedTaskDetail(store);

    const response = handleOfficeRequest(new Request("http://localhost/api/tasks?limit=5"), store);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tasks.length).toBeLessThanOrEqual(5);
    expect(payload.tasks.map((task: { id: string }) => task.id)).toContain("TASK-DETAIL-1");
  });

  test("serves task detail with workflow, runs, artifacts, reviews, timeline, and Discord link", async () => {
    const previousGuildId = process.env.DISCORD_GUILD_ID;
    process.env.DISCORD_GUILD_ID = "guild-456";
    const store = await createStore();
    seedTaskDetail(store);

    const response = handleOfficeRequest(
      new Request("http://localhost/api/tasks/TASK-DETAIL-1"),
      store,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.task.id).toBe("TASK-DETAIL-1");
    expect(payload.workflowPlan.workflowId).toBe("office-detail-flow");
    expect(payload.workflowSteps.map((step: { stepId: string }) => step.stepId)).toContain("build");
    expect(payload.runs[0].id).toBe("RUN-DETAIL-1");
    expect(payload.artifacts[0].path).toBe("02_Reports/TASK-DETAIL-1.md");
    expect(payload.reviews[0].verdict).toBe("APPROVED");
    expect(payload.verificationEvidence[0].command).toBe("bun run quality:check");
    expect(payload.verificationEvidence[0].artifactPath).toBe(
      "artifacts/TASK-DETAIL-1/quality.log",
    );
    expect(payload.timeline.length).toBeGreaterThan(0);
    expect(payload.timeline.map((event: { kind: string }) => event.kind)).toContain("artifact");
    expect(payload.discord.url).toBe(
      "https://discord.com/channels/guild-456/channel-456/message-456",
    );

    if (previousGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuildId;
  });

  test("returns 404 for unknown task detail", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(
      new Request("http://localhost/api/tasks/MISSING-TASK"),
      store,
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Task not found");
  });

  test("returns 400 for invalid task detail path", async () => {
    const store = await createStore();
    const response = handleOfficeRequest(
      new Request("http://localhost/api/tasks/TASK-DETAIL-1/extra"),
      store,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Invalid task id");
  });
});
