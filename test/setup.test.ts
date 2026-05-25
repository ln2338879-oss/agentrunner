import { describe, expect, test } from "bun:test";
import { buildDiscordChecklist, formatSetupReport, parseSetupArgs, type SetupAction } from "../src/setup/index";
import type { CheckResult } from "../src/doctor";
import type { PlatformInfo } from "../src/setup/platform";

const platform: PlatformInfo = {
  platform: "linux",
  arch: "x64",
  release: "test-release",
  isWindows: false,
  isMacOS: false,
  isLinux: true,
  isWsl: false,
  hasSystemd: true,
};

describe("setup CLI helpers", () => {
  test("parses setup mode and apply flags", () => {
    expect(parseSetupArgs(["--ubuntu", "--apply", "--yes", "--report", "out/setup.md"])).toEqual({
      mode: "ubuntu",
      apply: true,
      interactive: false,
      yes: true,
      reportPath: "out/setup.md",
    });
  });

  test("builds Discord checklist from environment", () => {
    const checklist = buildDiscordChecklist({
      DIRECTOR_DISCORD_TOKEN: "token",
      GAME_DIRECTOR_CHANNEL_ID: "",
    });

    expect(checklist.find((item) => item.name === "Director bot token")?.configured).toBe(true);
    expect(checklist.find((item) => item.name === "Director channel")?.configured).toBe(false);
  });

  test("formats setup report with doctor, proof, service, and Discord sections", () => {
    const actions: SetupAction[] = [{ name: "setup check", status: "PASS", detail: "ok" }];
    const doctorResults: CheckResult[] = [{ name: "Database directory", ok: true, detail: "writable" }];

    const report = formatSetupReport({
      generatedAt: new Date("2026-05-25T00:00:00.000Z"),
      options: {
        mode: "check",
        apply: false,
        interactive: true,
        yes: false,
        reportPath: "setup-report.md",
      },
      platform,
      actions,
      doctorResults,
      serviceStatuses: [{ service: "agentrunner", active: false, detail: "inactive" }],
      discordChecklist: buildDiscordChecklist({}),
    });

    expect(report).toContain("# AgentRunner Setup Report");
    expect(report).toContain("## Doctor Checks");
    expect(report).toContain("## Runtime Proof");
    expect(report).toContain("## systemd Service Status");
    expect(report).toContain("## Discord Bot Token / Channel Checklist");
    expect(report).toContain("## VPS First-Run Guide");
  });
});
