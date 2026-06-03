import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const PROTECTED_WRITE_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "config",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "rm",
  "stash",
  "switch",
  "tag",
]);

interface ParsedGitInvocation {
  cwd: string;
  workTree?: string;
  gitDir?: string;
  subcommand?: string;
}

export function parseGitInvocation(args: string[], initialCwd = process.cwd()): ParsedGitInvocation {
  let cwd = initialCwd;
  let workTree: string | undefined;
  let gitDir: string | undefined;
  let subcommand: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-C") {
      const value = args[index + 1];
      if (value) cwd = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (arg === "--work-tree") {
      const value = args[index + 1];
      if (value) workTree = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--work-tree=")) {
      workTree = path.resolve(cwd, arg.slice("--work-tree=".length));
      continue;
    }
    if (arg === "--git-dir") {
      const value = args[index + 1];
      if (value) gitDir = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--git-dir=")) {
      gitDir = path.resolve(cwd, arg.slice("--git-dir=".length));
      continue;
    }
    if (arg === "--namespace" || arg === "--exec-path") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--namespace=") || arg.startsWith("--exec-path=")) continue;
    if (arg.startsWith("-")) continue;
    subcommand = arg;
    break;
  }

  return { cwd, workTree, gitDir, subcommand };
}

export function isProtectedGitWrite(input: {
  args: string[];
  projectRoot: string;
  initialCwd?: string;
}): { blocked: boolean; subcommand?: string; target: string; projectRoot: string } {
  const parsed = parseGitInvocation(input.args, input.initialCwd);
  const projectRoot = realPath(input.projectRoot);
  const target = realPath(parsed.workTree ?? parsed.cwd);
  const gitDir = parsed.gitDir ? realPath(parsed.gitDir) : undefined;
  const protectedTarget = isSameOrInside(target, projectRoot) || Boolean(gitDir && isSameOrInside(gitDir, projectRoot));
  const blocked = Boolean(parsed.subcommand && PROTECTED_WRITE_SUBCOMMANDS.has(parsed.subcommand) && protectedTarget);
  return { blocked, subcommand: parsed.subcommand, target, projectRoot };
}

function main(): void {
  const realGit = process.env.AGENTRUNNER_REAL_GIT;
  const projectRoot = process.env.AGENTRUNNER_GIT_GUARD_PROJECT_ROOT;
  if (!realGit || !projectRoot) {
    console.error("AGENTRUNNER_GIT_GUARD: guard environment is incomplete.");
    process.exit(127);
  }

  const args = process.argv.slice(2);
  const decision = isProtectedGitWrite({ args, projectRoot });
  if (decision.blocked) {
    console.error([
      "AGENTRUNNER_GIT_GUARD: blocked read-only git write operation.",
      `subcommand=${decision.subcommand ?? "unknown"}`,
      `target=${decision.target}`,
      `projectRoot=${decision.projectRoot}`,
    ].join("\n"));
    process.exit(126);
  }

  const result = spawnSync(realGit, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    console.error(result.error.message);
    process.exit(127);
  }
  process.exit(result.status ?? 0);
}

function realPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

if (import.meta.main) main();
