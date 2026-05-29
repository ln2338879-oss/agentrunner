import { describe, expect, test } from "bun:test";
import path from "node:path";
import { assessRuntimeIsolation } from "../src/safety/runtime-isolation";

describe("runtime isolation", () => {
  test("blocks write-like commands in read-only director policy", () => {
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
    expect(decision.signals).toContain("git write or publish operation");
  });

  test("blocks in-place file mutation commands in read-only director policy", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const policy = {
      role: "director" as const,
      mode: "readonly" as const,
      projectRoot,
      action: "review",
    };

    for (const command of ["sed -i 's/a/b/' src/app.ts", "perl -i -pe 's/a/b/' src/app.ts", "tee src/app.ts"]) {
      const decision = assessRuntimeIsolation({
        command,
        cwd: projectRoot,
        policy,
      });

      expect(decision.ok).toBe(false);
      expect(decision.signals).toContain("in-place file mutation command");
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

  test("allows compound read-only validation commands inside the project root", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessRuntimeIsolation({
      command: "git diff --stat && git diff --name-only",
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
});
