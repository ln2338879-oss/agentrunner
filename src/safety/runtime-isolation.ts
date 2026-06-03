import path from "node:path";
import type { AgentRole } from "../runtime/types";
import { parseCommandLine } from "../utils/command";

export type RuntimeIsolationMode = "readonly" | "workspace-write";

export interface RuntimeIsolationPolicy {
  role: AgentRole;
  mode: RuntimeIsolationMode;
  projectRoot: string;
  action?: string;
}

export interface RuntimeIsolationDecision {
  ok: boolean;
  reason?: string;
  signals: string[];
}

const READONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "show",
  "log",
  "rev-parse",
  "ls-files",
  "grep",
  "describe",
  "name-only",
  "name-status",
]);

const WRITE_GIT_SUBCOMMANDS = new Set([
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

const READONLY_BUN_RUN_SCRIPTS = new Set(["test", "typecheck", "lint", "format:check", "check"]);

export function assessRuntimeIsolation(input: {
  command?: string;
  argv?: string[];
  cwd?: string;
  policy?: RuntimeIsolationPolicy;
}): RuntimeIsolationDecision {
  if (!input.policy) return { ok: true, signals: [] };

  const signals: string[] = [];
  const cwdDecision = assessWorkingDirectory({
    cwd: input.cwd,
    projectRoot: input.policy.projectRoot,
  });
  signals.push(...cwdDecision.signals);
  if (!cwdDecision.ok) return cwdDecision;

  const commandDecision = assessCommandShape({
    command: input.command,
    argv: input.argv,
    policy: input.policy,
  });
  signals.push(...commandDecision.signals);
  if (!commandDecision.ok) return { ...commandDecision, signals };

  return { ok: true, signals };
}

export function formatRuntimeIsolationViolation(decision: RuntimeIsolationDecision): string {
  return [
    "# Runtime Isolation Blocked Command",
    "",
    decision.reason ?? "The command was blocked by AgentRunner runtime isolation policy.",
    "",
    "## Signals",
    decision.signals.length > 0 ? decision.signals.map((signal) => `- ${signal}`).join("\n") : "No signals recorded.",
  ].join("\n");
}

function assessWorkingDirectory(input: { cwd?: string; projectRoot: string }): RuntimeIsolationDecision {
  const projectRoot = path.resolve(input.projectRoot);
  const cwd = path.resolve(input.cwd ?? projectRoot);
  if (!isSameOrInside(cwd, projectRoot)) {
    return {
      ok: false,
      reason: "Command working directory is outside PROJECT_ROOT.",
      signals: [`cwd=${cwd}`, `projectRoot=${projectRoot}`],
    };
  }
  return { ok: true, signals: [`cwd_inside_project=${cwd}`] };
}

function assessCommandShape(input: {
  command?: string;
  argv?: string[];
  policy: RuntimeIsolationPolicy;
}): RuntimeIsolationDecision {
  const argv = input.argv ?? argvFromCommand(input.command);
  if (argv.length === 0) {
    return { ok: false, reason: "Empty command is not allowed.", signals: ["empty_command"] };
  }

  const command = input.command ?? argv.join(" ");
  if (input.command) {
    const parsed = parseCommandLine(input.command);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: "Command shape is too broad for the runtime isolation boundary. Use argv or an internal command sequence instead.",
        signals: [parsed.error],
      };
    }
  }

  if (input.policy.mode === "readonly") {
    const readonlyDecision = assessReadonlyAllowList(argv);
    if (!readonlyDecision.ok) return readonlyDecision;
  }

  const publishSignals = publishOperationSignals(command, argv);
  if (publishSignals.length > 0) {
    return {
      ok: false,
      reason: "Runtime commands cannot publish, deploy, or mutate git history without an explicit human-approved path.",
      signals: publishSignals,
    };
  }

  return { ok: true, signals: [] };
}

function assessReadonlyAllowList(argv: string[]): RuntimeIsolationDecision {
  const binary = path.basename(argv[0] ?? "");
  if (binary === "git") return assessReadonlyGit(argv);
  if (binary === "bun") return assessReadonlyBun(argv);
  if (binary === "tsc" && argv.includes("--noEmit")) return { ok: true, signals: ["readonly_allowed=tsc --noEmit"] };
  if (binary === "eslint") return { ok: true, signals: ["readonly_allowed=eslint"] };

  return {
    ok: false,
    reason: "Read-only runtime uses an allow-list of inspection and validation commands.",
    signals: [`readonly_disallowed_binary=${binary || "unknown"}`],
  };
}

function assessReadonlyGit(argv: string[]): RuntimeIsolationDecision {
  const subcommand = gitSubcommand(argv);
  if (!subcommand) return { ok: true, signals: ["readonly_allowed=git"] };
  if (WRITE_GIT_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      reason: "Read-only runtime cannot run git write or history mutation commands.",
      signals: [`git_write_subcommand=${subcommand}`],
    };
  }
  if (READONLY_GIT_SUBCOMMANDS.has(subcommand)) return { ok: true, signals: [`readonly_allowed=git ${subcommand}`] };

  return {
    ok: false,
    reason: "Read-only runtime uses a git subcommand allow-list.",
    signals: [`readonly_disallowed_git_subcommand=${subcommand}`],
  };
}

function assessReadonlyBun(argv: string[]): RuntimeIsolationDecision {
  const subcommand = argv[1];
  if (subcommand === "test") return { ok: true, signals: ["readonly_allowed=bun test"] };
  if (subcommand === "run" && READONLY_BUN_RUN_SCRIPTS.has(argv[2] ?? "")) {
    return { ok: true, signals: [`readonly_allowed=bun run ${argv[2]}`] };
  }

  return {
    ok: false,
    reason: "Read-only runtime only allows configured Bun validation commands.",
    signals: [`readonly_disallowed_bun=${argv.slice(1).join(" ") || "unknown"}`],
  };
}

function gitSubcommand(argv: string[]): string | null {
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree" || arg === "--namespace" || arg === "--exec-path") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--namespace=")) continue;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

function publishOperationSignals(command: string, argv: string[]): string[] {
  const binary = path.basename(argv[0] ?? "");
  const checks: Array<[boolean, string]> = [
    [binary === "git" && ["commit", "push", "merge", "rebase", "tag", "reset"].includes(gitSubcommand(argv) ?? ""), "git history or publish operation"],
    [/\b(release|deploy|publish)\b/i.test(command), "publish/deploy keyword"],
  ];
  return checks.filter(([matched]) => matched).map(([, signal]) => signal);
}

function argvFromCommand(command: string | undefined): string[] {
  if (!command) return [];
  const parsed = parseCommandLine(command);
  if (!parsed.ok) return [];
  return parsed.parsed.argv;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
