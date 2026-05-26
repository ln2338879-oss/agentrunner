import type { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export function statusChannel(config: RuntimeConfig, role: AgentRole): string {
  if (role === "builder") return config.BUILD_LOG_CHANNEL_ID || config.REVIEW_LOG_CHANNEL_ID || config.GAME_DIRECTOR_CHANNEL_ID;
  return config.REVIEW_LOG_CHANNEL_ID || config.BUILD_LOG_CHANNEL_ID || config.GAME_DIRECTOR_CHANNEL_ID;
}
