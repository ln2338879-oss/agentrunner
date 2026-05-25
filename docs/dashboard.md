# AgentRunner Dashboard

The dashboard exposes lightweight runtime status pages and JSON endpoints.

Enable it with `.env`:

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
```

Then open:

```text
http://127.0.0.1:8787/
```

## HTML page

The root page shows:

- total, open, blocked/failed, and approved task counts
- task counts by status
- task counts by role and status
- attention queue for blocked, failed, human-needed, split, or retry tasks
- active task locks
- recent task list with workflow and lock metadata

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
  "recentFailures": [],
  "activeLocks": []
}
```

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
- task runs
- artifacts
- reviews
- timeline

### Task timeline

```text
GET /api/tasks/:taskId/timeline
```

Returns a chronological timeline across task creation, agent runs, reviews, and artifacts.

## Next dashboard improvements

Recommended next steps:

1. Add provider health cards from the provider registry.
2. Add policy decision queue for `needs_human` actions.
3. Add workflow step progress once step executor lands.
4. Add dashboard authentication before exposing outside localhost.
