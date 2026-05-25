import { z } from "zod";

export const RoleProviderSchema = z.enum([
  "claude-code",
  "codex",
  "ollama",
  "nanobanana",
  "gemini-image",
  "openai",
  "gemini",
  "anthropic",
  "command",
  "mock",
]);

export const RoleCapabilitySchema = z.enum([
  "plan",
  "implement",
  "review",
  "arbitrate",
  "generate-content",
  "generate-image",
  "design-production",
  "research",
  "operate",
  "run-tests",
  "write-files",
]);

export const DefaultRolePermissions = {
  canWriteFiles: false,
  canRunCommands: false,
  canRunTests: false,
  canReview: false,
  canArbitrate: false,
  canCreateTasks: false,
  requiresReview: true,
};

export const RolePermissionSchema = z.object({
  canWriteFiles: z.boolean().default(false),
  canRunCommands: z.boolean().default(false),
  canRunTests: z.boolean().default(false),
  canReview: z.boolean().default(false),
  canArbitrate: z.boolean().default(false),
  canCreateTasks: z.boolean().default(false),
  requiresReview: z.boolean().default(true),
});

export const RoleDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  legacyRole: z.enum(["director", "builder", "factory", "designer"]).optional(),
  provider: RoleProviderSchema,
  model: z.string().optional(),
  command: z.string().optional(),
  fallbackCommands: z.array(z.string()).default([]),
  capabilities: z.array(RoleCapabilitySchema).default([]),
  permissions: RolePermissionSchema.default(DefaultRolePermissions),
  timeoutMs: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
});

export const RoleRegistryConfigSchema = z.object({
  roles: z.array(RoleDefinitionSchema).default([]),
  aliases: z.record(z.string(), z.string()).default({}),
});

export type RoleProvider = z.infer<typeof RoleProviderSchema>;
export type RoleCapability = z.infer<typeof RoleCapabilitySchema>;
export type RolePermission = z.infer<typeof RolePermissionSchema>;
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;
export type RoleRegistryConfig = z.infer<typeof RoleRegistryConfigSchema>;
