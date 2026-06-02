import type { RuntimeStore } from "../db/runtime-store";

export interface TaskDiscordReference {
  channelId: string;
  messageId: string;
  url: string;
}

interface SqliteQuery<T> {
  get(params?: Record<string, unknown>): T | null;
}

interface SqliteLike {
  query<T = unknown>(sql: string): SqliteQuery<T>;
}

export function getTaskDiscordReference(store: RuntimeStore, taskId: string): TaskDiscordReference | null {
  const db = (store as unknown as { db?: SqliteLike }).db;
  if (!db) return null;

  const row = db.query<{ discordChannelId: string; discordMessageId: string }>(`
    SELECT
      discord_channel_id as discordChannelId,
      discord_message_id as discordMessageId
    FROM messages
    WHERE task_id = $taskId
      AND discord_channel_id IS NOT NULL
      AND discord_message_id IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  `).get({ $taskId: taskId });

  if (!row?.discordChannelId || !row.discordMessageId) return null;
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || "@me";
  return {
    channelId: row.discordChannelId,
    messageId: row.discordMessageId,
    url: `https://discord.com/channels/${guildId}/${row.discordChannelId}/${row.discordMessageId}`,
  };
}
