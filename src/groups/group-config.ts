import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { RuntimeConfig } from "../config";
import { DefaultRuntimePolicy, RuntimePolicySchema, type RuntimePolicy } from "../policies/types";

const WorkspaceProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultWorkflow: z.string().optional(),
  defaultRoles: z.record(z.string(), z.string()).default({}),
  skills: z.array(z.string()).default([]),
  policy: RuntimePolicySchema.default(DefaultRuntimePolicy),
});

const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  profileId: z.string().optional(),
  workspaceId: z.string().optional(),
  workspaceName: z.string().optional(),
  discordChannelIds: z.array(z.string()).default([]),
  projectRoot: z.string().optional(),
  obsidianVaultPath: z.string().optional(),
  artifactRoot: z.string().optional(),
  factoryModel: z.string().optional(),
  builderTestCommand: z.string().optional(),
  builderBuildCommand: z.string().optional(),
  defaultWorkflow: z.string().optional(),
  allowedRoles: z.array(z.enum(["director", "builder", "factory"])).default(["director", "builder", "factory"]),
  skills: z.array(z.string()).default([]),
  policy: RuntimePolicySchema.default(DefaultRuntimePolicy),
});

const GroupConfigSchema = z.object({
  profiles: z.array(WorkspaceProfileSchema).default([]),
  groups: z.array(GroupSchema).default([]),
});

export type WorkspaceProfileConfig = z.infer<typeof WorkspaceProfileSchema>;
export type GroupRuntimeConfig = z.infer<typeof GroupSchema> & {
  profile?: WorkspaceProfileConfig;
  effectiveSkills: string[];
  effectivePolicy: RuntimePolicy;
};

export class GroupConfigManager {
  private groups: GroupRuntimeConfig[] = [];
  private profiles: WorkspaceProfileConfig[] = [];

  constructor(private readonly config: RuntimeConfig) {}

  async load(): Promise<void> {
    if (!this.config.GROUPS_CONFIG_PATH || !existsSync(this.config.GROUPS_CONFIG_PATH)) {
      this.groups = [];
      this.profiles = [];
      return;
    }

    const text = await readFile(this.config.GROUPS_CONFIG_PATH, "utf-8");
    const parsed = GroupConfigSchema.parse(parse(text));
    this.profiles = parsed.profiles;
    this.groups = parsed.groups.map((group) => this.withEffectiveProfile(group));
  }

  resolveByChannel(channelId?: string): GroupRuntimeConfig | null {
    if (!channelId) return null;
    return this.groups.find((group) => group.discordChannelIds.includes(channelId)) ?? null;
  }

  list(): GroupRuntimeConfig[] {
    return [...this.groups];
  }

  listProfiles(): WorkspaceProfileConfig[] {
    return [...this.profiles];
  }

  private withEffectiveProfile(group: z.infer<typeof GroupSchema>): GroupRuntimeConfig {
    const profile = group.profileId ? this.profiles.find((candidate) => candidate.id === group.profileId) : undefined;
    const effectivePolicy = {
      ...DefaultRuntimePolicy,
      ...(profile?.policy ?? {}),
      ...group.policy,
      requireHumanApprovalFor: [
        ...new Set([
          ...(profile?.policy.requireHumanApprovalFor ?? []),
          ...(group.policy.requireHumanApprovalFor ?? []),
        ]),
      ],
    };
    const effectiveSkills = [...new Set([...(profile?.skills ?? []), ...group.skills])];

    return {
      ...group,
      profile,
      effectiveSkills,
      effectivePolicy,
    };
  }
}

export function applyGroupOverrides(config: RuntimeConfig, group: GroupRuntimeConfig | null): RuntimeConfig {
  if (!group) return config;

  return {
    ...config,
    PROJECT_ROOT: group.projectRoot ?? config.PROJECT_ROOT,
    OBSIDIAN_VAULT_PATH: group.obsidianVaultPath ?? group.artifactRoot ?? config.OBSIDIAN_VAULT_PATH,
    OLLAMA_MODEL: group.factoryModel ?? config.OLLAMA_MODEL,
    BUILDER_TEST_COMMAND: group.builderTestCommand ?? config.BUILDER_TEST_COMMAND,
    BUILDER_BUILD_COMMAND: group.builderBuildCommand ?? config.BUILDER_BUILD_COMMAND,
  };
}
