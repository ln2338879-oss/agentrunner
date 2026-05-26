import type { RuntimeConfig } from "../config";
import type { AgentRole } from "../runtime/types";

export function teamChannel(config: RuntimeConfig): string {
  return process.env.TEAM_CHAT_CHANNEL_ID || config.GAME_DIRECTOR_CHANNEL_ID;
}

export function statusChannel(config: RuntimeConfig, _role: AgentRole): string {
  return process.env.RUNTIME_LOG_CHANNEL_ID || config.REVIEW_LOG_CHANNEL_ID || config.BUILD_LOG_CHANNEL_ID || config.GAME_DIRECTOR_CHANNEL_ID;
}
