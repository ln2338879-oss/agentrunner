import type { Database } from "bun:sqlite";
import type { SessionRow, SteeringMessageRow } from "../runtime-store-types";
import type { AgentRole } from "../../runtime/types";

export function getTaskPrompt(db: Database, taskId: string, fallbackTitle: () => string): string {
  const message = db
    .query(
      `
    SELECT content
    FROM messages
    WHERE task_id = $taskId
    ORDER BY created_at ASC
    LIMIT 1
  `,
    )
    .get({ $taskId: taskId }) as { content: string } | null;

  if (message?.content) return message.content;
  return fallbackTitle();
}

export function getOrCreateSession(
  db: Database,
  input: {
    discordChannelId: string;
    title: string;
    groupId?: string;
  },
): SessionRow {
  const existing = db
    .query(
      `
    SELECT
      id,
      discord_channel_id as discordChannelId,
      title,
      status,
      group_id as groupId,
      created_at as createdAt,
      updated_at as updatedAt
    FROM sessions
    WHERE discord_channel_id = $discordChannelId AND status = 'open'
    ORDER BY updated_at DESC
    LIMIT 1
  `,
    )
    .get({ $discordChannelId: input.discordChannelId }) as SessionRow | null;

  if (existing) return existing;

  const now = new Date().toISOString();
  const id = `SESSION-${Date.now()}`;
  db.query(
    `
    INSERT INTO sessions (id, discord_channel_id, title, status, group_id, created_at, updated_at)
    VALUES ($id, $discordChannelId, $title, 'open', $groupId, $now, $now)
  `,
  ).run({
    $id: id,
    $discordChannelId: input.discordChannelId,
    $title: input.title,
    $groupId: input.groupId ?? null,
    $now: now,
  });

  return {
    id,
    discordChannelId: input.discordChannelId,
    title: input.title,
    status: "open",
    groupId: input.groupId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function listRecentSessionMessages(
  db: Database,
  sessionId: string,
  limit = 8,
): Array<{ content: string; senderRole: string | null; createdAt: string }> {
  return db
    .query(
      `
    SELECT content, sender_role as senderRole, created_at as createdAt
    FROM messages
    WHERE session_id = $sessionId
    ORDER BY created_at DESC
    LIMIT $limit
  `,
    )
    .all({ $sessionId: sessionId, $limit: limit }) as Array<{
    content: string;
    senderRole: string | null;
    createdAt: string;
  }>;
}

export function recordSteeringMessage(
  db: Database,
  input: {
    id: string;
    taskId: string;
    discordMessageId: string;
    content: string;
  },
): void {
  db.query(
    `
    INSERT INTO steering_messages (id, task_id, discord_message_id, content, created_at)
    VALUES ($id, $taskId, $discordMessageId, $content, $createdAt)
  `,
  ).run({
    $id: input.id,
    $taskId: input.taskId,
    $discordMessageId: input.discordMessageId,
    $content: input.content,
    $createdAt: new Date().toISOString(),
  });
}

export function consumeSteeringMessages(db: Database, taskId: string): SteeringMessageRow[] {
  const rows = db
    .query(
      `
    SELECT
      id,
      task_id as taskId,
      discord_message_id as discordMessageId,
      content,
      created_at as createdAt
    FROM steering_messages
    WHERE task_id = $taskId AND consumed_at IS NULL
    ORDER BY created_at ASC
  `,
    )
    .all({ $taskId: taskId }) as SteeringMessageRow[];

  if (rows.length > 0) {
    db.query(
      `
      UPDATE steering_messages
      SET consumed_at = $consumedAt
      WHERE task_id = $taskId AND consumed_at IS NULL
    `,
    ).run({
      $taskId: taskId,
      $consumedAt: new Date().toISOString(),
    });
  }

  return rows;
}

export function recordMessage(
  db: Database,
  input: {
    id: string;
    discordMessageId: string;
    discordChannelId: string;
    taskId?: string;
    sessionId?: string;
    senderRole?: AgentRole;
    content: string;
  },
): void {
  db.query(
    `
    INSERT INTO messages (id, discord_message_id, discord_channel_id, task_id, session_id, sender_role, content, created_at)
    VALUES ($id, $discordMessageId, $discordChannelId, $taskId, $sessionId, $senderRole, $content, $createdAt)
  `,
  ).run({
    $id: input.id,
    $discordMessageId: input.discordMessageId,
    $discordChannelId: input.discordChannelId,
    $taskId: input.taskId ?? null,
    $sessionId: input.sessionId ?? null,
    $senderRole: input.senderRole ?? null,
    $content: input.content,
    $createdAt: new Date().toISOString(),
  });
}
