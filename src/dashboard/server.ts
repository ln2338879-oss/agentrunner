import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";

export function startDashboardServer(input: {
  config: RuntimeConfig;
  store: RuntimeStore;
}): void {
  if (!input.config.DASHBOARD_ENABLED) return;

  const server = Bun.serve({
    hostname: input.config.DASHBOARD_HOST,
    port: input.config.DASHBOARD_PORT,
    fetch: (request) => handleDashboardRequest(request, input.store),
  });

  console.log(`[dashboard] listening on http://${server.hostname}:${server.port}`);
}

export function handleDashboardRequest(request: Request, store: RuntimeStore): Response {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return json({ ok: true, service: "agentrunner-dashboard" });
  }

  if (url.pathname === "/api/tasks") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    return json({ tasks: store.listRecentTasks(Number.isFinite(limit) ? limit : 20) });
  }

  if (url.pathname.startsWith("/api/tasks/")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", ""));
    const task = store.getTask(taskId);
    if (!task) return json({ error: `Task not found: ${taskId}` }, 404);
    return json({
      task,
      artifacts: store.listTaskArtifacts(taskId),
      reviews: store.listTaskReviews(taskId),
    });
  }

  if (url.pathname === "/") {
    return new Response(renderDashboardHtml(store), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404);
}

function renderDashboardHtml(store: RuntimeStore): string {
  const rows = store.listRecentTasks(25)
    .map((task) => `
      <tr>
        <td><a href="/api/tasks/${encodeURIComponent(task.id)}">${escapeHtml(task.id)}</a></td>
        <td>${escapeHtml(task.status)}</td>
        <td>${escapeHtml(task.assignedTo)}</td>
        <td>${escapeHtml(String(task.currentRound))}</td>
        <td>${escapeHtml(task.title)}</td>
        <td>${escapeHtml(task.updatedAt)}</td>
      </tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentRunner Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; background: #111; color: #eee; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #333; padding: 8px; text-align: left; vertical-align: top; }
    a { color: #9bd; }
    .muted { color: #aaa; }
  </style>
</head>
<body>
  <h1>AgentRunner Dashboard</h1>
  <p class="muted">Recent tasks and runtime status.</p>
  <table>
    <thead>
      <tr><th>Task</th><th>Status</th><th>Role</th><th>Round</th><th>Title</th><th>Updated</th></tr>
    </thead>
    <tbody>${rows || "<tr><td colspan=\"6\">No tasks yet.</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
