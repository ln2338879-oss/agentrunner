import { loadConfig } from "../config";
import { BuilderAgent } from "../agents/builder";
import { DesignerAgent } from "../agents/designer";
import { DirectorAgent } from "../agents/director";
import { FactoryAgent } from "../agents/factory";
import { RuntimeStore } from "../db/runtime-store";
import { VaultManager } from "../obsidian/vault-manager";
import { runStartupRecovery, startWorkerHeartbeat } from "../runtime/startup-recovery";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import { withTaskWorkspaceIsolation } from "../safety/workspace-agent";
import { WorkerPoller } from "./poller";

async function main(): Promise<void> {
  const config = loadConfig();
  const role = config.AGENTRUNNER_WORKER_ROLE;

  if (!role) {
    throw new Error("AGENTRUNNER_WORKER_ROLE is required. Use director, builder, factory, or designer.");
  }

  const agent = createAgent(role, config);
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  await vault.ensureDefaultFolders();

  const owner = `worker:${role}:${process.pid}`;
  const stopHeartbeat = startWorkerHeartbeat({
    store,
    owner,
    role,
    config,
    metadata: { mode: "isolated-worker" },
  });
  process.once("beforeExit", stopHeartbeat);
  process.once("SIGINT", () => {
    stopHeartbeat();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopHeartbeat();
    process.exit(143);
  });

  const recovery = await runStartupRecovery({ store, vault, config, owner });
  if (recovery.recovered.length > 0) {
    console.log(`[worker:${role}] startup recovery ${recovery.mode}: ${recovery.recovered.length} interrupted step(s).`);
  }

  const poller = new WorkerPoller({
    role,
    owner,
    store,
    vault,
    agent,
    config,
  });

  console.log(`[worker:${role}] isolated worker booted.`);
  console.log(`[worker:${role}] adapter role: ${agent.role}`);
  console.log(`[worker:${role}] queue polling enabled.`);

  if (config.WORKER_POLL_ONCE) {
    const result = await poller.pollOnce();
    console.log(`[worker:${role}] pollOnce result: ${JSON.stringify(result)}`);
    stopHeartbeat();
    return;
  }

  for (;;) {
    const result = await poller.pollOnce();
    if (result.claimed) {
      console.log(`[worker:${role}] processed ${result.taskId} as ${result.status}`);
    }
    await sleep(config.WORKER_POLL_INTERVAL_MS);
  }
}

function createAgent(role: AgentRole, config: ReturnType<typeof loadConfig>): AgentAdapter {
  return withTaskWorkspaceIsolation(createBaseAgent(role, config), config);
}

function createBaseAgent(role: AgentRole, config: ReturnType<typeof loadConfig>): AgentAdapter {
  if (role === "director") return new DirectorAgent(config);
  if (role === "builder") return new BuilderAgent(config);
  if (role === "factory") return new FactoryAgent(config);
  return new DesignerAgent(config);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
