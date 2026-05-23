import { loadConfig } from "./config";
import { RuntimeStore } from "./db/runtime-store";
import { VaultManager } from "./obsidian/vault-manager";
import { DirectorAgent } from "./agents/director";
import { BuilderAgent } from "./agents/builder";
import { FactoryAgent } from "./agents/factory";
import { Orchestrator } from "./runtime/orchestrator";
import { createDirectorBot } from "./discord/director-bot";
import { createWorkerBot } from "./discord/worker-bot";
import { DiscordNotifier } from "./discord/notifier";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  const orchestrator = new Orchestrator(store, vault, config);

  orchestrator.registerAgent(new DirectorAgent(config));
  orchestrator.registerAgent(new BuilderAgent(config));
  orchestrator.registerAgent(new FactoryAgent(config));

  const loginPromises: Promise<string>[] = [];

  if (config.DIRECTOR_DISCORD_TOKEN) {
    const directorBot = createDirectorBot(config, orchestrator, store);
    orchestrator.setNotifier(new DiscordNotifier(directorBot, config));
    loginPromises.push(directorBot.login(config.DIRECTOR_DISCORD_TOKEN));
  }

  await orchestrator.initialize();

  if (config.BUILDER_DISCORD_TOKEN) {
    const builderBot = createWorkerBot({
      role: "builder",
      token: config.BUILDER_DISCORD_TOKEN,
      channelId: config.DEV_TASKS_CHANNEL_ID,
      config,
    });
    loginPromises.push(builderBot.login(config.BUILDER_DISCORD_TOKEN));
  }

  if (config.FACTORY_DISCORD_TOKEN) {
    const factoryBot = createWorkerBot({
      role: "factory",
      token: config.FACTORY_DISCORD_TOKEN,
      channelId: config.CONTENT_FACTORY_CHANNEL_ID,
      config,
    });
    loginPromises.push(factoryBot.login(config.FACTORY_DISCORD_TOKEN));
  }

  if (loginPromises.length === 0) {
    console.log("AgentRunner initialized without Discord login. Set bot tokens in .env to start the 3-bot runtime.");
    return;
  }

  await Promise.all(loginPromises);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
