import type { RuntimeConfig } from "../config";
import type { ReviewVerdict } from "../runtime/types";
import { runShellCommand, type ShellCommandResult } from "../utils/command";

interface StrictReviewConfigShape {
  STRICT_REVIEW_ENABLED?: boolean;
  STRICT_REVIEW_REQUIRE_TESTS?: boolean;
  STRICT_REVIEW_COMMANDS?: string;
  STRICT_REVIEW_COMMAND_TIMEOUT_MS?: number;
  STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR?: boolean;
  STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES?: boolean;
  REVIEW_CONTEXT_COMMAND_TIMEOUT_MS?: number;
  BUILDER_TEST_COMMAND?: string;
  BUILDER_BUILD_COMMAND?: string;
}

interface StrictReviewOptions {
  enabled: boolean;
  requireTests: boolean;
  commands: string;
  commandTimeoutMs: number;
  failOnValidationError: boolean;
  blockLockfileChanges: boolean;
  contextTimeoutMs: number;
  builderTestCommand: string;
  builderBuildCommand: string;
}

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
  const options = strictReviewOptions(input.config);
  if (!options.enabled) {
    return emptyAssessment({ enabled: false, supported: true, context: "Strict review is disabled." });
  }

  const changedFiles = await listChangedFiles(input.workspacePath, options.contextTimeoutMs);
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
    : await runValidationCommands(input.workspacePath, options);

  const blockingIssues: string[] = [];
  if (options.requireTests && codeChangedFiles.length > 0 && testChangedFiles.length === 0) {
    blockingIssues.push(
      "Code files changed but no test/spec files changed. Add or update meaningful tests, or explicitly justify why tests are not applicable.",
    );
  }

  if (options.blockLockfileChanges && lockfileChangedFiles.length > 0) {
    blockingIssues.push(
      `Lock/dependency files changed under strict review: ${lockfileChangedFiles.join(", ")}. Human approval or explicit dependency-change justification is required.`,
    );
  }

  if (options.failOnValidationError) {
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
    requireTests: options.requireTests,
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

function strictReviewOptions(config: RuntimeConfig): StrictReviewOptions {
  const raw = config as unknown as StrictReviewConfigShape;
  return {
    enabled: raw.STRICT_REVIEW_ENABLED ?? true,
    requireTests: raw.STRICT_REVIEW_REQUIRE_TESTS ?? true,
    commands: raw.STRICT_REVIEW_COMMANDS ?? "",
    commandTimeoutMs: raw.STRICT_REVIEW_COMMAND_TIMEOUT_MS ?? 300000,
    failOnValidationError: raw.STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR ?? true,
    blockLockfileChanges: raw.STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES ?? false,
    contextTimeoutMs: raw.REVIEW_CONTEXT_COMMAND_TIMEOUT_MS ?? 120000,
    builderTestCommand: raw.BUILDER_TEST_COMMAND ?? "",
    builderBuildCommand: raw.BUILDER_BUILD_COMMAND ?? "",
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
  options: StrictReviewOptions,
): Promise<StrictReviewValidationResult[]> {
  const commands = strictReviewCommands(options);
  const results: StrictReviewValidationResult[] = [];
  for (const command of commands) {
    const result = await runShellCommand({
      command,
      cwd: workspacePath,
      timeoutMs: options.commandTimeoutMs,
    });
    results.push(formatValidationResult(command, result));
  }
  return results;
}

function strictReviewCommands(options: StrictReviewOptions): string[] {
  const configured = splitCommands(options.commands);
  if (configured.length > 0) return configured;
  return [options.builderTestCommand, options.builderBuildCommand]
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
