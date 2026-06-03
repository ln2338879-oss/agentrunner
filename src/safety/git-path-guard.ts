import path from "node:path";

const PROTECTED_GIT_SUBCOMMANDS = new Set([
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

export interface GitInvocationTarget {
  cwd: string;
  workTree?: string;
  gitDir?: string;
  subcommand?: string;
}

export interface GitPathGuardDecision {
  blocked: boolean;
  reason?: string;
  target: GitInvocationTarget;
  signals: string[];
}

export function parseGitInvocationTarget(args: string[], initialCwd: string): GitInvocationTarget {
  let cwd = path.resolve(initialCwd);
  let workTree: string | undefined;
  let gitDir: string | undefined;
  let subcommand: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

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

export function assessGitPathGuard(input: {
  args: string[];
  cwd: string;
  projectRoot: string;
}): GitPathGuardDecision {
  const projectRoot = path.resolve(input.projectRoot);
  const target = parseGitInvocationTarget(input.args, input.cwd);
  const workTree = path.resolve(target.workTree ?? target.cwd);
  const gitDir = target.gitDir ? path.resolve(target.gitDir) : undefined;
  const protectedTarget = isSameOrInside(workTree, projectRoot) || Boolean(gitDir && isSameOrInside(gitDir, projectRoot));
  const writeSubcommand = Boolean(target.subcommand && PROTECTED_GIT_SUBCOMMANDS.has(target.subcommand));

  if (protectedTarget && writeSubcommand) {
    return {
      blocked: true,
      reason: "Read-only git guard blocked a protected workspace write operation.",
      target,
      signals: [
        `git_subcommand=${target.subcommand}`,
        `workTree=${workTree}`,
        gitDir ? `gitDir=${gitDir}` : "gitDir=<default>",
        `projectRoot=${projectRoot}`,
      ],
    };
  }

  return { blocked: false, target, signals: [`workTree=${workTree}`, `projectRoot=${projectRoot}`] };
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
