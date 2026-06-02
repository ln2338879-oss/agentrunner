import type { EventBusLike, OfficeBridgeCommand, OfficeBridgePayload } from "./types";

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export function isBridgePayload(value: unknown): value is OfficeBridgePayload {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<OfficeBridgePayload>;
  return Array.isArray(maybe.commands);
}

export async function fetchBridgePayload(baseUrl: string): Promise<OfficeBridgePayload> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/office/bridge`, { cache: "no-store" });
  if (!response.ok) throw new Error(`AgentRunner bridge request failed: ${response.status}`);
  const payload = await response.json();
  if (!isBridgePayload(payload)) throw new Error("AgentRunner bridge response is not a bridge payload");
  return payload;
}

export function applyBridgeCommands(eventBus: EventBusLike, commands: OfficeBridgeCommand[]): void {
  for (const command of commands) {
    eventBus.emit(command.type, command.payload);
  }
}

export async function syncBridgeOnce(input: {
  baseUrl: string;
  eventBus: EventBusLike;
}): Promise<OfficeBridgePayload> {
  const payload = await fetchBridgePayload(input.baseUrl);
  applyBridgeCommands(input.eventBus, payload.commands);
  return payload;
}
