import { loadConfig } from "./config";
import { RuntimeStore } from "./db/runtime-store";
import { VaultManager } from "./obsidian/vault-manager";
import { DirectorAgent } from "./agents/director";
import { BuilderAgent } from "./agents/builder";
import { FactoryAgent } from "./agents/factory";
import { Orchestrator } from "./runtime/orchestrator";
import { createDirectorBot } from "./discord/director-bot";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  const orchestrator = new Orchestrator(store, vault);

  orchestrator.registerAgent(new DirectorAgent());
  orchestrator.registerAgent(new BuilderAgent());
  orchestrator.registerAgent(new FactoryAgent());
  await orchestrator.initialize();

  if (!config.DIRECTOR_DISCORD_TOKEN) {
    console.log("AgentRunner initialized without Discord login. Set DIRECTOR_DISCORD_TOKEN to start the Director bot.");
    return;
  }

  const directorBot = createDirectorBot(config, orchestrator);
  await directorBot.login(config.DIRECTOR_DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
