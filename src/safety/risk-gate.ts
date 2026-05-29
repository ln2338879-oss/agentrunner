import type { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export type RiskLevel = "low" | "medium" | "high";

export interface HumanApprovalRiskAssessment {
  enabled: boolean;
  level: RiskLevel;
  requiresHumanApproval: boolean;
  reasons: string[];
  signals: string[];
}

interface RiskGateConfigShape {
  RISK_APPROVAL_ENABLED?: boolean;
  RISK_APPROVAL_BLOCK_DESTRUCTIVE_COMMANDS?: boolean;
  RISK_APPROVAL_REQUIRE_FOR_DEPLOY?: boolean;
  RISK_APPROVAL_REQUIRE_FOR_SECRETS?: boolean;
  RISK_APPROVAL_REQUIRE_FOR_DEPENDENCY_CHANGES?: boolean;
  RISK_APPROVAL_REQUIRE_FOR_CI_CHANGES?: boolean;
  REQUIRE_USER_APPROVAL_BEFORE_COMMIT?: boolean;
}

interface RiskRule {
  label: string;
  reason: string;
  enabled: boolean;
  patterns: RegExp[];
}

export function assessHumanApprovalRisk(input: {
  prompt: string;
  action: string;
  role: AgentRole;
  config: RuntimeConfig;
}): HumanApprovalRiskAssessment {
  const options = riskGateOptions(input.config);
  if (!options.enabled) return emptyAssessment(false);
  if (!canMutateWorkspace(input.action, input.role)) return emptyAssessment(true);

  const reasons: string[] = [];
  const signals: string[] = [];
  for (const rule of riskRules(options)) {
    if (!rule.enabled) continue;
    if (!matchesAny(input.prompt, rule.patterns)) continue;
    signals.push(rule.label);
    reasons.push(rule.reason);
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    enabled: true,
    level: uniqueReasons.length > 0 ? "high" : "low",
    requiresHumanApproval: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    signals: [...new Set(signals)],
  };
}

export function formatHumanApprovalRiskReport(assessment: HumanApprovalRiskAssessment): string {
  return [
    "# Human Approval Required",
    "",
    "AgentRunner detected a high-risk operation before executing this workflow step.",
    "A human must explicitly approve, narrow, or revise the request before the agent continues.",
    "",
    `Risk level: ${assessment.level}`,
    "",
    "## Blocking Reasons",
    formatList(assessment.reasons, "No blocking reasons."),
    "",
    "## Matched Signals",
    formatList(assessment.signals, "No matched signals."),
    "",
    "## How to continue",
    "Approve the operation explicitly, narrow the request to a safer scope, or remove the risky operation from the task.",
  ].join("\n");
}

function riskGateOptions(config: RuntimeConfig) {
  const raw = config as unknown as RiskGateConfigShape;
  return {
    enabled: raw.RISK_APPROVAL_ENABLED ?? true,
    blockDestructiveCommands: raw.RISK_APPROVAL_BLOCK_DESTRUCTIVE_COMMANDS ?? true,
    requireForCommit: raw.REQUIRE_USER_APPROVAL_BEFORE_COMMIT ?? true,
    requireForDeploy: raw.RISK_APPROVAL_REQUIRE_FOR_DEPLOY ?? true,
    requireForSecrets: raw.RISK_APPROVAL_REQUIRE_FOR_SECRETS ?? true,
    requireForDependencyChanges: raw.RISK_APPROVAL_REQUIRE_FOR_DEPENDENCY_CHANGES ?? true,
    requireForCiChanges: raw.RISK_APPROVAL_REQUIRE_FOR_CI_CHANGES ?? true,
  };
}

function riskRules(options: ReturnType<typeof riskGateOptions>): RiskRule[] {
  return [
    {
      label: "repository publishing operation",
      reason: "The task asks for a commit, push, merge, tag, release, or similar repository-publishing operation.",
      enabled: options.requireForCommit,
      patterns: [
        /\bgit\s+(commit|push|merge|rebase|tag)\b/i,
        /\b(commit|push|merge|rebase|tag|release)\s+(the\s+)?(changes|branch|code|work|pr|pull request)\b/i,
        /\b(create|open|publish)\s+(a\s+)?(release|tag)\b/i,
        /커밋|푸시|머지|병합|릴리스|태그\s*생성/,
      ],
    },
    {
      label: "deployment or production operation",
      reason: "The task asks for deployment, production rollout, infrastructure changes, or externally visible service changes.",
      enabled: options.requireForDeploy,
      patterns: [
        /\bdeploy(ment)?\b/i,
        /\bproduction\b/i,
        /\brollout\b/i,
        /\binfrastructure\b/i,
        /\bterraform\b/i,
        /\bkubectl\b/i,
        /\bhelm\b/i,
        /배포|프로덕션|운영\s*반영|인프라/,
      ],
    },
    {
      label: "destructive command or data deletion",
      reason: "The task contains a destructive command or data-deletion operation that could remove files, permissions, disks, or database records.",
      enabled: options.blockDestructiveCommands,
      patterns: [
        /\b(force\s+delete|recursive\s+delete|delete\s+all|wipe|format\s+disk)\b/i,
        /\b(drop|truncate)\s+(table|database|schema)\b/i,
        /\b(change\s+owner|change\s+permissions)\s+recursively\b/i,
        /삭제|초기화|전체\s*삭제|데이터\s*삭제|권한\s*일괄\s*변경/,
      ],
    },
    {
      label: "secret credential or auth change",
      reason: "The task touches credentials, tokens, secrets, private keys, authentication, authorization, or environment files.",
      enabled: options.requireForSecrets,
      patterns: [
        /(^|[\s/])\.env(\.|\s|$)/i,
        /\b(secret|token|credential|password|api key|private key|oauth|auth|permission|rbac)\b/i,
        /\bssh\s+key\b/i,
        /인증|권한|토큰|비밀번호|비밀키|시크릿|API\s*키/,
      ],
    },
    {
      label: "dependency or lockfile change",
      reason: "The task asks to change dependencies, package manifests, or lockfiles.",
      enabled: options.requireForDependencyChanges,
      patterns: [
        /\b(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock)\b/i,
        /\b(npm\s+install|npm\s+i|npm\s+update|bun\s+add|bun\s+install|pnpm\s+add|yarn\s+add|pip\s+install)\b/i,
        /\bdependency|dependencies|package manager\b/i,
        /의존성|패키지\s*추가|패키지\s*업데이트|락파일|lockfile/i,
      ],
    },
    {
      label: "ci workflow or automation policy change",
      reason: "The task changes CI/CD workflows, automation scripts, review gates, or runtime safety policy.",
      enabled: options.requireForCiChanges,
      patterns: [
        /\.github\/workflows\//i,
        /\b(GitHub Actions|workflow|CI|CD|pipeline)\b/i,
        /\b(review gate|strict review|safety guard|risk gate)\b/i,
        /\bscripts\//i,
        /CI|CD|깃허브\s*액션|워크플로우|파이프라인|리뷰\s*게이트|안전장치/,
      ],
    },
    {
      label: "path outside project workspace",
      reason: "The task appears to access files outside the project workspace or user-level sensitive directories.",
      enabled: true,
      patterns: [
        /\.\.\//,
        /(^|\s)~\//,
        /\/etc\//,
        /\/var\//,
        /\/usr\//,
        /\.ssh\//,
      ],
    },
  ];
}

function canMutateWorkspace(action: string, role: AgentRole): boolean {
  if (action === "review" || action === "arbitrate" || action === "plan") return false;
  return role === "builder" || role === "factory" || role === "designer";
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function emptyAssessment(enabled: boolean): HumanApprovalRiskAssessment {
  return {
    enabled,
    level: "low",
    requiresHumanApproval: false,
    reasons: [],
    signals: [],
  };
}

function formatList(values: string[], emptyValue: string): string {
  if (values.length === 0) return emptyValue;
  return values.map((value) => `- ${value}`).join("\n");
}
