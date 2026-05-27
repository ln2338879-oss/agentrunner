import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { doctorPassed, runDoctor } from "../src/doctor";

const tempDirs: string[] = [];

async function createEnv() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-doctor-"));
  tempDirs.push(dir);
  return {
    DATABASE_PATH: path.join(dir, "data", "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: path.join(dir, "project"),
    ATTACHMENTS_DIR: path.join(dir, "attachments"),
    DESIGNER_OUTPUT_DIR: path.join(dir, "vault", "06_DesignerOutputs"),
    CLAUDE_CODE_COMMAND: "missing-claude-command-for-test",
    CODEX_COMMAND: "missing-codex-command-for-test",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
  } satisfies NodeJS.ProcessEnv;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runDoctor", () => {
  test("passes internal writable path checks when external checks are skipped", async () => {
    const env = await createEnv();

    const results = await runDoctor({
      env,
      requireCredentials: false,
      includeExternalChecks: false,
    });

    expect(doctorPassed(results)).toBe(true);
    expect(results.find((result) => result.name === "Database directory")?.ok).toBe(true);
    expect(results.find((result) => result.name === "Obsidian Vault")?.ok).toBe(true);
    expect(results.find((result) => result.name === "Project Root")?.ok).toBe(true);
    expect(results.find((result) => result.name === "Attachments directory")?.ok).toBe(true);
    expect(results.find((result) => result.name === "Designer output directory")?.ok).toBe(true);
    expect(results.find((result) => result.name === "Dashboard exposure")?.ok).toBe(true);
  });

  test("reports missing required credentials when credential checks are enabled", async () => {
    const env = await createEnv();

    const results = await runDoctor({
      env,
      requireCredentials: true,
      includeExternalChecks: false,
    });

    expect(doctorPassed(results)).toBe(false);
    expect(results.find((result) => result.name === "DIRECTOR_DISCORD_TOKEN")?.ok).toBe(false);
    expect(results.find((result) => result.name === "GAME_DIRECTOR_CHANNEL_ID")?.ok).toBe(false);
  });

  test("fails when dashboard is exposed without a local bind address", async () => {
    const env = {
      ...await createEnv(),
      DASHBOARD_ENABLED: "true",
      DASHBOARD_HOST: "0.0.0.0",
    } satisfies NodeJS.ProcessEnv;

    const results = await runDoctor({
      env,
      requireCredentials: false,
      includeExternalChecks: false,
    });

    expect(doctorPassed(results)).toBe(false);
    expect(results.find((result) => result.name === "Dashboard exposure")?.ok).toBe(false);
  });

  test("fails slash command registration when client id is missing", async () => {
    const env = {
      ...await createEnv(),
      REGISTER_SLASH_COMMANDS: "true",
      DISCORD_CLIENT_ID: "",
    } satisfies NodeJS.ProcessEnv;

    const results = await runDoctor({
      env,
      requireCredentials: true,
      includeExternalChecks: false,
    });

    expect(results.find((result) => result.name === "Discord slash command registration")?.ok).toBe(false);
  });
});
