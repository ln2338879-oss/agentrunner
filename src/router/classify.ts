import type { AgentRole, TaskType } from "../runtime/types";

export type ClassificationConfidence = "high" | "medium" | "low";

export interface ClassifiedTask {
  type: TaskType;
  assignedTo: AgentRole;
  reason: string;
  confidence: ClassificationConfidence;
  scores: Record<AgentRole, number>;
  signals: string[];
  ambiguity: string[];
}

type SignalCategory = "implementation" | "design" | "content" | "planning";

interface SignalRule {
  category: SignalCategory;
  weight: number;
  patterns: RegExp[];
  label: string;
}

const ROLE_BY_CATEGORY: Record<SignalCategory, AgentRole> = {
  implementation: "builder",
  design: "designer",
  content: "factory",
  planning: "director",
};

const TASK_TYPE_BY_ROLE: Record<AgentRole, TaskType> = {
  builder: "implementation",
  designer: "design",
  factory: "content",
  director: "planning",
};

const SIGNAL_RULES: SignalRule[] = [
  {
    category: "implementation",
    weight: 5,
    label: "explicit bug/fix/debug request",
    patterns: [
      /\bfix\b/i,
      /\bbug\b/i,
      /\bdebug\b/i,
      /\berror\b/i,
      /\bcrash\b/i,
      /버그/,
      /오류/,
      /에러/,
      /고쳐/,
      /수정/,
      /디버그/,
      /깨짐/,
      /안됨/,
      /안 돼/,
    ],
  },
  {
    category: "implementation",
    weight: 4,
    label: "code/build/test implementation work",
    patterns: [
      /\bcode\b/i,
      /\bbuild\b/i,
      /\btest\b/i,
      /\brefactor\b/i,
      /\bcompile\b/i,
      /\bapi\b/i,
      /\bcli\b/i,
      /구현/,
      /코드/,
      /빌드/,
      /테스트/,
      /리팩토링/,
      /컴파일/,
      /함수/,
      /모듈/,
      /스크립트/,
    ],
  },
  {
    category: "implementation",
    weight: 4,
    label: "technical image/file processing request",
    patterns: [
      /이미지\s*(처리|파싱|업로드|첨부|분석|인식)/,
      /파일\s*(처리|파싱|업로드|첨부)/,
      /image\s*(processing|parser|parsing|upload|attachment|analysis)/i,
      /attachment\s*(parser|upload|handling)/i,
    ],
  },
  {
    category: "design",
    weight: 4,
    label: "visual asset creation request",
    patterns: [
      /이미지\s*(생성|제작|만들|그려|렌더)/,
      /그림\s*(생성|제작|만들|그려)/,
      /디자인\s*(생성|제작|만들|해줘)/,
      /\b(generate|create|draw|render)\b.*\b(image|poster|banner|logo|icon|sprite|illustration)\b/i,
      /\b(image|poster|banner|logo|icon|sprite|illustration)\b.*\b(generate|create|draw|render)\b/i,
    ],
  },
  {
    category: "design",
    weight: 3,
    label: "visual design noun",
    patterns: [
      /디자인/,
      /일러스트/,
      /포스터/,
      /배너/,
      /썸네일/,
      /로고/,
      /목업/,
      /시안/,
      /컨셉아트/,
      /픽셀아트/,
      /스프라이트/,
      /아이콘/,
      /\bdesign\b/i,
      /\billustration\b/i,
      /\bposter\b/i,
      /\bbanner\b/i,
      /\bthumbnail\b/i,
      /\blogo\b/i,
      /\bmockup\b/i,
      /\bconcept art\b/i,
      /\bpixel art\b/i,
      /\bsprite\b/i,
      /\bicon\b/i,
    ],
  },
  {
    category: "content",
    weight: 4,
    label: "structured content/data generation request",
    patterns: [
      /\bjson\b/i,
      /\bcsv\b/i,
      /\byaml\b/i,
      /\btable\b/i,
      /데이터/,
      /테이블/,
      /목록/,
      /리스트/,
      /정리/,
      /표로/,
    ],
  },
  {
    category: "content",
    weight: 3,
    label: "game content noun",
    patterns: [
      /아이템/,
      /몬스터/,
      /대사/,
      /퀘스트/,
      /스킬/,
      /스탯/,
      /밸런스/,
      /\bnpc\b/i,
      /\bitem\b/i,
      /\bmonster\b/i,
      /\bdialogue\b/i,
      /\bquest\b/i,
      /\bskill\b/i,
      /\bstats?\b/i,
      /\bbalance\b/i,
    ],
  },
  {
    category: "planning",
    weight: 3,
    label: "planning/analysis request",
    patterns: [
      /계획/,
      /기획/,
      /설계/,
      /분석/,
      /비교/,
      /구조/,
      /전략/,
      /로드맵/,
      /\bplan\b/i,
      /\bplanning\b/i,
      /\banalyze\b/i,
      /\banalysis\b/i,
      /\bcompare\b/i,
      /\barchitecture\b/i,
      /\bstrategy\b/i,
      /\broadmap\b/i,
    ],
  },
];

