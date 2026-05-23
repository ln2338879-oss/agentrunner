# Advanced Runtime Features

AgentRunner includes three advanced runtime paths that move it closer to an always-on AI game-development studio.

## Dashboard

Run the dashboard as a separate process:

```bash
bun run dashboard
```

Relevant environment variables:

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
```

Endpoints:

```text
GET /health
GET /api/tasks
GET /api/tasks/:taskId
GET /
```

The dashboard is intentionally standalone so the Discord bot runtime and dashboard process can fail or restart independently.

## Vision Adapter

When `VISION_COMMAND` is set, AgentRunner scans task prompts for image `local_path` entries generated from Discord attachments. It sends those local image paths to the configured command through stdin and appends stdout as `# Vision Analysis` before the task is routed to a worker.

```env
VISION_COMMAND=
VISION_COMMAND_TIMEOUT_MS=300000
```

The command should read stdin and write concise image analysis to stdout.

## Session Persistence

Director channels now create or reuse an open session record. Recent session messages are injected into new task prompts as `# Session Context`, giving the agents short-term continuity across Discord messages.

## Mid-turn Steering

Use this command while a task is running or awaiting revision:

```text
!steer TASK-... add this extra constraint before the next round
```

Stored steering messages are consumed before the next worker round and injected as `# Mid-turn Steering`.
