import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface CodeQualityBudgets {
  maxRuntimeStoreLines: number;
  maxTypeScriptFileLines: number;
  minTestFiles: number;
  requiredCiArtifacts: string[];
  preCommitHooks: "enabled" | "deferred";
}

export interface CodeQualityMetrics {
  runtimeStoreLines: number;
  maxTypeScriptFileLines: number;
  testFiles: number;
  ciArtifacts: string[];
}

export interface CodeQualityResult {
  ok: boolean;
  failures: string[];
}

export function evaluateQualityBudgets(
  budgets: CodeQualityBudgets,
  metrics: CodeQualityMetrics,
): CodeQualityResult {
  const failures: string[] = [];

  if (metrics.runtimeStoreLines > budgets.maxRuntimeStoreLines) {
    failures.push(
      `runtime-store.ts has ${metrics.runtimeStoreLines} lines; budget is ${budgets.maxRuntimeStoreLines}.`,
    );
  }
  if (metrics.maxTypeScriptFileLines > budgets.maxTypeScriptFileLines) {
    failures.push(
      `Largest TypeScript file has ${metrics.maxTypeScriptFileLines} lines; budget is ${budgets.maxTypeScriptFileLines}.`,
    );
  }
  if (metrics.testFiles < budgets.minTestFiles) {
    failures.push(
      `Repository has ${metrics.testFiles} test files; budget minimum is ${budgets.minTestFiles}.`,
    );
  }

  for (const artifact of budgets.requiredCiArtifacts) {
    if (!metrics.ciArtifacts.includes(artifact)) {
      failures.push(`CI is missing required artifact upload: ${artifact}.`);
    }
  }

  return { ok: failures.length === 0, failures };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const budgets = JSON.parse(
    await readFile(path.join(root, "code-quality-budgets.json"), "utf-8"),
  ) as CodeQualityBudgets;
  const metrics = await collectQualityMetrics(root);
  const result = evaluateQualityBudgets(budgets, metrics);

  console.log(JSON.stringify({ budgets, metrics, result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function collectQualityMetrics(root: string): Promise<CodeQualityMetrics> {
  const typeScriptFiles = await findTypeScriptFiles(root, ["src", "test", "scripts"]);
  const lineCounts = await Promise.all(
    typeScriptFiles.map(async (file) => countLines(await readFile(file, "utf-8"))),
  );
  const workflowText = await readFile(
    path.join(root, ".github", "workflows", "check.yml"),
    "utf-8",
  );

  return {
    runtimeStoreLines: countLines(
      await readFile(path.join(root, "src", "db", "runtime-store.ts"), "utf-8"),
    ),
    maxTypeScriptFileLines: Math.max(0, ...lineCounts),
    testFiles: typeScriptFiles.filter((file) => file.endsWith(".test.ts")).length,
    ciArtifacts: parseUploadedArtifactNames(workflowText),
  };
}

async function findTypeScriptFiles(root: string, directories: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const directory of directories) {
    await walk(path.join(root, directory), files);
  }
  return files.filter((file) => file.endsWith(".ts"));
}

async function walk(currentPath: string, files: string[]): Promise<void> {
  const currentStat = await stat(currentPath);
  if (currentStat.isFile()) {
    files.push(currentPath);
    return;
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    await walk(path.join(currentPath, entry.name), files);
  }
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split(/\r?\n/).length - (value.endsWith("\n") ? 1 : 0);
}

export function parseUploadedArtifactNames(workflowText: string): string[] {
  const artifactNames: string[] = [];
  const uploadStepPattern = /^\s+- name: .*\n(?:.*\n)*?\s+uses:\s+actions\/upload-artifact@.+$/gm;

  for (const match of workflowText.matchAll(uploadStepPattern)) {
    const start = match.index ?? 0;
    const nextStepIndex = workflowText.indexOf("\n      - name:", start + match[0].length);
    const block = workflowText.slice(start, nextStepIndex === -1 ? undefined : nextStepIndex);
    const nameMatch = block.match(/^\s+with:\s*\n(?:.*\n)*?\s+name:\s+([A-Za-z0-9_-]+)\s*$/m);
    if (nameMatch?.[1]) artifactNames.push(nameMatch[1]);
  }

  return artifactNames;
}

if (import.meta.main) {
  await main();
}
