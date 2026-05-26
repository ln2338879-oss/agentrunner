export interface UserVisibleTaskResult {
  taskId: string;
  assignedTo: string;
  reportPath: string;
  reviewPath?: string;
  approvedPath?: string;
  verdict?: string;
  finalOutput?: string;
}

export function formatUserTaskResponse(input: {
  result: UserVisibleTaskResult;
  prefix?: string;
}): string {
  const body = input.result.finalOutput?.trim();
  const header = input.prefix ?? `Task ${input.result.taskId}`;

  if (body) {
    return [
      header,
      "",
      trimDiscord(body, 1700),
      "",
      compactMeta(input.result),
    ].filter(Boolean).join("\n");
  }

  return [
    header,
    "",
    "작업은 완료됐지만 Discord에 표시할 최종 본문이 없습니다. 자세한 결과는 기록 파일을 확인하세요.",
    "",
    compactMeta(input.result),
  ].filter(Boolean).join("\n");
}

function compactMeta(result: UserVisibleTaskResult): string {
  return [
    `역할: ${result.assignedTo}`,
    result.verdict ? `리뷰: ${result.verdict}` : undefined,
    `작업 ID: ${result.taskId}`,
    result.approvedPath ? `최종 기록: ${result.approvedPath}` : undefined,
    !result.approvedPath ? `보고서: ${result.reportPath}` : undefined,
    result.reviewPath ? `검토 기록: ${result.reviewPath}` : undefined,
  ].filter(Boolean).join("\n");
}

function trimDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n...Discord 표시 길이 때문에 일부만 보여줬습니다. 전체 내용은 기록 파일을 확인하세요.`;
}
