import { describe, expect, test } from "bun:test";
import path from "node:path";
import { assessRuntimeIsolation } from "../src/safety/runtime-isolation";
import { parseCommandLine, runCommandSequence, runShellCommand } from "../src/utils/command";

describe("runtime isolation", () => {
  test("blocks write-like git commands in read-only director policy", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessRuntimeIsolation({
      command: "git commit -m review",
      cwd: projectRoot,
      policy: {
        role: "director",
        mode: "readonly",
        projectRoot,
        action: "review",
      },
    });

    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("Read-only runtime");
    expect(decision.signals).toContain("git_write_subcommand=commit");
  });

  test("blocks non-allowlisted tools in read-only director policy", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const policy = {
      role: "director" as const,
      mode: "readonly" as const,
      projectRoot,
      action: "review",
    };

    for (const command of ["sed -i s/a/b/ src/app.ts", "perl -i -pe s/a/b/ src/app.ts", "tee src/app.ts"]) {
      const decision = assessRuntimeIsolation({
        command,
        cwd: projectRoot,
        policy,
      });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toContain("allow-list");
    }
  });

  test("blocks commands outside the project root", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessRuntimeIsolation({
      command: "node --version",
      cwd: path.resolve("/tmp/other-project"),
      policy: {
        role: "builder",
        mode: "workspace-write",
        projectRoot,
        action: "implement",
      },
    });

    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("outside PROJECT_ROOT");
  });

  test("allows simple builder commands inside the project root", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessRuntimeIsolation({
      command: "codex",
      cwd: projectRoot,
      policy: {
        role: "builder",
        mode: "workspace-write",
        projectRoot,
        action: "implement",
      },
    });

    expect(decision.ok).toBe(true);
  });

  test("allows allow-listed read-only validation commands inside the project root", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessRuntimeIsolation({
      command: "git diff --stat",
      cwd: projectRoot,
      policy: {
        role: "builder",
        mode: "readonly",
        projectRoot,
        action: "validate",
      },
    });

    expect(decision.ok).toBe(true);
  });

  test("blocks shell control operators before command execution", () => {
    const parsed = parseCommandLine("git diff --stat && git status");
    expect(parsed.ok).toBe(false);
  });

  test("runShellCommand executes argv directly instead of sh -lc", async () => {
    const result = await runShellCommand({ command: `bun -e "console.log('agentrunner')"`, timeoutMs: 30000 });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("agentrunner");
  });

  test("runCommandSequence supports internal && sequencing without shell control execution", async () => {
    const result = await runCommandSequence({
      command: `bun -e "console.log('one')" && bun -e "console.log('two')"`,
      timeoutMs: 30000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim().split(/\s+/)).toEqual(["one", "two"]);
  });
});
