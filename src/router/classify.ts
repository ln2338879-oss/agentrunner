import type { AgentRole, TaskType } from "../runtime/types";

export interface ClassifiedTask {
  type: TaskType;
  assignedTo: AgentRole;
  reason: string;
}

export function classifyTask(message: string): ClassifiedTask {
  const normalized = message.toLowerCase();

  if (containsAny(normalized, [
    "디자인",
    "이미지",
    "일러스트",
    "포스터",
    "배너",
    "썸네일",
    "로고",
    "목업",
    "시안",
    "컨셉아트",
    "픽셀아트",
    "스프라이트",
    "아이콘",
    "image",
    "illustration",
    "poster",
    "banner",
    "thumbnail",
    "logo",
    "mockup",
    "concept art",
    "pixel art",
    "sprite",
    "icon",
  ])) {
    return {
      type: "design",
      assignedTo: "designer",
      reason: "Visual design or image generation request detected.",
    };
  }

  if (containsAny(normalized, ["구현", "버그", "코드", "빌드", "테스트", "리팩토링", "fix", "bug", "code", "build", "test"])) {
    return {
      type: "implementation",
      assignedTo: "builder",
      reason: "Implementation, debugging, build, or test request detected.",
    };
  }

  if (containsAny(normalized, ["아이템", "몬스터", "npc", "대사", "퀘스트", "json", "csv", "에셋", "item", "monster", "dialogue", "quest"])) {
    return {
      type: "content",
      assignedTo: "factory",
      reason: "Bulk game content or data generation request detected.",
    };
  }

  return {
    type: "planning",
    assignedTo: "director",
    reason: "Defaulted to Director planning and routing.",
  };
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
