import { accessSync, constants } from "node:fs";
import path from "node:path";

export interface ShellCommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunCommandOptions {
  argv: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunShellCommandOptions extends Omit<RunCommandOptions, "argv"> {
  command: string;
}

export interface ParsedCommandLine {
  argv: string[];
}

export type ParseCommandLineResult =
  | { ok: true; parsed: ParsedCommandLine }
  | { ok: false; error: string };

export async function runCommand(options: RunCommandOptions): Promise<ShellCommandResult> {
  const argv = options.argv.filter((arg) => arg.length > 0);
  if (argv.length === 0) {
    return failedBeforeSpawn("Empty command argv is not allowed.");
  }

  if (argv.some((arg) => arg.includes("\0"))) {
    return failedBeforeSpawn("Command argv cannot contain NUL bytes.");
  }

  let proc: any;
  try {
    proc = Bun.spawn(argv, {
      cwd: options.cwd,
      env: options.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedBeforeSpawn(message);
  }

  if (options.input && proc.stdin) {
    proc.stdin.write(options.input);
    proc.stdin.end();
  } else if (proc.stdin) {
    proc.stdin.end();
  }

  let timedOut = false;
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, options.timeoutMs)
    : undefined;

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (timeout) clearTimeout(timeout);

  return {
    ok: exitCode === 0 && !timedOut,
    exitCode,
    stdout,
    stderr,
    timedOut,
  };
}

export async function runShellCommand(options: RunShellCommandOptions): Promise<ShellCommandResult> {
  const parsed = parseCommandLine(options.command);
  if (!parsed.ok) return failedBeforeSpawn(parsed.error);
  return runCommand({
    argv: parsed.parsed.argv,
    cwd: options.cwd,
    input: options.input,
    timeoutMs: options.timeoutMs,
    env: options.env,
  });
}

export async function runCommandSequence(options: RunShellCommandOptions): Promise<ShellCommandResult> {
  const commands = splitCommandSequence(options.command);
  if (!commands.ok) return failedBeforeSpawn(commands.error);

  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let lastExitCode: number | null = 0;
  let timedOut = false;

  for (const command of commands.commands) {
    const result = await runShellCommand({ ...options, command });
    stdoutParts.push(result.stdout);
    stderrParts.push(result.stderr);
    lastExitCode = result.exitCode;
    timedOut = timedOut || result.timedOut;
    if (!result.ok) {
      return {
        ok: false,
        exitCode: result.exitCode,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
        timedOut,
      };
    }
  }

  return {
    ok: true,
    exitCode: lastExitCode,
    stdout: stdoutParts.join(""),
    stderr: stderrParts.join(""),
    timedOut,
  };
}

export function parseCommandLine(command: string): ParseCommandLineResult {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (!quote && char === "$" && next === "(") {
      return { ok: false, error: "Command substitution is not allowed. Use explicit argv instead." };
    }

    if (!quote && (char === "`" || char === ";" || char === "|" || char === "<" || char === ">" || char === "&")) {
      return { ok: false, error: `Shell control operator '${char}' is not allowed. Use explicit argv instead.` };
    }

    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += "\\";
  if (quote) return { ok: false, error: "Unterminated quoted argument." };
  if (current) argv.push(current);
  if (argv.length === 0) return { ok: false, error: "Empty command is not allowed." };
  return { ok: true, parsed: { argv } };
}

export function splitCommandSequence(command: string): { ok: true; commands: string[] } | { ok: false; error: string } {
  const commands: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      current += char;
      quote = quote ? undefined : char;
      continue;
    }

    if (!quote && char === "&" && next === "&") {
      if (!current.trim()) return { ok: false, error: "Empty command in command sequence." };
      commands.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    current += char;
  }

  if (quote) return { ok: false, error: "Unterminated quoted argument." };
  if (current.trim()) commands.push(current.trim());
  if (commands.length === 0) return { ok: false, error: "Empty command is not allowed." };
  return { ok: true, commands };
}

export function commandBinary(command: string): string {
  const parsed = parseCommandLine(command);
  if (!parsed.ok) return "";
  return path.basename(parsed.parsed.argv[0] ?? "");
}

export function findExecutable(binary: string, pathValue = process.env.PATH ?? ""): string | null {
  if (!binary || binary.includes(path.sep)) return executableIfAccessible(binary);

  const pathExt = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) continue;
    for (const ext of pathExt) {
      const candidate = path.join(segment, process.platform === "win32" ? withWindowsExtension(binary, ext) : binary);
      const resolved = executableIfAccessible(candidate);
      if (resolved) return resolved;
    }
  }

  return null;
}

function withWindowsExtension(binary: string, extension: string): string {
  if (path.extname(binary)) return binary;
  return `${binary}${extension.toLowerCase()}`;
}

function executableIfAccessible(filePath: string): string | null {
  if (!filePath) return null;
  try {
    accessSync(filePath, constants.X_OK);
    return filePath;
  } catch {
    return null;
  }
}

function failedBeforeSpawn(message: string): ShellCommandResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: message,
    timedOut: false,
  };
}
