import { loadConfig } from "./config";
import { RuntimeStore } from "./db/runtime-store";
import { VaultManager } from "./obsidian/vault-manager";
import { Orchestrator } from "./runtime/orchestrator";
import { GroupConfigManager } from "./groups/group-config";
import { createDirectorBot } from "./discord/director-bot";
import { createWorkerBot } from "./discord/worker-bot";
import { DiscordNotifier } from "./discord/notifier";
import { registerSlashCommands } from "./discord/slash-commands";
import { RoleRegistry } from "./roles/registry";
import { createDefaultProviderRegistry } from "./providers/registry";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  const orchestrator = new Orchestrator(store, vault, config);
  const groupConfig = new GroupConfigManager(config);
  const roleRegistry = await RoleRegistry.load({ path: config.ROLES_CONFIG_PATH });
  const providerRegistry = createDefaultProviderRegistry();

  orchestrator.setGroupConfig(groupConfig);
  for (const agent of providerRegistry.createDefaultAgents({ config, roleRegistry })) {
    orchestrator.registerAgent(agent);
  }

  await registerSlashCommands(config);

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
