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

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  resolved_role_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  required INTEGER NOT NULL,
  requires_review INTEGER NOT NULL,
  locked_by TEXT,
  lock_expires_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  output_ref TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, step_id)
);
`;
