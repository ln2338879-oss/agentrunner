import type { RuntimeStore } from "../db/runtime-store";
import type { TaskSummaryRow } from "../db/runtime-store-types";

export const DEFAULT_OFFICE_REFRESH_MS = 3_000;

export type OfficeZone = { id: string; label: string; x: number; y: number; w: number; h: number };

export type OfficeAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
  zoneId: string;
  x: number;
  y: number;
  taskId: string | null;
  taskTitle: string | null;
  message: string;
};

export type OfficeSnapshot = {
  generatedAt: string;
  totals: { tasks: number; openTasks: number; blockedTasks: number; approvedTasks: number };
  zones: OfficeZone[];
  agents: OfficeAgent[];
  tasks: Array<{ id: string; title: string; status: string; role: string; zoneId: string; updatedAt: string; href: string }>;
  logs: Array<{ id: string; label: string; status: string; createdAt: string }>;
  links: { status: string; tasks: string; health: string; events: string };
};

const DEFAULT_ROLES = ["director", "builder", "factory", "designer"];
const ZONES: Record<string, OfficeZone> = {
  planning: { id: "planning", label: "Planning Board", x: 5, y: 9, w: 25, h: 26 },
  review: { id: "review", label: "Review Gate", x: 37, y: 9, w: 25, h: 26 },
  designer: { id: "designer", label: "Design Studio", x: 69, y: 9, w: 24, h: 26 },
  reception: { id: "reception", label: "Discord Handoff", x: 5, y: 63, w: 25, h: 27 },
  builder: { id: "builder", label: "Builder Desks", x: 37, y: 41, w: 25, h: 27 },
  factory: { id: "factory", label: "Factory Bench", x: 69, y: 41, w: 24, h: 27 },
  attention: { id: "attention", label: "Attention Queue", x: 37, y: 72, w: 25, h: 18 },
  done: { id: "done", label: "Done Shelf", x: 69, y: 72, w: 24, h: 18 },
};

export function buildOfficeSnapshot(store: RuntimeStore): OfficeSnapshot {
  const status = store.getDashboardStatus();
  const tasks = store.listRecentTasks(30);
  const roles = Array.from(
    new Set([...DEFAULT_ROLES, ...status.byRole.map((row) => row.role), ...tasks.map((task) => task.assignedTo)]),
  ).filter(Boolean);

  return {
    generatedAt: status.generatedAt,
    totals: status.totals,
    zones: Object.values(ZONES),
    agents: roles.map((role, index) => officeAgent(role, tasks, index)),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      role: task.assignedTo,
      zoneId: zoneForTask(task),
      updatedAt: task.updatedAt,
      href: `/api/tasks/${encodeURIComponent(task.id)}`,
    })),
    logs: tasks.slice(0, 12).map((task) => ({
      id: task.id,
      label: `${roleLabel(task.assignedTo)} · ${task.title}`,
      status: task.status,
      createdAt: task.updatedAt,
    })),
    links: { status: "/api/status", tasks: "/api/tasks?limit=30", health: "/health", events: "/api/office/events" },
  };
}

export function officeEventsStream(input: {
  store: RuntimeStore;
  refreshMs?: number;
  headers?: HeadersInit;
}): Response {
  const encoder = new TextEncoder();
  const refreshMs = Math.max(1_000, input.refreshMs ?? DEFAULT_OFFICE_REFRESH_MS);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${sseJson(buildOfficeSnapshot(input.store))}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };

      send();
      timer = setInterval(send, refreshMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, { headers: input.headers });
}

