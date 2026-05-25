import { loadConfig } from "../config";
import { BuilderAgent } from "../agents/builder";
import { DirectorAgent } from "../agents/director";
import { FactoryAgent } from "../agents/factory";
import { RuntimeStore } from "../db/runtime-store";
import { VaultManager } from "../obsidian/vault-manager";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import { WorkerPoller } from "./poller";

async function main(): Promise<void> {
  const config = loadConfig();
  const role = config.AGENTRUNNER_WORKER_ROLE;

  if (!role) {
    throw new Error("AGENTRUNNER_WORKER_ROLE is required. Use director, builder, or factory.");
  }

  const agent = createAgent(role, config);
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  await vault.ensureDefaultFolders();

  const poller = new WorkerPoller({
    role,
    owner: `worker:${role}:${process.pid}`,
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
    return;
  }

  while (true) {
    const result = await poller.pollOnce();
    if (result.claimed) {
      console.log(`[worker:${role}] processed ${result.taskId} as ${result.status}`);
    }
    await sleep(config.WORKER_POLL_INTERVAL_MS);
  }
}

function createAgent(role: AgentRole, config: ReturnType<typeof loadConfig>): AgentAdapter {
  if (role === "director") return new DirectorAgent(config);
  if (role === "builder") return new BuilderAgent(config);
  return new FactoryAgent(config);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
