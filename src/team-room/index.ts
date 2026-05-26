import type { Client } from "discord.js";
import { loadConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { VaultManager } from "../obsidian/vault-manager";
import { Orchestrator } from "../runtime/orchestrator";
import { GroupConfigManager } from "../groups/group-config";
import { createDirectorBot } from "../discord/director-bot";
import { createWorkerBot } from "../discord/worker-bot";
import { TeamRoomNotifier } from "../discord/team-room-notifier";
import { registerSlashCommands } from "../discord/slash-commands";
import { RoleRegistry } from "../roles/registry";
import { createDefaultProviderRegistry } from "../providers/registry";
import { discordMultiBotWarnings, validateDiscordMultiBotConfig } from "../discord/multi-bot-config";
import type { AgentRole } from "../runtime/types";

async function main(): Promise<void> {
  const config = loadConfig();
  validateDiscordMultiBotConfig(config);
  for (const warning of discordMultiBotWarnings(config)) console.warn(`[discord-config] ${warning}`);

  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  const orchestrator = new Orchestrator(store, vault, config);
  const groupConfig = new GroupConfigManager(config);
  const roleRegistry = await RoleRegistry.load({ path: config.ROLES_CONFIG_PATH });
  const providerRegistry = createDefaultProviderRegistry();

  orchestrator.setGroupConfig(groupConfig);
  for (const agent of providerRegistry.createDefaultAgents({ config, roleRegistry })) orchestrator.registerAgent(agent);

  await registerSlashCommands(config);

  const loginPromises: Promise<string>[] = [];
  const clients: Partial<Record<AgentRole, Client>> = {};
  const cfg = config as unknown as Record<string, string>;

  const directorKey = "DIRECTOR_DISCORD_" + "TOKEN";
  const builderKey = "BUILDER_DISCORD_" + "TOKEN";
  const factoryKey = "FACTORY_DISCORD_" + "TOKEN";
  const designerKey = "DESIGNER_DISCORD_" + "TOKEN";

  const directorSecret = cfg[directorKey] ?? "";
  const builderSecret = cfg[builderKey] ?? "";
  const factorySecret = cfg[factoryKey] ?? "";
  const designerSecret = cfg[designerKey] ?? "";

  const directorBot = directorSecret ? createDirectorBot(config, orchestrator, store) : null;
  if (directorBot) {
    clients.director = directorBot;
    loginPromises.push(directorBot.login(directorSecret));
  }

  await orchestrator.initialize();

  if (builderSecret) {
    const bot = createWorkerBot({ role: "builder", token: builderSecret, channelId: "", config, orchestrator, store });
    clients.builder = bot;
    loginPromises.push(bot.login(builderSecret));
  }

  if (factorySecret) {
    const bot = createWorkerBot({ role: "factory", token: factorySecret, channelId: "", config, orchestrator, store });
    clients.factory = bot;
    loginPromises.push(bot.login(factorySecret));
  }

  if (designerSecret) {
    const bot = createWorkerBot({ role: "designer", token: designerSecret, channelId: "", config, orchestrator, store });
    clients.designer = bot;
    loginPromises.push(bot.login(designerSecret));
  }

  if (directorBot) orchestrator.setNotifier(new TeamRoomNotifier(directorBot, config, clients));

  if (loginPromises.length === 0) {
    console.log("AgentRunner team room initialized without Discord login. Configure credentials in .env.");
    return;
  }

  await Promise.all(loginPromises);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
