import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { RuntimeStore } from "./db/runtime-store";
import { doctorPassed, formatDoctorMarkdown, runDoctor } from "./doctor";
import { VaultManager } from "./obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./runtime/types";
import { WorkerPoller } from "./worker/poller";

class ProofAgent implements AgentAdapter {
  readonly role = "factory" as const;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      ok: true,
      output: [
        "# Proof Factory Output",
        "",
        `task_id: ${input.taskId}`,
        `role: ${input.role}`,
        "",
        "Generated sample potion data for runtime proof.",
        "",
        "```json",
        JSON.stringify([
          { id: "minor_potion", name: "Minor Potion", heal: 30, price: 20 },
          { id: "stamina_potion", name: "Stamina Potion", stamina: 25, price: 25 },
        ], null, 2),
        "```",
      ].join("\n"),
    };
  }
}

async function main(): Promise<void> {
  const proofRoot = path.resolve("docs/proof");
  const runtimeRoot = path.resolve(".agentrunner-proof");
  const env = {
    ...process.env,
    DATABASE_PATH: path.join(runtimeRoot, "data", "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(runtimeRoot, "vault"),
    PROJECT_ROOT: path.join(runtimeRoot, "project"),
    ATTACHMENTS_DIR: path.join(runtimeRoot, "attachments"),
    CLAUDE_CODE_COMMAND: "proof-claude-skipped",
    CODEX_COMMAND: "proof-codex-skipped",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    OLLAMA_MODEL: "proof-model",
    TASK_LEASE_MINUTES: "5",
  } satisfies NodeJS.ProcessEnv;

  await mkdir(proofRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });

  const config = loadConfig(env);
  const doctorResults = await runDoctor({
    env,
    requireCredentials: false,
    includeExternalChecks: false,
  });

  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  await vault.ensureDefaultFolders();

  const taskId = `TASK-proof-${Date.now()}`;
  store.createTask({
    id: taskId,
    title: "Generate proof potion items",
    type: "content",
    assignedTo: "factory",
    obsidianPath: `01_Tasks/${taskId}.md`,
  });
  store.recordMessage({
    id: `MSG-${taskId}`,
    discordMessageId: `DISCORD-${taskId}`,
    discordChannelId: "proof-channel",
    taskId,
    senderRole: "director",
    content: "Generate two sample potion items for runtime proof.",
  });

  const poller = new WorkerPoller({
    role: "factory",
    owner: "proof-worker:factory",
    store,
    vault,
    agent: new ProofAgent(),
    config,
  });

  const pollResult = await poller.pollOnce();
  const task = store.getTask(taskId);
  const artifacts = store.listTaskArtifacts(taskId);
  const success = doctorPassed(doctorResults) && pollResult.claimed && pollResult.status === "completed" && task?.status === "completed" && artifacts.length > 0;

  const proofMarkdown = [
    "# AgentRunner Runtime Proof",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Result: ${success ? "PASS" : "FAIL"}`,
    `- Task ID: ${taskId}`,
    `- Worker claimed task: ${pollResult.claimed}`,
    `- Worker status: ${pollResult.status ?? "none"}`,
    `- Final task status: ${task?.status ?? "missing"}`,
    `- Artifact count: ${artifacts.length}`,
    "",
    "## Doctor Checks",
    "",
    formatDoctorMarkdown(doctorResults),
    "",
    "## Worker Poll Result",
    "",
    "```json",
    JSON.stringify(pollResult, null, 2),
    "```",
    "",
    "## Artifacts",
    "",
    artifacts.length > 0 ? artifacts.map((artifact) => `- ${artifact.type}: ${artifact.path}`).join("\n") : "No artifacts generated.",
    "",
    "## Notes",
    "",
    "This proof uses a local mock Factory agent. It verifies AgentRunner's internal runtime path without requiring Discord tokens, Claude/Codex credentials, or an Ollama server.",
  ].join("\n");

  const proofPath = path.join(proofRoot, "runtime-proof.md");
  await writeFile(proofPath, proofMarkdown, "utf-8");

  console.log(`Runtime proof written to ${proofPath}`);
  console.log(`Result: ${success ? "PASS" : "FAIL"}`);
  if (!success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
