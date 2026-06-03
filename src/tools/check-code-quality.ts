import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface QualityBudget {
  include: string[];
  exclude: string[];
  defaults: BudgetLimits;
  overrides?: Record<string, Partial<BudgetLimits>>;
}

export interface BudgetLimits {
  maxFileLines: number;
  maxFunctionLines: number;
  maxCyclomaticComplexity: number;
  maxNestingDepth: number;
}

export interface FileMetrics {
  fileLines: number;
  maxFunctionLines: number;
  maxCyclomaticComplexity: number;
  maxNestingDepth: number;
}

export interface Violation {
  filePath: string;
  metric: keyof BudgetLimits;
  actual: number;
  limit: number;
}

interface FunctionState {
  startLine: number;
  startDepth: number;
  complexity: number;
}

const CONFIG_PATH = "code-quality-budgets.json";
const DEFAULT_SCAN_ROOTS = ["src", "test"];

export async function checkCodeQualityBudgets(configPath = CONFIG_PATH): Promise<Violation[]> {
  const budget = await readBudget(configPath);
  const files = await listTypeScriptFiles(DEFAULT_SCAN_ROOTS, budget);
  return files.flatMap((filePath) => checkFile(filePath, budget));
}

export async function runCodeQualityBudgetCli(): Promise<void> {
  const violations = await checkCodeQualityBudgets(CONFIG_PATH);
  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exitCode = 1;
    return;
  }

  console.log("Code quality budgets passed.");
}

async function readBudget(filePath: string): Promise<QualityBudget> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as QualityBudget;
}

async function listTypeScriptFiles(roots: string[], budget: QualityBudget): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    await collectTypeScriptFiles(root, files, budget);
  }
  return files.filter((filePath) => isIncluded(filePath, budget)).sort();
}

async function collectTypeScriptFiles(directory: string, files: string[], budget: QualityBudget): Promise<void> {
  let entries: any[];
  try {
    entries = await readdir(directory, { withFileTypes: true }) as any[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = toRepoPath(path.join(directory, String(entry.name)));
    if (shouldSkipPath(entryPath, budget)) continue;
    if (entry.isDirectory()) {
      await collectTypeScriptFiles(entryPath, files, budget);
    } else if (entry.isFile() && String(entry.name).endsWith(".ts")) {
      files.push(entryPath);
    }
  }
}

function shouldSkipPath(filePath: string, budget: QualityBudget): boolean {
  return filePath.includes("node_modules") || filePath.includes("dist") || filePath.includes(".git") || matchesAny(filePath, budget.exclude);
}

function isIncluded(filePath: string, budget: QualityBudget): boolean {
  return budget.include.length === 0 || matchesAny(filePath, budget.include);
}

function checkFile(filePath: string, budget: QualityBudget): Violation[] {
  const limits = limitsForFile(filePath, budget);
  const metrics = calculateMetrics(readFileSync(filePath, "utf-8"));
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

export function calculateMetrics(source: string): FileMetrics {
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

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globLikeMatch(filePath, pattern));
}

function globLikeMatch(filePath: string, pattern: string): boolean {
  const regex = new RegExp(`^${escapeRegex(pattern).replaceAll("\\*\\*", ".*").replaceAll("\\*", "[^/]*")}$`);
  return regex.test(filePath);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function formatViolations(violations: Violation[]): string {
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

if (import.meta.main) {
  runCodeQualityBudgetCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
