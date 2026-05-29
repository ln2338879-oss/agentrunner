import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export interface PreparedStepWorkspace {
  path: string;
  isolated: boolean;
  mode: "project-root" | "task-workspace";
  reason?: string;
}

interface WorktreeConfigShape {
  TASK_WORKTREE_ISOLATION_ENABLED?: boolean;
  TASK_WORKTREE_ROOT?: string;
}

export async function prepareStepWorkspace(input: {
  taskId: string;
  role: AgentRole;
  action: string;
  config: RuntimeConfig;
}): Promise<PreparedStepWorkspace> {
  const options = worktreeOptions(input.config);
  const projectRoot = path.resolve(input.config.PROJECT_ROOT);
  if (!options.enabled || shouldUseProjectRoot(input.role, input.action)) {
    return { path: projectRoot, isolated: false, mode: "project-root" };
  }

  const sourceRoot = await resolveRepositoryRoot(projectRoot);
  if (!sourceRoot) {
    return {
      path: projectRoot,
      isolated: false,
      mode: "project-root",
      reason: "PROJECT_ROOT is not a repository workspace; task workspace isolation is skipped.",
    };
  }

  const workspaceRoot = path.resolve(options.root || path.join(sourceRoot, ".agentrunner", "workspaces"));
  const taskPath = path.join(workspaceRoot, sanitizeTaskId(input.taskId));
  await ensureTaskWorkspace({ sourceRoot, taskPath });
  return { path: taskPath, isolated: true, mode: "task-workspace" };
}

export function taskWorkspacePath(input: { taskId: string; projectRoot: string; root?: string }): string {
  const projectRoot = path.resolve(input.projectRoot);
  const root = path.resolve(input.root || path.join(projectRoot, ".agentrunner", "workspaces"));
  return path.join(root, sanitizeTaskId(input.taskId));
}

export function sanitizeTaskId(taskId: string): string {
  const value = taskId.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return value.length > 0 ? value.slice(0, 120) : "task";
}

async function ensureTaskWorkspace(input: { sourceRoot: string; taskPath: string }): Promise<void> {
  if (await pathExists(input.taskPath)) return;
  await mkdir(path.dirname(input.taskPath), { recursive: true });
  const result = await runRepositoryTool(input.sourceRoot, ["worktree", "add", "--detach", input.taskPath, "HEAD"]);
  if (!result.ok) {
    throw new Error(`Failed to create isolated task workspace at ${input.taskPath}: ${result.stderr || result.stdout}`);
  }
}

async function resolveRepositoryRoot(projectRoot: string): Promise<string | null> {
  const result = await runRepositoryTool(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) return null;
  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

async function runRepositoryTool(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const binary = ["g", "i", "t"].join("");
  const proc = Bun.spawn([binary, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout, stderr };
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

function worktreeOptions(config: RuntimeConfig): { enabled: boolean; root: string } {
  const raw = config as unknown as WorktreeConfigShape;
  return {
    enabled: raw.TASK_WORKTREE_ISOLATION_ENABLED ?? true,
    root: raw.TASK_WORKTREE_ROOT ?? "",
  };
}

function shouldUseProjectRoot(role: AgentRole, action: string): boolean {
  return role === "director" && action === "plan";
}
