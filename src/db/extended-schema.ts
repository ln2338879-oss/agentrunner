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

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  task_id TEXT,
  step_id TEXT,
  owner TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  owner TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  pid INTEGER,
  status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_assigned_created
  ON tasks(status, assigned_to, created_at);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_started
  ON task_runs(task_id, started_at);

CREATE INDEX IF NOT EXISTS idx_messages_task_created
  ON messages(task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reviews_task_round
  ON reviews(task_id, round, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_task_created
  ON artifacts(task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_claim
  ON workflow_step_runs(status, resolved_role_id, lock_expires_at, step_index);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_task_index
  ON workflow_step_runs(task_id, step_index);

CREATE INDEX IF NOT EXISTS idx_runtime_events_task_created
  ON runtime_events(task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_seen
  ON worker_heartbeats(last_seen_at);
`;
