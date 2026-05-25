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
  test("loads legacy groups and resolves by Discord channel", async () => {
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
    expect(group?.effectiveSkills).toEqual(["runebound-design"]);
    expect(group?.policy.allowContentGeneration).toBe(false);
    expect(group?.effectivePolicy.allowContentGeneration).toBe(false);
  });

  test("merges workspace profile defaults with group overrides", async () => {
    const groupsPath = await createGroupsFile(`
profiles:
  - id: software-dev
    name: Software Development
    defaultWorkflow: plan-build-review
    skills:
      - code-style
      - testing
    policy:
      allowCodeChanges: true
      allowContentGeneration: false
      requireDirectorReview: true

groups:
  - id: agentrunner-core
    name: AgentRunner Core
    profileId: software-dev
    workspaceId: agentrunner
    workspaceName: AgentRunner
    discordChannelIds:
      - "channel-2"
    projectRoot: /workspace/agentrunner
    artifactRoot: /workspace/vault
    defaultWorkflow: research-report
    allowedRoles:
      - director
      - builder
    skills:
      - repo-style
    policy:
      allowContentGeneration: true
`);

    const manager = new GroupConfigManager(loadConfig({ GROUPS_CONFIG_PATH: groupsPath }));
    await manager.load();

    const group = manager.resolveByChannel("channel-2");
    expect(group?.profile?.id).toBe("software-dev");
    expect(group?.workspaceId).toBe("agentrunner");
    expect(group?.workspaceName).toBe("AgentRunner");
    expect(group?.profile?.defaultWorkflow).toBe("plan-build-review");
    expect(group?.defaultWorkflow).toBe("research-report");
    expect(group?.effectiveSkills).toEqual(["code-style", "testing", "repo-style"]);
    expect(group?.effectivePolicy.allowCodeChanges).toBe(true);
    expect(group?.effectivePolicy.allowContentGeneration).toBe(true);
    expect(manager.listProfiles().map((profile) => profile.id)).toEqual(["software-dev"]);
  });

  test("returns no groups when config path is missing", async () => {
    const manager = new GroupConfigManager(loadConfig({ GROUPS_CONFIG_PATH: "/tmp/agentrunner-missing-groups.yaml" }));
    await manager.load();

    expect(manager.list()).toEqual([]);
    expect(manager.listProfiles()).toEqual([]);
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
      artifactRoot: "/game/artifacts",
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
      effectiveSkills: [],
      effectivePolicy: {
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

  test("uses artifactRoot as vault fallback", () => {
    const base = loadConfig({
      OBSIDIAN_VAULT_PATH: "/base/vault",
    });

    const overridden = applyGroupOverrides(base, {
      id: "docs",
      name: "Docs",
      discordChannelIds: ["channel-3"],
      artifactRoot: "/workspace/artifacts",
      allowedRoles: ["director"],
      skills: [],
      policy: {
        allowCodeChanges: false,
        allowContentGeneration: true,
        requireDirectorReview: true,
      },
      effectiveSkills: [],
      effectivePolicy: {
        allowCodeChanges: false,
        allowContentGeneration: true,
        requireDirectorReview: true,
      },
    });

    expect(overridden.OBSIDIAN_VAULT_PATH).toBe("/workspace/artifacts");
  });
});