const CREATE_OR_GENERATE_PATTERNS = [
  /만들/,
  /생성/,
  /제작/,
  /작성/,
  /정리/,
  /뽑아/,
  /\bcreate\b/i,
  /\bgenerate\b/i,
  /\bwrite\b/i,
  /\blist\b/i,
];

export function classifyTask(message: string): ClassifiedTask {
  const normalized = normalizeMessage(message);
  const scores: Record<AgentRole, number> = {
    director: 0,
    builder: 0,
    factory: 0,
    designer: 0,
  };
  const signalHits: string[] = [];
  const categoryHits = new Set<SignalCategory>();

  for (const rule of SIGNAL_RULES) {
    if (!matchesAny(normalized, rule.patterns)) continue;
    const role = ROLE_BY_CATEGORY[rule.category];
    scores[role] += rule.weight;
    categoryHits.add(rule.category);
    signalHits.push(rule.label);
  }

  applyContextualAdjustments({ normalized, scores, signalHits });

  const ranked = rankScores(scores);
  const top = ranked[0];
  const second = ranked[1];
  const ambiguity = detectAmbiguity({ ranked, categoryHits, normalized });

  if (!top || top.score <= 0) {
    return buildResult({
      assignedTo: "director",
      reason: "No strong routing signal was found; defaulted to Director planning.",
      confidence: "low",
      scores,
      signals: signalHits,
      ambiguity,
    });
  }

  if (shouldRouteAmbiguousRequestToDirector({ top, second, ambiguity, scores, normalized })) {
    return buildResult({
      assignedTo: "director",
      reason: `Ambiguous routing signals detected; Director should plan and split the task. Top scores: ${formatScores(scores)}.`,
      confidence: "low",
      scores,
      signals: signalHits,
      ambiguity,
    });
  }

  const confidence = confidenceFor(top.score, second?.score ?? 0, ambiguity.length);
  return buildResult({
    assignedTo: top.role,
    reason: `Routed to ${top.role} using scored signals. Scores: ${formatScores(scores)}.`,
    confidence,
    scores,
    signals: signalHits,
    ambiguity,
  });
}

