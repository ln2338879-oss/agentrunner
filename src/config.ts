import { z } from "zod";

const ConfigSchema = z.object({
  DIRECTOR_DISCORD_TOKEN: z.string().optional().default(""),
  BUILDER_DISCORD_TOKEN: z.string().optional().default(""),
  FACTORY_DISCORD_TOKEN: z.string().optional().default(""),
  GAME_DIRECTOR_CHANNEL_ID: z.string().optional().default(""),
  DEV_TASKS_CHANNEL_ID: z.string().optional().default(""),
  CONTENT_FACTORY_CHANNEL_ID: z.string().optional().default(""),
  REVIEW_LOG_CHANNEL_ID: z.string().optional().default(""),
  BUILD_LOG_CHANNEL_ID: z.string().optional().default(""),
  DATABASE_PATH: z.string().default("./data/agentrunner.sqlite"),
  OBSIDIAN_VAULT_PATH: z.string().default("./vault/AgentRunnerVault"),
  PROJECT_ROOT: z.string().default("./game-project"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  OLLAMA_MODEL: z.string().default("gemma"),
  MAX_REVIEW_ROUNDS: z.coerce.number().int().positive().default(3),
  TASK_LEASE_MINUTES: z.coerce.number().int().positive().default(30),
  REQUIRE_USER_APPROVAL_BEFORE_COMMIT: z.coerce.boolean().default(true),
});

export type RuntimeConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return ConfigSchema.parse(env);
}
