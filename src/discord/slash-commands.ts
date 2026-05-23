import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { RuntimeConfig } from "../config";

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("AgentRunner 명령어를 표시합니다."),
  new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("최근 AgentRunner 작업 10개를 표시합니다."),
  new SlashCommandBuilder()
    .setName("task")
    .setDescription("특정 AgentRunner 작업 상세를 표시합니다.")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("TASK-... 형식의 작업 ID")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("retry")
    .setDescription("기존 AgentRunner 작업을 새 작업으로 재시도합니다.")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("TASK-... 형식의 작업 ID")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("run")
    .setDescription("새 게임 개발 작업을 생성합니다.")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Director에게 전달할 작업 요청")
        .setRequired(true),
    ),
].map((command) => command.toJSON());

export async function registerSlashCommands(config: RuntimeConfig): Promise<void> {
  if (!config.REGISTER_SLASH_COMMANDS) return;
  if (!config.DISCORD_CLIENT_ID) throw new Error("DISCORD_CLIENT_ID is required to register slash commands.");
  if (!config.DIRECTOR_DISCORD_TOKEN) throw new Error("DIRECTOR_DISCORD_TOKEN is required to register slash commands.");

  const rest = new REST({ version: "10" }).setToken(config.DIRECTOR_DISCORD_TOKEN);

  if (config.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body: slashCommands },
    );
    console.log(`[discord] registered guild slash commands for ${config.DISCORD_GUILD_ID}`);
    return;
  }

  await rest.put(
    Routes.applicationCommands(config.DISCORD_CLIENT_ID),
    { body: slashCommands },
  );
  console.log("[discord] registered global slash commands");
}
