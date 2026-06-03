import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface QualityBudget {
  include: string[];
  exclude: string[];
  defaults: BudgetLimits;
  overrides?: Record<string, Partial<BudgetLimits>>;
}

interface BudgetLimits {
  maxFileLines: number;
  maxFunctionLines: number;
  maxCyclomaticComplexity: number;
  maxNestingDepth: number;
}

interface FileMetrics {
  fileLines: number;
  maxFunctionLines: number;
  maxCyclomaticComplexity: number;
  maxNestingDepth: number;
}

interface FunctionState {
  startLine: number;
  startDepth: number;
  complexity: number;
}

interface Violation {
  filePath: string;
  metric: keyof BudgetLimits;
  actual: number;
  limit: number;
}

const CONFIG_PATH = "code-quality-budgets.json";
const DEFAULT_SCAN_ROOTS = ["src", "test"];

async function main(): Promise<void> {
  const budget = await readBudget(CONFIG_PATH);
  const files = await listTypeScriptFiles(DEFAULT_SCAN_ROOTS);
  const violations = files.flatMap((filePath) => checkFile(filePath, budget));

  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exitCode = 1;
    return;
  }

  console.log(`Code quality budgets passed for ${files.length} TypeScript files.`);
}

async function readBudget(filePath: string): Promise<QualityBudget> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as QualityBudget;
}

async function listTypeScriptFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    await collectTypeScriptFiles(root, files);
  }
  return files.sort();
}

async function collectTypeScriptFiles(directory: string, files: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (shouldSkipPath(entryPath)) continue;
    if (entry.isDirectory()) {
      await collectTypeScriptFiles(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(toRepoPath(entryPath));
    }
  }
}

function shouldSkipPath(filePath: string): boolean {
  return filePath.includes("node_modules") || filePath.includes("dist") || filePath.includes(".git");
}

function checkFile(filePath: string, budget: QualityBudget): Violation[] {
  const limits = limitsForFile(filePath, budget);
  const metrics = calculateMetrics(Bun.file(filePath).textSync());
  const checks: Array<[keyof BudgetLimits, number, number]> = [
    ["maxFileLines", metrics.fileLines, limits.maxFileLines],
    ["maxFunctionLines", metrics.maxFunctionLines, limits.maxFunctionLines],
    ["maxCyclomaticComplexity", metrics.maxCyclomaticComplexity, limits.maxCyclomaticComplexity],
    ["maxNestingDepth", metrics.maxNestingDepth, limits.maxNestingDepth],
  ];

  return checks
    .filter(([, actual, limit]) => actual > limit)
    .map(([metric, actual, limit]) => ({ filePath, metric, actual, limit }));
}

function limitsForFile(filePath: string, budget: QualityBudget): BudgetLimits {
  return {
    ...budget.defaults,
    ...(budget.overrides?.[filePath] ?? {}),
  };
}

function calculateMetrics(source: string): FileMetrics {
  const lines = source.split(/\r?\n/);
  let depth = 0;
  let maxDepth = 0;
  let maxFunctionLines = 0;
  let maxComplexity = 1;
  let currentFunction: FunctionState | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripLineComment(lines[index] ?? "");
    const lineNumber = index + 1;

    if (!currentFunction && looksLikeFunctionStart(line)) {
      currentFunction = { startLine: lineNumber, startDepth: depth, complexity: 1 };
    }

    if (currentFunction) {
      currentFunction.complexity += complexityContribution(line);
    }

    depth += countChar(line, "{");
    maxDepth = Math.max(maxDepth, depth);
    depth -= countChar(line, "}");
    depth = Math.max(0, depth);

    if (currentFunction && depth <= currentFunction.startDepth && line.includes("}")) {
      const functionLines = lineNumber - currentFunction.startLine + 1;
      maxFunctionLines = Math.max(maxFunctionLines, functionLines);
      maxComplexity = Math.max(maxComplexity, currentFunction.complexity);
      currentFunction = undefined;
    }
  }

  return {
    fileLines: countNonTrailingEmptyLines(lines),
    maxFunctionLines,
    maxCyclomaticComplexity: maxComplexity,
    maxNestingDepth: maxDepth,
  };
}

function looksLikeFunctionStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;
  if (/^(if|for|while|switch|catch|else|try)\b/.test(trimmed)) return false;
  return /\bfunction\b/.test(trimmed)
    || /=>\s*\{/.test(trimmed)
    || /^(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[:\w\s<>,\[\]|.&?]*\{/.test(trimmed);
}

function complexityContribution(line: string): number {
  return countMatches(line, /\b(if|for|while|case|catch)\b/g)
    + countMatches(line, /\?\s*[^.:]/g)
    + countMatches(line, /&&|\|\|/g);
}

function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  return index >= 0 ? line.slice(0, index) : line;
}

function countChar(value: string, char: string): number {
  return [...value].filter((candidate) => candidate === char).length;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function countNonTrailingEmptyLines(lines: string[]): number {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]?.trim()) end -= 1;
  return end;
}

function formatViolations(violations: Violation[]): string {
  return [
    "Code quality budget violations:",
    ...violations.map(
      (violation) => `- ${violation.filePath}: ${violation.metric}=${violation.actual} exceeds ${violation.limit}`,
    ),
  ].join("\n");
}

function toRepoPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
