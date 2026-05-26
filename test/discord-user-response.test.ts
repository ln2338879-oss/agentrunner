import { describe, expect, test } from "bun:test";
import { statusChannel } from "../src/discord/channels";
import { formatUserTaskResponse } from "../src/discord/user-response";
import { loadConfig } from "../src/config";

describe("Discord user response formatting", () => {
  test("shows final output before compact metadata", () => {
    const message = formatUserTaskResponse({
      result: {
        taskId: "TASK-1",
        assignedTo: "factory",
        reportPath: "06_FactoryOutputs/TASK-1.md",
        finalOutput: "완성된 답변 본문입니다.",
        verdict: "APPROVED",
      },
      prefix: "Task TASK-1",
    });

    expect(message).toContain("완성된 답변 본문입니다.");
    expect(message).toContain("역할: factory");
    expect(message).toContain("리뷰: APPROVED");
    expect(message).toContain("작업 ID: TASK-1");
  });

  test("falls back cleanly when final output is missing", () => {
    const message = formatUserTaskResponse({
      result: {
        taskId: "TASK-2",
        assignedTo: "builder",
        reportPath: "05_BuilderReports/TASK-2.md",
      },
    });

    expect(message).toContain("Discord에 표시할 최종 본문이 없습니다");
    expect(message).toContain("보고서: 05_BuilderReports/TASK-2.md");
  });
});

describe("Discord status channel routing", () => {
  test("routes builder status to build log when available", () => {
    const config = loadConfig({
      BUILD_LOG_CHANNEL_ID: "build-log",
      REVIEW_LOG_CHANNEL_ID: "review-log",
      GAME_DIRECTOR_CHANNEL_ID: "director",
    });

    expect(statusChannel(config, "builder")).toBe("build-log");
  });

  test("routes non-builder status to review log", () => {
    const config = loadConfig({
      BUILD_LOG_CHANNEL_ID: "build-log",
      REVIEW_LOG_CHANNEL_ID: "review-log",
      GAME_DIRECTOR_CHANNEL_ID: "director",
    });

    expect(statusChannel(config, "designer")).toBe("review-log");
    expect(statusChannel(config, "factory")).toBe("review-log");
    expect(statusChannel(config, "director")).toBe("review-log");
  });
});
