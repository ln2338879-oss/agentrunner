export type BridgeCommandType =
  | "office:summary"
  | "office:zone-map"
  | "npc:spawn-local"
  | "npc:move-local"
  | "npc:bubble"
  | "taskboard:replace"
  | "office:log-replace";

export interface EventBusLike {
  emit(type: string, payload?: unknown): void;
}

export interface OfficeBridgeCommand {
  type: BridgeCommandType;
  payload: unknown;
}

export interface OfficeBridgePayload {
  generatedAt: string;
  commands: OfficeBridgeCommand[];
  snapshot: unknown;
}

export type OfficeBridgeConnectionState = "connecting" | "connected" | "reconnecting" | "error" | "closed";
