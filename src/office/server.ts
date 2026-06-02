import type { RuntimeStore } from "../db/runtime-store";
import { buildOfficeBridgePayload, buildOfficeSnapshot } from "../dashboard/office-model";

export interface OfficeServerOptions {
  store: RuntimeStore;
  host: string;
  port: number;
}

export function startOfficeServer(options: OfficeServerOptions): void {
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: (request) => handleOfficeRequest(request, options.store),
  });

  console.log(`[office] listening on http://${server.hostname}:${server.port}`);
}

export function handleOfficeRequest(request: Request, store: RuntimeStore): Response {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return json({ ok: true, service: "agentrunner-office" });
  }

  if (url.pathname === "/api/office/snapshot") {
    return json(buildOfficeSnapshot(store));
  }

  if (url.pathname === "/api/office/bridge") {
    return json(buildOfficeBridgePayload(buildOfficeSnapshot(store)));
  }

  if (url.pathname === "/api/office/events") {
    return officeEventsStream(store);
  }

  if (url.pathname === "/" || url.pathname === "/office") {
    return new Response(renderOfficeHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404);
}

function officeEventsStream(store: RuntimeStore): Response {
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
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function renderOfficeHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentRunner Office</title>
  <style>
    :root { color-scheme: dark; --bg:#07111f; --panel:#101a2a; --panel2:#162337; --line:#2a3e5c; --text:#eaf1ff; --muted:#9fb0c8; --accent:#92d3ff; --bad:#ff9b9b; --ok:#9ff0b6; --warn:#f7d774; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 10% 0%, #1e3457 0, transparent 34%), var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { color: var(--accent); }
    .shell { display:grid; grid-template-columns:minmax(720px,1fr) 380px; gap:16px; min-height:100vh; padding:16px; }
    header, .card { border:1px solid var(--line); border-radius:20px; background:rgba(16,26,42,.94); box-shadow:0 18px 50px rgba(0,0,0,.28); }
    header { grid-column:1 / -1; display:flex; justify-content:space-between; align-items:flex-start; gap:14px; padding:16px 18px; }
    h1, h2, p { margin:0; }
    h1 { font-size:24px; letter-spacing:-.02em; }
    h2 { font-size:15px; margin-bottom:10px; }
    .muted { color:var(--muted); }
    .links { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:6px 10px; background:rgba(255,255,255,.04); color:var(--muted); text-decoration:none; font-size:12px; }
    .canvasWrap { padding:14px; }
    canvas { width:100%; aspect-ratio:16/9; border:1px solid var(--line); border-radius:18px; background:#142137; image-rendering: pixelated; display:block; }
    .side { display:flex; flex-direction:column; min-height:0; }
    .panel { padding:14px; border-bottom:1px solid var(--line); }
    .stats { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
    .stat, .row { border:1px solid var(--line); border-radius:14px; background:var(--panel2); padding:10px; }
    .stat strong { display:block; font-size:26px; margin-top:4px; }
    .list { display:grid; gap:8px; max-height:250px; overflow:auto; }
    .rowTop { display:flex; justify-content:space-between; gap:8px; }
    .title { font-weight:800; font-size:13px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .sub { color:var(--muted); font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .badge { border-radius:999px; padding:2px 8px; font-size:11px; color:var(--muted); background:#26364d; }
    .badge.ok { color:var(--ok); background:#15331f; }
    .badge.warn { color:var(--warn); background:#392f12; }
    .badge.bad { color:var(--bad); background:#421b1b; }
    @media (max-width: 1120px) { .shell { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>AgentRunner Office</h1>
        <p class="muted">Discord는 대화/명령/승인, 이 화면은 AgentRunner 작업 상태를 DeskRPG 스타일로 보여주는 올인원 오피스입니다.</p>
      </div>
      <nav class="links">
        <span class="pill" id="connection">connecting</span>
        <a class="pill" href="/api/office/snapshot">snapshot</a>
        <a class="pill" href="/api/office/bridge">bridge</a>
        <a class="pill" href="/health">health</a>
      </nav>
    </header>

    <section class="card canvasWrap">
      <canvas id="office" width="960" height="540" aria-label="AgentRunner pixel office"></canvas>
    </section>

    <aside class="card side">
      <section class="panel">
        <h2>Runtime Summary</h2>
        <div class="stats" id="stats"></div>
      </section>
      <section class="panel">
        <h2>Agents</h2>
        <div class="list" id="agents"></div>
      </section>
      <section class="panel">
        <h2>Attention Queue</h2>
        <div class="list" id="attention"></div>
      </section>
      <section class="panel">
        <h2>Live Log</h2>
        <div class="list" id="logs"></div>
      </section>
    </aside>
  </main>

  <script>
    const canvas = document.getElementById('office');
    const ctx = canvas.getContext('2d');
    const statsEl = document.getElementById('stats');
    const agentsEl = document.getElementById('agents');
    const attentionEl = document.getElementById('attention');
    const logsEl = document.getElementById('logs');
    const connectionEl = document.getElementById('connection');
    let snapshot = { totals:{tasks:0,openTasks:0,blockedTasks:0,approvedTasks:0}, zones:[], agents:[], tasks:[], logs:[] };

    function badgeClass(status) {
      if (['approved','completed'].includes(status)) return 'ok';
      if (['blocked','failed','needs_human','split_task','retry_with_different_agent'].includes(status)) return 'bad';
      if (['pending','running','needs_revision'].includes(status)) return 'warn';
      return '';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
    }

    function row(title, status, sub) {
      return '<div class="row"><div class="rowTop"><span class="title">' + escapeHtml(title) + '</span><span class="badge ' + badgeClass(status) + '">' + escapeHtml(status) + '</span></div><div class="sub">' + escapeHtml(sub) + '</div></div>';
    }

    function renderSidePanel() {
      const totals = snapshot.totals || { tasks:0, openTasks:0, blockedTasks:0, approvedTasks:0 };
      statsEl.innerHTML = [
        ['Total', totals.tasks], ['Open', totals.openTasks], ['Blocked', totals.blockedTasks], ['Approved', totals.approvedTasks]
      ].map(function(pair) { return '<div class="stat"><span class="muted">' + pair[0] + '</span><strong>' + pair[1] + '</strong></div>'; }).join('');

      agentsEl.innerHTML = (snapshot.agents || []).map(function(agent) {
        return row(agent.name, agent.status, agent.taskId ? agent.taskId + ' · ' + agent.taskTitle : 'idle');
      }).join('') || '<div class="row muted">No agents yet.</div>';

      const attention = (snapshot.tasks || []).filter(function(task) {
        return ['blocked','failed','needs_human','split_task','retry_with_different_agent'].includes(task.status);
      }).slice(0, 8);
      attentionEl.innerHTML = attention.map(function(task) { return row(task.id, task.status, task.title); }).join('') || '<div class="row muted">No blocked tasks.</div>';

      logsEl.innerHTML = (snapshot.logs || []).map(function(log) { return row(log.label, log.status, log.createdAt); }).join('') || '<div class="row muted">No task events yet.</div>';
    }

    function zoneRect(zone) {
      return { x: zone.x * 9.6, y: zone.y * 5.4, w: zone.w * 9.6, h: zone.h * 5.4 };
    }

    function roleColor(agent) {
      if (agent.color === 'gold') return '#ffd166';
      if (agent.color === 'green') return '#9ff0b6';
      if (agent.color === 'pink') return '#ffb3d1';
      return '#95d5ff';
    }

    function drawPixelAgent(agent) {
      const x = agent.x * 9.6;
      const y = agent.y * 5.4;
      ctx.fillStyle = 'rgba(4,8,16,.72)';
      ctx.fillRect(x - 46, y - 58, 92, 30);
      ctx.strokeStyle = '#314866';
      ctx.strokeRect(x - 46, y - 58, 92, 30);
      ctx.fillStyle = '#eaf1ff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(agent.message || agent.status).slice(0, 16), x, y - 39);

      ctx.fillStyle = '#f7cfa2';
      ctx.fillRect(x - 9, y - 24, 18, 14);
      ctx.fillStyle = roleColor(agent);
      ctx.fillRect(x - 13, y - 10, 26, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 13, y + 1, 26, 5);
      ctx.fillStyle = '#1f3150';
      ctx.fillRect(x - 10, y + 14, 8, 10);
      ctx.fillRect(x + 2, y + 14, 8, 10);
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(x - 5, y - 19, 3, 3);
      ctx.fillRect(x + 4, y - 19, 3, 3);
      ctx.fillStyle = '#eaf1ff';
      ctx.font = '12px monospace';
      ctx.fillText(agent.name, x, y + 42);
    }

    function drawOffice() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#142137';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      for (let x = 0; x < canvas.width; x += 32) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
      for (let y = 0; y < canvas.height; y += 32) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }

      for (const zone of snapshot.zones || []) {
        const r = zoneRect(zone);
        ctx.fillStyle = 'rgba(255,255,255,.045)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(146,211,255,.35)';
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#9fb0c8';
        ctx.font = '13px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(zone.label, r.x + 10, r.y + 20);
      }

      for (const agent of snapshot.agents || []) drawPixelAgent(agent);
    }

    function render() { renderSidePanel(); drawOffice(); }

    async function sync() {
      try {
        const response = await fetch('/api/office/bridge', { cache: 'no-store' });
        const payload = await response.json();
        snapshot = payload.snapshot || snapshot;
        connectionEl.textContent = 'live';
        render();
      } catch (error) {
        connectionEl.textContent = 'error';
      }
    }

    sync();
    const events = new EventSource('/api/office/events');
    events.addEventListener('snapshot', sync);
    events.onerror = function() { connectionEl.textContent = 'reconnecting'; };
    setInterval(sync, 5000);
  </script>
</body>
</html>`;
}

function sseJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("\n", "\\n");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
