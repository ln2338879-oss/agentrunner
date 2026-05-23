import { loadConfig } from "../config";
import { BuilderAgent } from "../agents/builder";
import { DirectorAgent } from "../agents/director";
import { FactoryAgent } from "../agents/factory";
import type { AgentAdapter, AgentRole } from "../runtime/types";

async function main(): Promise<void> {
  const config = loadConfig();
  const role = config.AGENTRUNNER_WORKER_ROLE;

  if (!role) {
    throw new Error("AGENTRUNNER_WORKER_ROLE is required. Use director, builder, or factory.");
  }

  const agent = createAgent(role, config);
  console.log(`[worker:${role}] isolated worker booted.`);
  console.log(`[worker:${role}] adapter role: ${agent.role}`);
  console.log(`[worker:${role}] current mode: standby`);
  console.log(`[worker:${role}] central Discord orchestration remains in src/index.ts.`);
}

function createAgent(role: AgentRole, config: ReturnType<typeof loadConfig>): AgentAdapter {
  if (role === "director") return new DirectorAgent(config);
  if (role === "builder") return new BuilderAgent(config);
  return new FactoryAgent(config);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
