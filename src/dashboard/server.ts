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

  if (url.pathname === "/api/status") {
    return json(store.getDashboardStatus());
  }

  if (url.pathname === "/api/tasks") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    return json({ tasks: store.listRecentTasks(Number.isFinite(limit) ? limit : 20) });
  }

  if (url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/timeline")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", "").replace("/timeline", ""));
    const task = store.getTask(taskId);
    if (!task) return json({ error: `Task not found: ${taskId}` }, 404);
    return json({ taskId, timeline: store.getTaskTimeline(taskId) });
  }

  if (url.pathname.startsWith("/api/tasks/")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", ""));
    const task = store.getTask(taskId);
    if (!task) return json({ error: `Task not found: ${taskId}` }, 404);
    return json({
      task,
      workflowPlan: parseWorkflowPlan(task.workflowPlanJson),
      workflowSteps: store.listWorkflowStepRuns(taskId),
      runs: store.listTaskRuns(taskId),
      artifacts: store.listTaskArtifacts(taskId),
      reviews: store.listTaskReviews(taskId),
      timeline: store.getTaskTimeline(taskId),
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
  const status = store.getDashboardStatus();
  const tasks = store.listRecentTasks(25);
  const rows = tasks
    .map((task) => `
      <tr>
        <td><a href="/api/tasks/${encodeURIComponent(task.id)}">${escapeHtml(task.id)}</a></td>
        <td><span class="badge ${statusClass(task.status)}">${escapeHtml(task.status)}</span></td>
        <td>${escapeHtml(task.assignedTo)}</td>
        <td>${escapeHtml(task.workflowId ?? "-")}</td>
        <td>${task.lockedBy ? escapeHtml(task.lockedBy) : "-"}</td>
        <td>${escapeHtml(String(task.currentRound))}</td>
        <td>${escapeHtml(task.title)}</td>
        <td>${escapeHtml(task.updatedAt)}</td>
      </tr>`)
    .join("\n");

  const statusCards = [
    ["Total Tasks", status.totals.tasks],
    ["Open", status.totals.openTasks],
    ["Blocked / Failed", status.totals.blockedTasks],
    ["Approved", status.totals.approvedTasks],
  ].map(([label, value]) => `
    <section class="card">
      <div class="label">${escapeHtml(String(label))}</div>
      <div class="value">${escapeHtml(String(value))}</div>
    </section>`).join("\n");

  const byStatusRows = status.byStatus
    .map((item) => `<tr><td>${escapeHtml(item.status)}</td><td>${escapeHtml(String(item.count))}</td></tr>`)
    .join("\n");

  const byRoleRows = status.byRole
    .map((item) => `<tr><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(String(item.count))}</td></tr>`)
    .join("\n");

  const workflowStepRows = status.workflowStepsByStatus
    .map((item) => `<tr><td>${escapeHtml(item.status)}</td><td>${escapeHtml(String(item.count))}</td></tr>`)
    .join("\n");

  const failureRows = status.recentFailures
    .map((task) => `<tr><td><a href="/api/tasks/${encodeURIComponent(task.id)}">${escapeHtml(task.id)}</a></td><td>${escapeHtml(task.status)}</td><td>${escapeHtml(task.assignedTo)}</td><td>${escapeHtml(task.updatedAt)}</td></tr>`)
    .join("\n");

  const lockRows = status.activeLocks
    .map((task) => `<tr><td><a href="/api/tasks/${encodeURIComponent(task.id)}">${escapeHtml(task.id)}</a></td><td>${escapeHtml(task.assignedTo)}</td><td>${escapeHtml(task.lockedBy ?? "")}</td><td>${escapeHtml(task.lockExpiresAt ?? "")}</td></tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentRunner Dashboard</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; margin: 32px; background: #111; color: #eee; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #333; padding: 8px; text-align: left; vertical-align: top; }
    a { color: #9bd; }
    .muted { color: #aaa; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
    .card { background: #1b1b1b; border: 1px solid #333; border-radius: 12px; padding: 16px; }
    .label { color: #aaa; font-size: 13px; }
    .value { font-size: 32px; font-weight: 700; margin-top: 8px; }
    .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin: 24px 0; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #333; }
    .ok { background: #16351f; color: #9fdda8; }
    .warn { background: #3d3210; color: #f0d37a; }
    .bad { background: #411b1b; color: #f1a3a3; }
  </style>
</head>
<body>
  <h1>AgentRunner Dashboard</h1>
  <p class="muted">Runtime status generated at ${escapeHtml(status.generatedAt)}. JSON: <a href="/api/status">/api/status</a></p>

  <div class="grid">${statusCards}</div>

  <div class="columns">
    <section>
      <h2>Status</h2>
      <table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${byStatusRows || "<tr><td colspan=\"2\">No tasks yet.</td></tr>"}</tbody></table>
    </section>
    <section>
      <h2>Role Load</h2>
      <table><thead><tr><th>Role</th><th>Status</th><th>Count</th></tr></thead><tbody>${byRoleRows || "<tr><td colspan=\"3\">No tasks yet.</td></tr>"}</tbody></table>
    </section>
    <section>
      <h2>Workflow Steps</h2>
      <table><thead><tr><th>Step Status</th><th>Count</th></tr></thead><tbody>${workflowStepRows || "<tr><td colspan=\"2\">No workflow steps yet.</td></tr>"}</tbody></table>
    </section>
  </div>

  <div class="columns">
    <section>
      <h2>Attention Queue</h2>
      <table><thead><tr><th>Task</th><th>Status</th><th>Role</th><th>Updated</th></tr></thead><tbody>${failureRows || "<tr><td colspan=\"4\">No blocked tasks.</td></tr>"}</tbody></table>
    </section>
    <section>
      <h2>Active Locks</h2>
      <table><thead><tr><th>Task</th><th>Role</th><th>Locked By</th><th>Expires</th></tr></thead><tbody>${lockRows || "<tr><td colspan=\"4\">No active locks.</td></tr>"}</tbody></table>
    </section>
  </div>

  <h2>Recent Tasks</h2>
  <table>
    <thead>
      <tr><th>Task</th><th>Status</th><th>Role</th><th>Workflow</th><th>Lock</th><th>Round</th><th>Title</th><th>Updated</th></tr>
    </thead>
    <tbody>${rows || "<tr><td colspan=\"8\">No tasks yet.</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

function parseWorkflowPlan(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: true, raw: value };
  }
}

function statusClass(status: string): string {
  if (["approved", "completed"].includes(status)) return "ok";
  if (["blocked", "failed", "needs_human", "split_task", "retry_with_different_agent"].includes(status)) return "bad";
  if (["running", "needs_revision"].includes(status)) return "warn";
  return "";
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
