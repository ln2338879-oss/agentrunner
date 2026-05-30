export interface ShellCommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunShellCommandOptions {
  command: string;
  cwd?: string;
  input?: string;
  timeoutMs?: number;
}

export async function runShellCommand(options: RunShellCommandOptions): Promise<ShellCommandResult> {
  const shell = process.platform === "win32" ? [process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", "/d", "/s", "/c", options.command] : ["sh", "-lc", options.command];
  let proc: any;
  try {
    proc = Bun.spawn(shell, {
      cwd: options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: message,
      timedOut: false,
    };
  }

  if (options.input && proc.stdin) {
    proc.stdin.write(options.input);
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