export function renderOfficeDashboardHtml(store: RuntimeStore): string {
  const snapshot = buildOfficeSnapshot(store);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AgentRunner Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#111827;--panel2:#182337;--line:#29354c;--text:#eaf1ff;--muted:#98a9c3;--ok:#9ff0b6;--warn:#f7d774;--bad:#ff9c9c}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 10%,#1d2a45,transparent 34%),var(--bg);color:var(--text);font-family:system-ui,sans-serif}a{color:#95d5ff;text-decoration:none}.shell{display:grid;grid-template-columns:minmax(640px,1fr)380px;gap:16px;min-height:100vh;padding:16px}.top{grid-column:1/-1;display:flex;justify-content:space-between;gap:16px;align-items:center}.card,.top{border:1px solid var(--line);border-radius:20px;background:rgba(17,24,39,.9);box-shadow:0 18px 70px rgba(0,0,0,.26)}.top,.panel{padding:14px 16px}h1{margin:0;font-size:23px}.muted{color:var(--muted)}.links{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill{border:1px solid var(--line);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.04);font-size:12px;color:var(--muted)}.office-head{padding:14px 16px;border-bottom:1px solid var(--line)}.office{position:relative;min-height:530px;aspect-ratio:16/9;overflow:hidden;background:#17202f;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:32px 32px}.zone{position:absolute;border:2px solid rgba(149,213,255,.27);border-radius:16px;background:rgba(255,255,255,.04);padding:10px}.zone b{font-size:11px;text-transform:uppercase;letter-spacing:.09em}.agent{position:absolute;width:96px;transform:translate(-50%,-50%);display:grid;place-items:center;transition:left .5s ease,top .5s ease;z-index:3}.bubble{max-width:130px;margin-bottom:6px;padding:6px 8px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(11,16,32,.92);font-size:11px;text-align:center}.sprite{width:42px;height:50px;border-radius:10px 10px 14px 14px;border:2px solid rgba(255,255,255,.22);background:linear-gradient(#95d5ff 0 38%,#fff 38% 52%,#2763bd 52%);box-shadow:0 10px 24px rgba(0,0,0,.32);position:relative}.sprite:before{content:"";position:absolute;top:-13px;left:7px;width:24px;height:18px;border-radius:9px 9px 7px 7px;background:#f7cfa2;border:2px solid rgba(255,255,255,.2)}.sprite:after{content:"";position:absolute;left:9px;top:-6px;width:5px;height:5px;background:#162033;box-shadow:14px 0 0 #162033}.agent[data-role=director] .sprite{background:linear-gradient(#ffd166 0 38%,#fff5cf 38% 52%,#7b61ff 52%)}.agent[data-role=factory] .sprite{background:linear-gradient(#9ff0b6 0 38%,#effff3 38% 52%,#20734a 52%)}.agent[data-role=designer] .sprite{background:linear-gradient(#ffb3d1 0 38%,#fff1f7 38% 52%,#9d4edd 52%)}.name{margin-top:5px;padding:3px 7px;border-radius:999px;background:rgba(0,0,0,.35);font-size:11px;font-weight:800}.side{display:flex;flex-direction:column;min-height:0}.panel{border-bottom:1px solid var(--line)}h2{margin:0 0 10px;font-size:14px}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.stat,.row{border:1px solid var(--line);border-radius:14px;background:var(--panel2);padding:10px}.stat strong{display:block;font-size:25px;margin-top:3px}.list{display:grid;gap:8px;max-height:250px;overflow:auto}.rowtop{display:flex;justify-content:space-between;gap:8px}.title{font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sub{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.badge{border-radius:999px;padding:2px 8px;font-size:11px;background:#2d3850;color:var(--muted)}.ok{background:#16351f;color:var(--ok)}.warn{background:#3d3210;color:var(--warn)}.bad{background:#411b1b;color:var(--bad)}@media(max-width:1100px){.shell{grid-template-columns:1fr}.office{min-height:430px}}
</style>
</head>
<body>
<main class="shell">
<header class="top"><div><h1>AgentRunner Office Dashboard</h1><div class="muted">Discord는 대화/명령/회의/승인, 이 화면은 AgentRunner 작업 상태를 시각화하는 오피스입니다.</div></div><nav class="links"><span class="pill" id="stream">stream: connecting</span><span class="pill">generated <span id="generated">${escapeHtml(snapshot.generatedAt)}</span></span><a class="pill" href="/api/office/snapshot">/api/office/snapshot</a><a class="pill" href="/api/status">/api/status</a></nav></header>
<section class="card"><div class="office-head"><strong>2D Agent Office</strong><div class="muted">Director / Builder / Factory / Designer가 맡은 작업 상태에 따라 오피스 위치와 말풍선이 바뀝니다.</div></div><div class="office" id="office"></div></section>
<aside class="card side"><section class="panel"><h2>Runtime Summary</h2><div class="stats" id="stats"></div></section><section class="panel"><h2>Agents</h2><div class="list" id="agents"></div></section><section class="panel"><h2>Attention Queue</h2><div class="list" id="attention"></div></section><section class="panel"><h2>Workflow Steps</h2><p class="muted">세부 step, artifact, review는 task detail API에서 확인합니다.</p></section><section class="panel"><h2>Active Locks</h2><p class="muted">실행 중인 lock은 /api/status와 task detail에서 확인합니다.</p></section><section class="panel"><h2>Live Log</h2><div class="list" id="logs"></div></section></aside>
</main>
<script id="snapshot" type="application/json">${scriptJson(snapshot)}</script>
<script>
const state=JSON.parse(document.getElementById('snapshot').textContent);const $=(id)=>document.getElementById(id);const office=$('office'),stats=$('stats'),agents=$('agents'),attention=$('attention'),logs=$('logs'),generated=$('generated'),stream=$('stream');
function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cls(s){if(['approved','completed'].includes(s))return'ok';if(['blocked','failed','needs_human','split_task','retry_with_different_agent'].includes(s))return'bad';if(['running','needs_revision','pending'].includes(s))return'warn';return'';}
function render(s){generated.textContent=s.generatedAt;office.innerHTML=s.zones.map((z)=>'<section class="zone" style="left:'+z.x+'%;top:'+z.y+'%;width:'+z.w+'%;height:'+z.h+'%"><b>'+esc(z.label)+'</b></section>').join('')+s.agents.map((a)=>'<article class="agent" data-role="'+esc(a.role)+'" style="left:'+a.x+'%;top:'+a.y+'%"><div class="bubble">'+esc(a.message)+'</div><div class="sprite"></div><div class="name">'+esc(a.name)+'</div></article>').join('');stats.innerHTML=[['Total',s.totals.tasks],['Open',s.totals.openTasks],['Blocked',s.totals.blockedTasks],['Approved',s.totals.approvedTasks]].map((x)=>'<div class="stat"><span class="muted">'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join('');agents.innerHTML=s.agents.map((a)=>row(a.name,a.status,a.taskId? a.taskId+' · '+a.taskTitle:'idle')).join('')||'<div class="row muted">No agents yet.</div>';const bad=s.tasks.filter((t)=>['blocked','failed','needs_human','split_task','retry_with_different_agent'].includes(t.status)).slice(0,8);attention.innerHTML=bad.map((t)=>'<a class="row" href="'+esc(t.href)+'">'+rowInner(t.id,t.status,t.title)+'</a>').join('')||'<div class="row muted">No blocked tasks.</div>';logs.innerHTML=s.logs.map((e)=>'<a class="row" href="/api/tasks/'+encodeURIComponent(e.id)+'">'+rowInner(e.label,e.status,e.createdAt)+'</a>').join('')||'<div class="row muted">No task events yet.</div>';}
function row(t,s,sub){return'<div class="row">'+rowInner(t,s,sub)+'</div>'}function rowInner(t,s,sub){return'<div class="rowtop"><span class="title">'+esc(t)+'</span><span class="badge '+cls(s)+'">'+esc(s)+'</span></div><div class="sub">'+esc(sub)+'</div>'}
function connect(){if(!('EventSource'in window)){stream.textContent='stream: polling';setInterval(()=>fetch('/api/office/snapshot',{cache:'no-store'}).then((r)=>r.json()).then(render).catch(()=>{}),3000);return}const events=new EventSource('/api/office/events');events.onopen=()=>{stream.textContent='stream: live'};events.addEventListener('snapshot',(e)=>{stream.textContent='stream: live';render(JSON.parse(e.data))});events.onerror=()=>{stream.textContent='stream: reconnecting'}}render(state);connect();
</script>
</body>
</html>`;
}

function officeAgent(role: string, tasks: TaskSummaryRow[], index: number): OfficeAgent {
  const task = tasks.find((item) => item.assignedTo === role && !isRestingStatus(item.status)) ?? tasks.find((item) => item.assignedTo === role) ?? null;
  const zoneId = task ? zoneForTask(task) : zoneForIdleRole(role);
  const zone = ZONES[zoneId] ?? ZONES.reception;
  const slot = index % 4;

  return {
    id: `agent-${slug(role)}`,
    name: roleLabel(role),
    role,
    status: task?.status ?? "idle",
    zoneId,
    x: clamp(zone.x + 6 + slot * 4, 4, 92),
    y: clamp(zone.y + 9 + (index % 2) * 6, 6, 91),
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? null,
    message: task ? messageForTask(task) : "대기 중",
  };
}

function zoneForTask(task: TaskSummaryRow): string {
  if (["approved", "completed"].includes(task.status)) return "done";
  if (["blocked", "failed", "needs_human", "split_task", "retry_with_different_agent"].includes(task.status)) return "attention";
  if (["needs_revision", "reviewing"].includes(task.status) || task.currentRound > 1) return "review";
  if (["director", "builder", "factory", "designer"].includes(task.assignedTo)) return task.assignedTo === "director" ? "planning" : task.assignedTo;
  return "reception";
}

function zoneForIdleRole(role: string): string {
  if (role === "director") return "planning";
  if (["builder", "factory", "designer"].includes(role)) return role;
  return "reception";
}

function messageForTask(task: TaskSummaryRow): string {
  if (task.status === "needs_human") return "Discord 확인 필요";
  if (task.status === "blocked") return "막힌 작업 확인 필요";
  if (task.status === "failed") return "실패 원인 확인 중";
  if (task.status === "approved") return "승인 완료";
  if (task.status === "completed") return "완료됨";
  if (task.status === "needs_revision") return "수정 라운드 진행 중";
  if (task.lockedBy) return `${task.lockedBy} 실행 중`;
  return task.title;
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = { director: "Director", builder: "Builder", factory: "Factory", designer: "Designer" };
  return labels[role] ?? role.split(/[-_\s]+/g).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function isRestingStatus(status: string): boolean {
  return ["approved", "completed", "cancelled"].includes(status);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sseJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("\n", "\\n");
}

function scriptJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
