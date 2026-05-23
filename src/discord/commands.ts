import type { RuntimeStore, TaskSummaryRow } from "../db/runtime-store";

export function isCommand(content: string): boolean {
  return content.trim().startsWith("!");
}

export function parseRetryCommand(content: string): string | null {
  const parts = content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "!retry") return null;
  return parts[1] ?? null;
}

export async function handleDirectorCommand(input: {
  content: string;
  store: RuntimeStore;
}): Promise<string | null> {
  const parts = input.content.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (command === "!help") {
    return [
      "AgentRunner commands:",
      "`!tasks` - 최근 작업 10개 보기",
      "`!task <TASK-ID>` - 특정 작업 상세 보기",
      "`!retry <TASK-ID>` - 기존 작업을 새 작업으로 재시도",
      "`!help` - 명령어 보기",
      "",
      "일반 메시지는 새 게임 개발 작업으로 생성됩니다.",
    ].join("\n");
  }

  if (command === "!tasks") {
    const tasks = input.store.listRecentTasks(10);
    if (tasks.length === 0) return "최근 작업이 없습니다.";
    return [
      "최근 작업:",
      "```text",
      ...tasks.map(formatTaskLine),
      "```",
    ].join("\n");
  }

  if (command === "!task") {
    const taskId = parts[1];
    if (!taskId) return "사용법: `!task TASK-...`";
    const task = input.store.getTask(taskId);
    if (!task) return `작업을 찾을 수 없습니다: ${taskId}`;
    const artifacts = input.store.listTaskArtifacts(taskId);
    const reviews = input.store.listTaskReviews(taskId);
    return [
      `작업 상세: ${task.id}`,
      "```text",
      `title: ${task.title}`,
      `type: ${task.type}`,
      `status: ${task.status}`,
      `assigned_to: ${task.assignedTo}`,
      `round: ${task.currentRound}`,
      `task_note: ${task.obsidianPath}`,
      `locked_by: ${task.lockedBy ?? ""}`,
      `lock_expires_at: ${task.lockExpiresAt ?? ""}`,
      "```",
      artifacts.length > 0 ? "Artifacts:\n" + artifacts.map((item) => `- ${item.type}: ${item.path}`).join("\n") : "Artifacts: none",
      reviews.length > 0 ? "Reviews:\n" + reviews.map((item) => `- round ${item.round}: ${item.verdict}`).join("\n") : "Reviews: none",
    ].join("\n");
  }

  if (command === "!retry") {
    const taskId = parts[1];
    if (!taskId) return "사용법: `!retry TASK-...`";
    return null;
  }

  return null;
}

function formatTaskLine(task: TaskSummaryRow): string {
  return `${task.id} | ${task.status} | ${task.assignedTo} | r${task.currentRound} | ${task.title}`;
}
