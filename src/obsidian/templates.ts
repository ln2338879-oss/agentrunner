import type { AgentRole, TaskType } from "../runtime/types";

export function taskNote(input: {
  id: string;
  title: string;
  type: TaskType;
  assignedTo: AgentRole;
  request: string;
  discordMessageId?: string;
  discordChannelId?: string;
}): string {
  return `---
id: ${input.id}
title: ${JSON.stringify(input.title)}
type: ${input.type}
status: pending
assigned_to: ${input.assignedTo}
created_by: director
review_required: true
${input.discordMessageId ? `discord_message_id: ${input.discordMessageId}\n` : ""}${input.discordChannelId ? `discord_channel_id: ${input.discordChannelId}\n` : ""}---

# 요청

${input.request}

# 작업 지시

Director가 이 요청을 분석하고 Builder 또는 Factory에게 전달합니다.

# 완료 기준

- 결과물이 Obsidian에 저장됨
- 필요한 경우 빌드/테스트 결과가 첨부됨
- Director 리뷰가 APPROVED 상태가 됨
`;
}

export function reviewNote(input: {
  taskId: string;
  verdict: "APPROVED" | "NEEDS_REVISION" | "BLOCKED";
  round: number;
  body: string;
}): string {
  return `---
task_id: ${input.taskId}
reviewer: director
verdict: ${input.verdict}
round: ${input.round}
---

# 리뷰 결과

${input.body}
`;
}

export function botReportNote(input: {
  taskId: string;
  role: AgentRole;
  status: string;
  body: string;
}): string {
  return `---
task_id: ${input.taskId}
created_by: ${input.role}
status: ${input.status}
---

# ${input.role} 결과 보고

${input.body}
`;
}
