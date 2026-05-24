import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import { runDirectorReview, statusFromVerdict } from "../src/review/review-loop";
import { parseReviewVerdict } from "../src/review/verdict";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";

const tempDirs: string[] = [];

class MockDirector implements AgentAdapter {
  readonly role = "director" as const;

  constructor(private readonly result: AgentRunResult) {}

  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    return this.result;
  }
}

async function createReviewFixture(): Promise<{
  store: RuntimeStore;
  vault: VaultManager;
  projectRoot: string;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-review-"));
  tempDirs.push(dir);
  return {
    store: await RuntimeStore.open(path.join(dir, "runtime.sqlite")),
    vault: new VaultManager(path.join(dir, "vault")),
    projectRoot: path.join(dir, "project"),
  };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseReviewVerdict", () => {
  test("parses approved verdicts", () => {
    expect(parseReviewVerdict("VERDICT: APPROVED\nLooks good.")).toBe("APPROVED");
    expect(parseReviewVerdict("STATUS: APPROVED\nLooks good.")).toBe("APPROVED");
  });

  test("parses needs revision verdicts", () => {
    expect(parseReviewVerdict("VERDICT: NEEDS_REVISION\nFix balance.")).toBe("NEEDS_REVISION");
  });

  test("defaults unknown output to blocked", () => {
    expect(parseReviewVerdict("No structured verdict here.")).toBe("BLOCKED");
  });
});

describe("statusFromVerdict", () => {
  test("maps verdicts to task statuses", () => {
    expect(statusFromVerdict("APPROVED")).toBe("approved");
    expect(statusFromVerdict("NEEDS_REVISION")).toBe("needs_revision");
    expect(statusFromVerdict("BLOCKED")).toBe("blocked");
  });
});

describe("runDirectorReview", () => {
  test("records review output and writes review note", async () => {
    const fixture = await createReviewFixture();
    fixture.store.createTask({
      id: "TASK-review-1",
      title: "Review potion output",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-review-1.md",
    });

    const result = await runDirectorReview({
      taskId: "TASK-review-1",
      originalPrompt: "Create potion items.",
      workerRole: "factory",
      workerOutput: "Generated five potion items.",
      director: new MockDirector({ ok: true, output: "VERDICT: APPROVED\nGood content." }),
      store: fixture.store,
      vault: fixture.vault,
      config: loadConfig({ PROJECT_ROOT: fixture.projectRoot }),
      round: 1,
    });

    expect(result.verdict).toBe("APPROVED");
    expect(result.path).toBe("04_Reviews/TASK-review-1-review-round-1.md");
    expect(fixture.store.listTaskReviews("TASK-review-1")[0].feedback).toContain("Good content");
  });

  test("marks failed director execution as blocked", async () => {
    const fixture = await createReviewFixture();
    fixture.store.createTask({
      id: "TASK-review-2",
      title: "Review failed output",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-review-2.md",
    });

    const result = await runDirectorReview({
      taskId: "TASK-review-2",
      originalPrompt: "Implement combat.",
      workerRole: "builder",
      workerOutput: "Patch failed.",
      director: new MockDirector({ ok: false, output: "", error: "director failed" }),
      store: fixture.store,
      vault: fixture.vault,
      config: loadConfig({ PROJECT_ROOT: fixture.projectRoot }),
      round: 1,
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.output).toBe("director failed");
  });
});
