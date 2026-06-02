# AgentRunner Dashboard

The dashboard now uses an office-style control room inspired by the DeskRPG direction:

```text
Discord = conversation, commands, meetings, approvals
AgentRunner = source of truth and work execution
Dashboard = visual office showing what each agent is doing
```

Enable it with `.env`:

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
```

Then run:

```bash
bun run dashboard
```

Open:

```text
http://127.0.0.1:8787/
```

## HTML page

The root page renders a 2D operations office:

- Director, Builder, Factory, Designer agents as office characters
- office zones for planning, building, factory/content work, design, review, attention, and done
- runtime summary cards
- agent state list
- attention queue
- live task log
- links to JSON endpoints

The dashboard is intentionally read-only. Discord remains the place for conversation, meetings, commands, and approvals.

## JSON endpoints

### Health

```text
GET /health
```

Returns dashboard service health.

### Runtime status

```text
GET /api/status
```

Returns aggregate status:

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "totals": {
    "tasks": 10,
    "openTasks": 4,
    "blockedTasks": 2,
    "approvedTasks": 4
  },
  "byStatus": [],
  "byRole": [],
  "workflowStepsByStatus": [],
  "recentFailures": [],
  "activeLocks": []
}
```

### Office snapshot

```text
GET /api/office/snapshot
```

Returns the read-only visual model consumed by the office UI:

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "totals": {
    "tasks": 10,
    "openTasks": 4,
    "blockedTasks": 2,
    "approvedTasks": 4
  },
  "zones": [],
  "agents": [],
  "tasks": [],
  "logs": [],
  "links": {
    "status": "/api/status",
    "tasks": "/api/tasks?limit=30",
    "health": "/health"
  }
}
```

### Office event stream

```text
GET /api/office/events
```

Returns a Server-Sent Events stream. The dashboard listens for `snapshot` events and refreshes the office every few seconds.

### Recent tasks

```text
GET /api/tasks?limit=20
```

Returns recent task rows with status, role, workflow, lock, and timestamp metadata.

### Task detail

```text
GET /api/tasks/:taskId
```

Returns:

- task summary
- parsed workflow plan
- workflow steps
- task runs
- artifacts
- reviews
- timeline

### Task timeline

```text
GET /api/tasks/:taskId/timeline
```

Returns a chronological timeline across task creation, agent runs, reviews, and artifacts.

## Status-to-office mapping

| Runtime state | Office zone |
|---|---|
| `director` active work | Planning Board |
| `builder` active work | Builder Desks |
| `factory` active work | Factory Bench |
| `designer` active work | Design Studio |
| `needs_revision` / later review rounds | Review Gate |
| `blocked`, `failed`, `needs_human`, `split_task`, `retry_with_different_agent` | Attention Queue |
| `approved`, `completed` | Done Shelf |

## Next dashboard improvements

Recommended next steps:

1. Replace the CSS-only characters with DeskRPG/Phaser sprites once the Office app is split out.
2. Add dashboard authentication before exposing outside localhost.
3. Add direct Discord thread links for tasks once the runtime stores those URLs.
4. Add provider health cards from the provider registry.
5. Add policy decision queue controls that link back to Discord approval commands.
