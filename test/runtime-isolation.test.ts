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
});
