import { loadConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { VaultManager } from "../obsidian/vault-manager";
import { createDefaultProviderRegistry } from "../providers/registry";
import { RoleRegistry } from "../roles/registry";
import { runStartupRecovery, startWorkerHeartbeat } from "../runtime/startup-recovery";
import { StepScheduler } from "../workflows/step-scheduler";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  await vault.ensureDefaultFolders();

  const ownerPrefix = `scheduler:${process.pid}`;
  const stopHeartbeat = startWorkerHeartbeat({
    store,
    owner: ownerPrefix,
    role: "scheduler",
    config,
    metadata: { mode: "step-scheduler" },
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

  const recovery = await runStartupRecovery({ store, vault, config, owner: ownerPrefix });
  if (recovery.recovered.length > 0) {
    console.log(`[scheduler] startup recovery ${recovery.mode}: ${recovery.recovered.length} interrupted step(s).`);
  }

  const roleRegistry = await RoleRegistry.load({ path: config.ROLES_CONFIG_PATH });
  const providerRegistry = createDefaultProviderRegistry();
  const agents = providerRegistry.createDefaultAgents({ config, roleRegistry });

  const scheduler = new StepScheduler({
    store,
    vault,
    config,
    agents,
    ownerPrefix,
    maxStepsPerCycle: config.STEP_SCHEDULER_MAX_STEPS_PER_CYCLE,
  });

  console.log("[scheduler] workflow step scheduler booted.");
  console.log(`[scheduler] agents: ${agents.map((agent) => agent.role).join(", ")}`);
  console.log(`[scheduler] max steps per cycle: ${config.STEP_SCHEDULER_MAX_STEPS_PER_CYCLE}`);

  await scheduler.runLoop({
    once: config.STEP_SCHEDULER_ONCE,
    intervalMs: config.STEP_SCHEDULER_INTERVAL_MS,
    onCycle: (result) => {
      if (result.idle) {
        console.log("[scheduler] idle cycle: no ready workflow steps.");
        return;
      }
      console.log(`[scheduler] processed ${result.processed} workflow step(s).`);
      for (const step of result.results) {
        console.log(`[scheduler] ${step.taskId}/${step.stepId} -> ${step.status}${step.verdict ? ` (${step.verdict})` : ""}`);
      }
    },
  });

  stopHeartbeat();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});