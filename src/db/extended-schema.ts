export const extendedRuntimeSchemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  discord_channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  group_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  message_id TEXT,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steering_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
`;
