import type { RuntimeStore } from "../db/runtime-store";
import type { DashboardStatus, TaskSummaryRow } from "../db/runtime-store-types";

export type OfficeZoneId =
  | "planning"
  | "review"
  | "designer"
  | "reception"
  | "builder"
  | "factory"
  | "attention"
  | "done";

export interface OfficeZone {
  id: OfficeZoneId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  zoneId: OfficeZoneId;
  x: number;
  y: number;
  taskId: string | null;
  taskTitle: string | null;
  message: string;
  color: string;
}

export interface OfficeTask {
  id: string;
  title: string;
  status: string;
  role: string;
  zoneId: OfficeZoneId;
  updatedAt: string;
  href: string;
}

export interface OfficeLogEntry {
  id: string;
  label: string;
  status: string;
  createdAt: string;
}

export interface OfficeSnapshot {
  generatedAt: string;
  totals: DashboardStatus["totals"];
  zones: OfficeZone[];
  agents: OfficeAgent[];
  tasks: OfficeTask[];
  logs: OfficeLogEntry[];
  links: { status: string; tasks: string; health: string; bridge: string; events: string };
}

export type OfficeBridgeCommand =
  | { type: "office:summary"; payload: { generatedAt: string; totals: DashboardStatus["totals"] } }
  | { type: "office:zone-map"; payload: { zones: OfficeZone[] } }
  | { type: "npc:spawn-local"; payload: OfficeAgent }
  | { type: "npc:move-local"; payload: { npcId: string; zoneId: OfficeZoneId; x: number; y: number; status: string } }
  | { type: "npc:bubble"; payload: { npcId: string; text: string; taskId: string | null } }
  | { type: "taskboard:replace"; payload: { tasks: OfficeTask[] } }
  | { type: "office:log-replace"; payload: { logs: OfficeLogEntry[] } };

export interface OfficeBridgePayload {
  generatedAt: string;
  commands: OfficeBridgeCommand[];
  snapshot: OfficeSnapshot;
}

const DEFAULT_ROLES = ["director", "builder", "factory", "designer"];

export const OFFICE_ZONES: Record<OfficeZoneId, OfficeZone> = {
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
  const roles = uniqueRoles(status, tasks);

  return {
    generatedAt: status.generatedAt,
    totals: status.totals,
    zones: Object.values(OFFICE_ZONES),
    agents: roles.map((role, index) => officeAgent(role, tasks, index)),
    tasks: tasks.map(toOfficeTask),
    logs: tasks.slice(0, 12).map(toOfficeLogEntry),
    links: {
      status: "/api/status",
      tasks: "/api/tasks?limit=30",
      health: "/health",
      bridge: "/api/office/bridge",
      events: "/api/office/events",
    },
  };
}

export function buildOfficeBridgePayload(snapshot: OfficeSnapshot): OfficeBridgePayload {
  const commands: OfficeBridgeCommand[] = [
    { type: "office:summary", payload: { generatedAt: snapshot.generatedAt, totals: snapshot.totals } },
    { type: "office:zone-map", payload: { zones: snapshot.zones } },
    ...snapshot.agents.flatMap((agent): OfficeBridgeCommand[] => [
      { type: "npc:spawn-local", payload: agent },
      { type: "npc:move-local", payload: { npcId: agent.id, zoneId: agent.zoneId, x: agent.x, y: agent.y, status: agent.status } },
      { type: "npc:bubble", payload: { npcId: agent.id, text: agent.message, taskId: agent.taskId } },
    ]),
    { type: "taskboard:replace", payload: { tasks: snapshot.tasks } },
    { type: "office:log-replace", payload: { logs: snapshot.logs } },
  ];

  return { generatedAt: snapshot.generatedAt, commands, snapshot };
}

export function zoneForTask(task: TaskSummaryRow): OfficeZoneId {
  if (["approved", "completed"].includes(task.status)) return "done";
  if (["blocked", "failed", "needs_human", "split_task", "retry_with_different_agent"].includes(task.status)) {
    return "attention";
  }
  if (["needs_revision", "reviewing"].includes(task.status) || task.currentRound > 1) return "review";
  if (task.assignedTo === "director") return "planning";
  if (task.assignedTo === "builder") return "builder";
  if (task.assignedTo === "factory") return "factory";
  if (task.assignedTo === "designer") return "designer";
  return "reception";
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    director: "Director",
    builder: "Builder",
    factory: "Factory",
    designer: "Designer",
  };
  return labels[role] ?? role.split(/[-_\s]+/g).filter(Boolean).map(capitalize).join(" ");
}

export function roleColor(role: string): string {
  const colors: Record<string, string> = {
    director: "gold",
    builder: "blue",
    factory: "green",
    designer: "pink",
  };
  return colors[role] ?? "cyan";
}

function uniqueRoles(status: DashboardStatus, tasks: TaskSummaryRow[]): string[] {
  return Array.from(new Set([...DEFAULT_ROLES, ...status.byRole.map((row) => row.role), ...tasks.map((task) => task.assignedTo)])).filter(Boolean);
}

function officeAgent(role: string, tasks: TaskSummaryRow[], index: number): OfficeAgent {
  const task = tasks.find((item) => item.assignedTo === role && !isRestingStatus(item.status)) ?? tasks.find((item) => item.assignedTo === role) ?? null;
  const zoneId = task ? zoneForTask(task) : zoneForIdleRole(role);
  const zone = OFFICE_ZONES[zoneId];
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
    color: roleColor(role),
  };
}

function toOfficeTask(task: TaskSummaryRow): OfficeTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    role: task.assignedTo,
    zoneId: zoneForTask(task),
    updatedAt: task.updatedAt,
    href: `/api/tasks/${encodeURIComponent(task.id)}`,
  };
}

function toOfficeLogEntry(task: TaskSummaryRow): OfficeLogEntry {
  return {
    id: task.id,
    label: `${roleLabel(task.assignedTo)} · ${task.title}`,
    status: task.status,
    createdAt: task.updatedAt,
  };
}

function zoneForIdleRole(role: string): OfficeZoneId {
  if (role === "director") return "planning";
  if (role === "builder") return "builder";
  if (role === "factory") return "factory";
  if (role === "designer") return "designer";
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

function isRestingStatus(status: string): boolean {
  return ["approved", "completed", "cancelled"].includes(status);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
