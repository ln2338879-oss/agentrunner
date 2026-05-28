import type { RuntimeConfig } from "../config";
import type { ReviewVerdict } from "../runtime/types";
import { runShellCommand, type ShellCommandResult } from "../utils/command";

export interface StrictReviewValidationResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface StrictReviewAssessment {
  enabled: boolean;
  supported: boolean;
  passed: boolean;
  changedFiles: string[];
  hasCodeChanges: boolean;
  hasTestChanges: boolean;
  riskyChangedFiles: string[];
  lockfileChangedFiles: string[];
  blockingIssues: string[];
  validationResults: StrictReviewValidationResult[];
  context: string;
}

export async function assessStrictReview(input: {
  workspacePath: string;
  config: RuntimeConfig;
  includeValidation?: boolean;
}): Promise<StrictReviewAssessment> {
  const enabled = input.config.STRICT_REVIEW_ENABLED;
  if (!enabled) {
    return emptyAssessment({ enabled: false, supported: true, context: "Strict review is disabled." });
  }

  const changedFiles = await listChangedFiles(input.workspacePath, input.config.REVIEW_CONTEXT_COMMAND_TIMEOUT_MS);
  if (!changedFiles.supported) {
    return emptyAssessment({
      enabled: true,
      supported: false,
      context: [
        "## Strict Review Gate",
        "Strict review is enabled, but git changed-file analysis is unavailable.",
        changedFiles.reason ? `Reason: ${changedFiles.reason}` : undefined,
      ].filter(Boolean).join("\n"),
    });
  }

  const codeChangedFiles = changedFiles.files.filter(isCodeFile);
  const testChangedFiles = changedFiles.files.filter(isTestFile);
  const riskyChangedFiles = changedFiles.files.filter(isRiskyFile);
  const lockfileChangedFiles = changedFiles.files.filter(isLockfile);
  const validationResults = input.includeValidation === false
    ? []
    : await runValidationCommands(input.workspacePath, input.config);

  const blockingIssues: string[] = [];
  if (input.config.STRICT_REVIEW_REQUIRE_TESTS && codeChangedFiles.length > 0 && testChangedFiles.length === 0) {
    blockingIssues.push(
      "Code files changed but no test/spec files changed. Add or update meaningful tests, or explicitly justify why tests are not applicable.",
    );
  }

  if (input.config.STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES && lockfileChangedFiles.length > 0) {
    blockingIssues.push(
      `Lock/dependency files changed under strict review: ${lockfileChangedFiles.join(", ")}. Human approval or explicit dependency-change justification is required.`,
    );
  }

  if (input.config.STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR) {
    for (const result of validationResults) {
      if (!result.ok) {
        blockingIssues.push(`Validation command failed: ${result.command}`);
      }
    }
  }

  const context = formatStrictReviewContext({
    changedFiles: changedFiles.files,
    codeChangedFiles,
    testChangedFiles,
    riskyChangedFiles,
    lockfileChangedFiles,
    validationResults,
    blockingIssues,
    requireTests: input.config.STRICT_REVIEW_REQUIRE_TESTS,
    includeValidation: input.includeValidation !== false,
  });

  return {
    enabled: true,
    supported: true,
    passed: blockingIssues.length === 0,
    changedFiles: changedFiles.files,
    hasCodeChanges: codeChangedFiles.length > 0,
    hasTestChanges: testChangedFiles.length > 0,
    riskyChangedFiles,
    lockfileChangedFiles,
    blockingIssues,
    validationResults,
    context,
  };
}

export function enforceStrictReviewGate(input: {
  verdict: ReviewVerdict;
  output: string;
  assessment: StrictReviewAssessment;
}): { verdict: ReviewVerdict; output: string } {
  if (!input.assessment.enabled || input.assessment.passed || input.verdict !== "APPROVED") {
    return { verdict: input.verdict, output: input.output };
  }

  const gateReport = [
    "## Strict Review Gate Override",
    "The reviewer returned APPROVED, but strict review gates found blocking issues. The verdict was downgraded to NEEDS_REVISION.",
    "",
    "### Blocking Issues",
    ...input.assessment.blockingIssues.map((issue) => `- ${issue}`),
    "",
    input.assessment.context,
  ].join("\n");

  return {
    verdict: "NEEDS_REVISION",
    output: [input.output, "", gateReport].join("\n"),
  };
}

function emptyAssessment(input: { enabled: boolean; supported: boolean; context: string }): StrictReviewAssessment {
  return {
    enabled: input.enabled,
    supported: input.supported,
    passed: true,
    changedFiles: [],
    hasCodeChanges: false,
    hasTestChanges: false,
    riskyChangedFiles: [],
    lockfileChangedFiles: [],
    blockingIssues: [],
    validationResults: [],
    context: input.context,
  };
}

