import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { buildOfficeBridgePayload, buildOfficeSnapshot } from "./office-model";

export function startDashboardServer(input: { config: RuntimeConfig; store: RuntimeStore }): void {
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
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/health") return json({ ok: true, service: "agentrunner-dashboard" }, 200, cors);
  if (url.pathname === "/api/status") return json(store.getDashboardStatus(), 200, cors);
  if (url.pathname === "/api/office/snapshot") return json(buildOfficeSnapshot(store), 200, cors);
  if (url.pathname === "/api/office/bridge") return json(buildOfficeBridgePayload(buildOfficeSnapshot(store)), 200, cors);
  if (url.pathname === "/api/office/events") return officeEventsStream(store, cors);

  if (url.pathname === "/api/tasks") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    return json({ tasks: store.listRecentTasks(Number.isFinite(limit) ? limit : 20) }, 200, cors);
  }

  if (url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/timeline")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", "").replace("/timeline", ""));
    const task = store.getTask(taskId);
    if (!task) return json({ error: `Task not found: ${taskId}` }, 404, cors);
    return json({ taskId, timeline: store.getTaskTimeline(taskId) }, 200, cors);
  }

  if (url.pathname.startsWith("/api/tasks/")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", ""));
    const task = store.getTask(taskId);
    if (!task) return json({ error: `Task not found: ${taskId}` }, 404, cors);
    return json(
      {
        task,
        workflowPlan: parseWorkflowPlan(task.workflowPlanJson),
        workflowSteps: store.listWorkflowStepRuns(taskId),
        runs: store.listTaskRuns(taskId),
        artifacts: store.listTaskArtifacts(taskId),
        reviews: store.listTaskReviews(taskId),
        timeline: store.getTaskTimeline(taskId),
      },
      200,
      cors,
    );
  }

  if (url.pathname === "/") {
    return new Response(renderDashboardHtml(store), {
      headers: { ...cors, "content-type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404, cors);
}

function officeEventsStream(store: RuntimeStore, headers: Record<string, string>): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${sseJson(buildOfficeSnapshot(store))}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };
      send();
      timer = setInterval(send, 3_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      ...headers,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function renderDashboardHtml(store: RuntimeStore): string {
  const snapshot = buildOfficeSnapshot(store);
  const zoneCards = snapshot.zones
    .map((zone) => `<section class="zone"><strong>${escapeHtml(zone.label)}</strong><span>${escapeHtml(zone.id)}</span></section>`)
    .join("\n");
  const agentCards = snapshot.agents
    .map(
      (agent) => `<article class="agent color-${escapeHtml(agent.color)}">
        <div class="avatar"></div>
        <div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.status)} · ${escapeHtml(agent.zoneId)}</span><p>${escapeHtml(agent.message)}</p></div>
      </article>`,
    )
    .join("\n");
  const taskRows = snapshot.tasks
    .slice(0, 20)
    .map(
      (task) => `<tr><td><a href="${escapeHtml(task.href)}">${escapeHtml(task.id)}</a></td><td>${escapeHtml(task.status)}</td><td>${escapeHtml(task.role)}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.updatedAt)}</td></tr>`,
    )
    .join("\n");
  const logRows = snapshot.logs
    .map((log) => `<li><strong>${escapeHtml(log.status)}</strong> ${escapeHtml(log.label)} <span>${escapeHtml(log.createdAt)}</span></li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="10" />
<title>AgentRunner Dashboard</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0b1020;color:#eaf1ff;font-family:system-ui,sans-serif}a{color:#95d5ff}.shell{display:grid;grid-template-columns:minmax(580px,1fr)360px;gap:16px;padding:16px}.top,.card{border:1px solid #29354c;border-radius:20px;background:#111827}.top{grid-column:1/-1;padding:16px;display:flex;justify-content:space-between;gap:16px}.muted,span{color:#98a9c3}.links{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill{border:1px solid #29354c;border-radius:999px;padding:6px 10px;text-decoration:none;color:#98a9c3}.office{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:16px}.zone{min-height:95px;border:1px dashed #3f5575;border-radius:16px;padding:12px;background:#182337}.zone strong,.zone span{display:block}.side{display:grid;gap:12px;padding:16px}.agent{display:grid;grid-template-columns:48px 1fr;gap:10px;border:1px solid #29354c;border-radius:14px;padding:10px;background:#182337}.avatar{width:40px;height:46px;border-radius:10px;background:linear-gradient(#95d5ff 0 40%,#fff 40% 52%,#2763bd 52%)}.color-gold .avatar{background:linear-gradient(#ffd166 0 40%,#fff5cf 40% 52%,#7b61ff 52%)}.color-green .avatar{background:linear-gradient(#9ff0b6 0 40%,#effff3 40% 52%,#20734a 52%)}.color-pink .avatar{background:linear-gradient(#ffb3d1 0 40%,#fff1f7 40% 52%,#9d4edd 52%)}.agent strong,.agent span{display:block}.agent p{margin:.25rem 0 0}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 16px 16px}.stat{background:#182337;border-radius:14px;padding:10px}.stat strong{display:block;font-size:24px}table{width:100%;border-collapse:collapse}th,td{border-top:1px solid #29354c;padding:8px;text-align:left}ul{margin:0;padding-left:20px}@media(max-width:1000px){.shell{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<main class="shell">
<header class="top"><div><h1>AgentRunner Office Dashboard</h1><p class="muted">Discord는 대화/명령/회의/승인, 이 화면은 AgentRunner 작업 상태를 시각화하는 오피스입니다.</p></div><nav class="links"><a class="pill" href="/api/office/snapshot">/api/office/snapshot</a><a class="pill" href="/api/office/bridge">/api/office/bridge</a><a class="pill" href="/api/office/events">/api/office/events</a><a class="pill" href="/api/status">/api/status</a></nav></header>
<section class="card"><h2 style="padding:16px;margin:0">2D Agent Office Zones</h2><div class="stats"><div class="stat"><span>Total</span><strong>${snapshot.totals.tasks}</strong></div><div class="stat"><span>Open</span><strong>${snapshot.totals.openTasks}</strong></div><div class="stat"><span>Blocked</span><strong>${snapshot.totals.blockedTasks}</strong></div><div class="stat"><span>Approved</span><strong>${snapshot.totals.approvedTasks}</strong></div></div><div class="office">${zoneCards}</div></section>
<aside class="card side"><h2>Agents</h2>${agentCards || "<p>No agents yet.</p>"}<h2>Live Log</h2><ul>${logRows || "<li>No task events yet.</li>"}</ul></aside>
<section class="card" style="grid-column:1/-1;padding:16px"><h2>Recent Tasks</h2><table><thead><tr><th>Task</th><th>Status</th><th>Role</th><th>Title</th><th>Updated</th></tr></thead><tbody>${taskRows || "<tr><td colspan=\"5\">No tasks yet.</td></tr>"}</tbody></table></section>
</main>
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

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  if (origin && isAllowedLocalDashboardOrigin(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

function isAllowedLocalDashboardOrigin(origin: string): boolean {
  return ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8787", "http://127.0.0.1:8787"].includes(origin);
}

function sseJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("\n", "\\n");
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
