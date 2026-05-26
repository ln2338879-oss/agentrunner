export type ProviderErrorKind =
  | "auth"
  | "session_expired"
  | "rate_limit"
  | "usage_limit"
  | "timeout"
  | "network"
  | "validation"
  | "unknown";

export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  needsHuman: boolean;
  reason: string;
  remediation: string;
}

const AUTH_PATTERNS = [
  /unauthorized/i,
  /authentication/i,
  /auth(entication)? failed/i,
  /invalid api key/i,
  /api key.*invalid/i,
  /not logged in/i,
  /login required/i,
  /permission denied/i,
  /forbidden/i,
  /401\b/,
  /403\b/,
];

const SESSION_PATTERNS = [
  /oauth/i,
  /token expired/i,
  /expired token/i,
  /session expired/i,
  /refresh token/i,
  /re-auth/i,
  /reauth/i,
  /browser login/i,
  /claude\.ai\/settings\/usage/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429\b/,
  /quota exceeded/i,
  /temporarily unavailable/i,
  /overloaded/i,
];

const USAGE_LIMIT_PATTERNS = [
  /usage limit/i,
  /extra usage/i,
  /credits? exhausted/i,
  /insufficient quota/i,
  /billing/i,
  /payment required/i,
  /plan limits/i,
  /spend limit/i,
];

const NETWORK_PATTERNS = [
  /econnrefused/i,
  /enotfound/i,
  /network/i,
  /socket hang up/i,
  /connection reset/i,
  /connection refused/i,
  /fetch failed/i,
];

export function classifyProviderError(input: {
  provider: string;
  error?: string;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
}): ClassifiedProviderError {
  const text = [input.error, input.stderr, input.stdout].filter(Boolean).join("\n");

  if (input.timedOut) {
    return {
      kind: "timeout",
      needsHuman: false,
      reason: `${input.provider} command timed out.`,
      remediation: "Check whether the provider is hanging, then retry the task when safe.",
    };
  }

  if (matchesAny(text, USAGE_LIMIT_PATTERNS)) {
    return {
      kind: "usage_limit",
      needsHuman: true,
      reason: `${input.provider} appears to have hit a usage, billing, or plan limit.`,
      remediation: "A human must review account usage, billing, or plan limits before retrying.",
    };
  }

  if (matchesAny(text, SESSION_PATTERNS)) {
    return {
      kind: "session_expired",
      needsHuman: true,
      reason: `${input.provider} session or OAuth token appears to require renewal.`,
      remediation: "A human must re-authenticate the CLI/session, then requeue the task.",
    };
  }

  if (matchesAny(text, AUTH_PATTERNS)) {
    return {
      kind: "auth",
      needsHuman: true,
      reason: `${input.provider} authentication or permission failed.`,
      remediation: "A human must verify credentials, permissions, and local CLI login state before retrying.",
    };
  }

  if (matchesAny(text, RATE_LIMIT_PATTERNS)) {
    return {
      kind: "rate_limit",
      needsHuman: true,
      reason: `${input.provider} appears to be rate limited or quota constrained.`,
      remediation: "A human must decide whether to wait, increase quota, or manually requeue later.",
    };
  }

  if (matchesAny(text, NETWORK_PATTERNS)) {
    return {
      kind: "network",
      needsHuman: false,
      reason: `${input.provider} failed due to a likely network or local service issue.`,
      remediation: "Check local network/service availability and retry if transient.",
    };
  }

  return {
    kind: "unknown",
    needsHuman: false,
    reason: `${input.provider} failed with an unclassified error.`,
    remediation: "Inspect the task report and logs before retrying.",
  };
}

export function formatHumanEscalation(input: {
  provider: string;
  command?: string;
  classification: ClassifiedProviderError;
  stderr?: string;
  stdout?: string;
}): string {
  return [
    "# Human Intervention Required",
    "",
    `provider: ${input.provider}`,
    input.command ? `command: ${input.command}` : undefined,
    `error_kind: ${input.classification.kind}`,
    "",
    "## Reason",
    input.classification.reason,
    "",
    "## Required Human Action",
    input.classification.remediation,
    "",
    "## Provider Output",
    "```text",
    trimLongOutput([input.stderr, input.stdout].filter(Boolean).join("\n\n") || "No provider output."),
    "```",
  ].filter(Boolean).join("\n");
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function trimLongOutput(value: string, maxLength = 12000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}