async function listChangedFiles(workspacePath: string, timeoutMs: number): Promise<{
  supported: boolean;
  files: string[];
  reason?: string;
}> {
  const insideWorkTree = await runShellCommand({
    command: "git rev-parse --is-inside-work-tree",
    cwd: workspacePath,
    timeoutMs,
  });

  if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
    return {
      supported: false,
      files: [],
      reason: "Workspace is not a git work tree.",
    };
  }

  const result = await runShellCommand({
    command: [
      "git diff --name-only --relative",
      "git diff --name-only --cached --relative",
      "git ls-files --others --exclude-standard",
    ].join(" && "),
    cwd: workspacePath,
    timeoutMs,
  });

  if (!result.ok) {
    return {
      supported: false,
      files: [],
      reason: trimOutput(result.stderr || result.stdout || "Failed to list changed files."),
    };
  }

  return {
    supported: true,
    files: dedupeLines(result.stdout),
  };
}

async function runValidationCommands(
  workspacePath: string,
  config: RuntimeConfig,
): Promise<StrictReviewValidationResult[]> {
  const commands = strictReviewCommands(config);
  const results: StrictReviewValidationResult[] = [];
  for (const command of commands) {
    const result = await runShellCommand({
      command,
      cwd: workspacePath,
      timeoutMs: config.STRICT_REVIEW_COMMAND_TIMEOUT_MS,
    });
    results.push(formatValidationResult(command, result));
  }
  return results;
}

function strictReviewCommands(config: RuntimeConfig): string[] {
  const configured = splitCommands(config.STRICT_REVIEW_COMMANDS);
  if (configured.length > 0) return configured;
  return [config.BUILDER_TEST_COMMAND, config.BUILDER_BUILD_COMMAND]
    .map((command) => command.trim())
    .filter(Boolean);
}

function splitCommands(value: string): string[] {
  return value
    .split(/\r?\n|\|\|/)
    .map((command) => command.trim())
    .filter(Boolean);
}

function formatValidationResult(command: string, result: ShellCommandResult): StrictReviewValidationResult {
  return {
    command,
    ok: result.ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output: trimOutput(result.stdout || result.stderr || "<no output>"),
  };
}

function formatStrictReviewContext(input: {
  changedFiles: string[];
  codeChangedFiles: string[];
  testChangedFiles: string[];
  riskyChangedFiles: string[];
  lockfileChangedFiles: string[];
  validationResults: StrictReviewValidationResult[];
  blockingIssues: string[];
  requireTests: boolean;
  includeValidation: boolean;
}): string {
  return [
    "## Strict Review Gate",
    "Strict review is enabled. APPROVED is allowed only when implementation scope, tests, validation, and risk checks are acceptable.",
    input.requireTests ? "- Code changes require meaningful test/spec changes unless explicitly justified." : "- Test changes are recommended but not required by configuration.",
    "- Validation command failures are blocking when STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR=true.",
    "- Risky runtime/provider/workflow/database changes require extra scrutiny.",
    "",
    "### Changed Files",
    formatList(input.changedFiles, "<none>"),
    "",
    "### Code Files Changed",
    formatList(input.codeChangedFiles, "<none>"),
    "",
    "### Test Files Changed",
    formatList(input.testChangedFiles, "<none>"),
    "",
    "### Risky Files Changed",
    formatList(input.riskyChangedFiles, "<none>"),
    "",
    "### Lock/Dependency Files Changed",
    formatList(input.lockfileChangedFiles, "<none>"),
    "",
    "### Validation Commands",
    input.includeValidation ? formatValidationResults(input.validationResults) : "Validation command execution deferred to post-review gate.",
    "",
    "### Strict Gate Blocking Issues",
    formatList(input.blockingIssues, "<none>"),
  ].join("\n");
}

function formatValidationResults(results: StrictReviewValidationResult[]): string {
  if (results.length === 0) return "<none configured>";
  return results.map((result) => [
    `- ${result.ok ? "PASS" : "FAIL"}: ${result.command}`,
    `  exitCode=${result.exitCode ?? "null"} timedOut=${result.timedOut}`,
    "  ```text",
    indent(trimOutput(result.output, 2500), "  "),
    "  ```",
  ].join("\n")).join("\n");
}

function formatList(values: string[], emptyValue: string): string {
  if (values.length === 0) return emptyValue;
  return values.map((value) => `- ${value}`).join("\n");
}

function isCodeFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|java|kt|swift|c|cc|cpp|h|hpp|lua|gd)$/i.test(filePath)
    && !isTestFile(filePath)
    && !/^(docs?|README|CHANGELOG)/i.test(filePath);
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)/i.test(filePath)
    || /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|java|kt|swift)$/i.test(filePath);
}

function isRiskyFile(filePath: string): boolean {
  return /^(src\/(providers|runners|workflows|router|discord|db|runtime|review|utils)|scripts\/|\.github\/)/i.test(filePath)
    || isLockfile(filePath)
    || /(^|\/)(package\.json|tsconfig\.json|bunfig\.toml)$/i.test(filePath);
}

function isLockfile(filePath: string): boolean {
  return /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock)$/i.test(filePath);
}

function dedupeLines(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )).sort();
}

function indent(value: string, prefix: string): string {
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function trimOutput(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}
