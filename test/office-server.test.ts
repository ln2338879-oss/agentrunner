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

  test("renders office HTML with sprite atlas hooks", async () => {
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
    const officeResponse = handleOfficeRequest(new Request("http://localhost/office-preview.svg"), store);
    const sheetResponse = handleOfficeRequest(new Request("http://localhost/agent-sheet.svg"), store);
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
    expect(payload.snapshot.tasks[0].discordUrl).toBe("https://discord.com/channels/guild-123/channel-123/message-123");
    expect(commandTypes).toContain("npc:spawn-local");
    expect(commandTypes).toContain("npc:move-local");
    expect(commandTypes).toContain("npc:bubble");

    if (previousGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuildId;
  });

  test("serves task detail from office task routes", async () => {
    const previousGuildId = process.env.DISCORD_GUILD_ID;
    process.env.DISCORD_GUILD_ID = "guild-456";
    const store = await createStore();
    store.createTask({
      id: "TASK-DETAIL-1",
      title: "Render task detail panel",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-DETAIL-1.md",
    });
    store.recordArtifact({
      id: "ART-DETAIL-1",
      taskId: "TASK-DETAIL-1",
      type: "report",
      path: "02_Reports/TASK-DETAIL-1.md",
      createdBy: "builder",
    });
    store.recordMessage({
      id: "MSG-DETAIL-1",
      discordMessageId: "message-456",
      discordChannelId: "channel-456",
      taskId: "TASK-DETAIL-1",
      senderRole: "director",
      content: "Show me detail",
    });

    const listResponse = handleOfficeRequest(new Request("http://localhost/api/tasks?limit=5"), store);
    const detailResponse = handleOfficeRequest(new Request("http://localhost/api/tasks/TASK-DETAIL-1"), store);
    const listPayload = await listResponse.json();
    const detailPayload = await detailResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.tasks.map((task: { id: string }) => task.id)).toContain("TASK-DETAIL-1");
    expect(detailResponse.status).toBe(200);
    expect(detailPayload.task.id).toBe("TASK-DETAIL-1");
    expect(detailPayload.artifacts[0].path).toBe("02_Reports/TASK-DETAIL-1.md");
    expect(detailPayload.discord.url).toBe("https://discord.com/channels/guild-456/channel-456/message-456");

    if (previousGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuildId;
  });
});
