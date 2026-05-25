import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { applyGroupOverrides, GroupConfigManager } from "../src/groups/group-config";

const tempDirs: string[] = [];

async function createGroupsFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-groups-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "groups.yaml");
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GroupConfigManager", () => {
  test("loads groups and resolves by Discord channel", async () => {
    const groupsPath = await createGroupsFile(`
groups:
  - id: runebound-dev
    name: Runebound Development
    discordChannelIds:
      - "channel-1"
    projectRoot: /opt/game-projects/runebound
    obsidianVaultPath: /opt/obsidian-vaults/AgentRunnerVault
    factoryModel: gemma
    allowedRoles:
      - director
      - builder
    skills:
      - runebound-design
    policy:
      allowCodeChanges: true
      allowContentGeneration: false
      requireDirectorReview: true
`);

    const manager = new GroupConfigManager(loadConfig({ GROUPS_CONFIG_PATH: groupsPath }));
    await manager.load();

    const group = manager.resolveByChannel("channel-1");
    expect(group?.id).toBe("runebound-dev");
    expect(group?.allowedRoles).toEqual(["director", "builder"]);
    expect(group?.skills).toEqual(["runebound-design"]);
    expect(group?.policy.allowContentGeneration).toBe(false);
  });

  test("returns no groups when config path is missing", async () => {
    const manager = new GroupConfigManager(loadConfig({ GROUPS_CONFIG_PATH: "/tmp/agentrunner-missing-groups.yaml" }));
    await manager.load();

    expect(manager.list()).toEqual([]);
    expect(manager.resolveByChannel("channel-1")).toBeNull();
  });
});

describe("applyGroupOverrides", () => {
  test("overrides runtime config values from group", () => {
    const base = loadConfig({
      PROJECT_ROOT: "/base/project",
      OBSIDIAN_VAULT_PATH: "/base/vault",
      OLLAMA_MODEL: "base-model",
      BUILDER_TEST_COMMAND: "bun test",
      BUILDER_BUILD_COMMAND: "bun run build",
    });

    const overridden = applyGroupOverrides(base, {
      id: "game",
      name: "Game",
      discordChannelIds: ["channel-1"],
      projectRoot: "/game/project",
      obsidianVaultPath: "/game/vault",
      factoryModel: "game-model",
      builderTestCommand: "npm test",
      builderBuildCommand: "npm run build",
      allowedRoles: ["director", "builder", "factory"],
      skills: [],
      policy: {
        allowCodeChanges: true,
        allowContentGeneration: true,
        requireDirectorReview: true,
      },
    });

    expect(overridden.PROJECT_ROOT).toBe("/game/project");
    expect(overridden.OBSIDIAN_VAULT_PATH).toBe("/game/vault");
    expect(overridden.OLLAMA_MODEL).toBe("game-model");
    expect(overridden.BUILDER_TEST_COMMAND).toBe("npm test");
    expect(overridden.BUILDER_BUILD_COMMAND).toBe("npm run build");
  });
});
