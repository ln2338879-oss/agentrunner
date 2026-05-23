import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { RuntimeConfig } from "../config";

const DefaultGroupPolicy = {
  allowCodeChanges: true,
  allowContentGeneration: true,
  requireDirectorReview: true,
};

const GroupConfigSchema = z.object({
  groups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    discordChannelIds: z.array(z.string()).default([]),
    projectRoot: z.string().optional(),
    obsidianVaultPath: z.string().optional(),
    factoryModel: z.string().optional(),
    builderTestCommand: z.string().optional(),
    builderBuildCommand: z.string().optional(),
    allowedRoles: z.array(z.enum(["director", "builder", "factory"])).default(["director", "builder", "factory"]),
    skills: z.array(z.string()).default([]),
    policy: z.object({
      allowCodeChanges: z.boolean().default(true),
      allowContentGeneration: z.boolean().default(true),
      requireDirectorReview: z.boolean().default(true),
    }).default(DefaultGroupPolicy),
  })).default([]),
});

export type GroupRuntimeConfig = z.infer<typeof GroupConfigSchema>["groups"][number];

export class GroupConfigManager {
  private groups: GroupRuntimeConfig[] = [];

  constructor(private readonly config: RuntimeConfig) {}

  async load(): Promise<void> {
    if (!this.config.GROUPS_CONFIG_PATH || !existsSync(this.config.GROUPS_CONFIG_PATH)) {
      this.groups = [];
      return;
    }

    const text = await readFile(this.config.GROUPS_CONFIG_PATH, "utf-8");
    const parsed = GroupConfigSchema.parse(parse(text));
    this.groups = parsed.groups;
  }

  resolveByChannel(channelId?: string): GroupRuntimeConfig | null {
    if (!channelId) return null;
    return this.groups.find((group) => group.discordChannelIds.includes(channelId)) ?? null;
  }

  list(): GroupRuntimeConfig[] {
    return [...this.groups];
  }
}

export function applyGroupOverrides(config: RuntimeConfig, group: GroupRuntimeConfig | null): RuntimeConfig {
  if (!group) return config;

  return {
    ...config,
    PROJECT_ROOT: group.projectRoot ?? config.PROJECT_ROOT,
    OBSIDIAN_VAULT_PATH: group.obsidianVaultPath ?? config.OBSIDIAN_VAULT_PATH,
    OLLAMA_MODEL: group.factoryModel ?? config.OLLAMA_MODEL,
    BUILDER_TEST_COMMAND: group.builderTestCommand ?? config.BUILDER_TEST_COMMAND,
    BUILDER_BUILD_COMMAND: group.builderBuildCommand ?? config.BUILDER_BUILD_COMMAND,
  };
}