function applyContextualAdjustments(input: {
  normalized: string;
  scores: Record<AgentRole, number>;
  signalHits: string[];
}): void {
  const hasImplementationSignal = input.scores.builder >= 4;
  const hasVisualSignal = input.scores.designer > 0;
  const hasContentSignal = input.scores.factory > 0;
  const hasCreationSignal = matchesAny(input.normalized, CREATE_OR_GENERATE_PATTERNS);

  if (hasImplementationSignal && hasVisualSignal) {
    input.scores.builder += 3;
    input.signalHits.push("implementation override for visual technical/fix request");
  }

  if (hasImplementationSignal && hasContentSignal && /시스템|system|코드|code|구현|버그|fix|bug|오류|에러/i.test(input.normalized)) {
    input.scores.builder += 3;
    input.signalHits.push("implementation override for game-content system/code request");
  }

  if (hasContentSignal && hasCreationSignal && input.scores.builder === 0) {
    input.scores.factory += 2;
    input.signalHits.push("content generation boost");
  }

  if (hasVisualSignal && hasCreationSignal && input.scores.builder === 0) {
    input.scores.designer += 2;
    input.signalHits.push("visual creation boost");
  }

  if (input.scores.director > 0 && (input.scores.builder > 0 || input.scores.factory > 0 || input.scores.designer > 0)) {
    input.scores.director += 1;
    input.signalHits.push("planning signal mixed with execution signal");
  }
}

function detectAmbiguity(input: {
  ranked: Array<{ role: AgentRole; score: number }>;
  categoryHits: Set<SignalCategory>;
  normalized: string;
}): string[] {
  const ambiguity: string[] = [];
  const top = input.ranked[0];
  const second = input.ranked[1];

  if (top && second && top.score > 0 && second.score > 0 && top.score - second.score <= 1) {
    ambiguity.push(`Close role scores: ${top.role}=${top.score}, ${second.role}=${second.score}`);
  }

  if (input.categoryHits.size >= 3) {
    ambiguity.push("Three or more routing categories were detected.");
  }

  if (/에셋|asset/i.test(input.normalized) && input.categoryHits.has("design") && input.categoryHits.has("content")) {
    ambiguity.push("Asset request can mean visual asset or content/data asset.");
  }

  return ambiguity;
}

function shouldRouteAmbiguousRequestToDirector(input: {
  top?: { role: AgentRole; score: number };
  second?: { role: AgentRole; score: number };
  ambiguity: string[];
  scores: Record<AgentRole, number>;
  normalized: string;
}): boolean {
  if (!input.top) return true;
  if (input.ambiguity.length === 0) return false;

  const builderHasStrongOverride = input.scores.builder >= 7 && /버그|오류|에러|수정|고쳐|fix|bug|code|코드|구현|test|테스트/i.test(input.normalized);
  if (builderHasStrongOverride) return false;

  const topMargin = input.second ? input.top.score - input.second.score : input.top.score;
  return topMargin <= 1;
}

function buildResult(input: {
  assignedTo: AgentRole;
  reason: string;
  confidence: ClassificationConfidence;
  scores: Record<AgentRole, number>;
  signals: string[];
  ambiguity: string[];
}): ClassifiedTask {
  return {
    type: TASK_TYPE_BY_ROLE[input.assignedTo],
    assignedTo: input.assignedTo,
    reason: input.reason,
    confidence: input.confidence,
    scores: input.scores,
    signals: [...new Set(input.signals)],
    ambiguity: input.ambiguity,
  };
}

function confidenceFor(topScore: number, secondScore: number, ambiguityCount: number): ClassificationConfidence {
  const margin = topScore - secondScore;
  if (topScore >= 7 && margin >= 3 && ambiguityCount === 0) return "high";
  if (topScore >= 5 && margin >= 2) return "medium";
  return "low";
}

function rankScores(scores: Record<AgentRole, number>): Array<{ role: AgentRole; score: number }> {
  return (Object.entries(scores) as Array<[AgentRole, number]>)
    .map(([role, score]) => ({ role, score }))
    .sort((left, right) => right.score - left.score || roleSortWeight(left.role) - roleSortWeight(right.role));
}

function roleSortWeight(role: AgentRole): number {
  if (role === "director") return 0;
  if (role === "builder") return 1;
  if (role === "factory") return 2;
  return 3;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatScores(scores: Record<AgentRole, number>): string {
  return `director=${scores.director}, builder=${scores.builder}, factory=${scores.factory}, designer=${scores.designer}`;
}
