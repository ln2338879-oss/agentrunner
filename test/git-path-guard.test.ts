import { describe, expect, test } from "bun:test";
import path from "node:path";
import { assessGitPathGuard, parseGitInvocationTarget } from "../src/safety/git-path-guard";

describe("git path guard", () => {
  test("parses git -C before the subcommand", () => {
    const root = path.resolve("/tmp/agentrunner-guard");
    const target = parseGitInvocationTarget(["-C", "workspace", "status"], root);

    expect(target.cwd).toBe(path.join(root, "workspace"));
    expect(target.subcommand).toBe("status");
  });

  test("parses --work-tree and --git-dir forms", () => {
    const root = path.resolve("/tmp/agentrunner-guard");
    const target = parseGitInvocationTarget([
      "--git-dir=.git",
      "--work-tree",
      "project",
      "commit",
      "-m",
      "review",
    ], root);

    expect(target.gitDir).toBe(path.join(root, ".git"));
    expect(target.workTree).toBe(path.join(root, "project"));
    expect(target.subcommand).toBe("commit");
  });

  test("blocks protected worktree writes", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessGitPathGuard({
      args: ["-C", projectRoot, "commit", "-m", "review"],
      cwd: path.resolve("/tmp"),
      projectRoot,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reason).toContain("Read-only git guard");
    expect(decision.signals).toContain("git_subcommand=commit");
  });

  test("allows protected worktree reads", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const decision = assessGitPathGuard({
      args: ["-C", projectRoot, "diff", "--stat"],
      cwd: path.resolve("/tmp"),
      projectRoot,
    });

    expect(decision.blocked).toBe(false);
  });

  test("allows writes outside the protected project root", () => {
    const projectRoot = path.resolve("/tmp/agentrunner-project");
    const outside = path.resolve("/tmp/other-project");
    const decision = assessGitPathGuard({
      args: ["-C", outside, "commit", "-m", "outside"],
      cwd: path.resolve("/tmp"),
      projectRoot,
    });

    expect(decision.blocked).toBe(false);
  });
});
