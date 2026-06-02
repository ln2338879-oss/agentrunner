"use client";

import { useEffect, useState } from "react";
import { syncBridgeOnce } from "../lib/agentrunner/bridge";
import type { EventBusLike, OfficeBridgeConnectionState, OfficeBridgePayload } from "../lib/agentrunner/types";

export interface UseAgentRunnerBridgeOptions {
  baseUrl?: string;
  eventBus: EventBusLike;
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseAgentRunnerBridgeResult {
  state: OfficeBridgeConnectionState;
  lastPayload: OfficeBridgePayload | null;
  lastError: string | null;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_INTERVAL_MS = 3000;

export function useAgentRunnerBridge({
  baseUrl = DEFAULT_BASE_URL,
  eventBus,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseAgentRunnerBridgeOptions): UseAgentRunnerBridgeResult {
  const [state, setState] = useState<OfficeBridgeConnectionState>(enabled ? "connecting" : "closed");
  const [lastPayload, setLastPayload] = useState<OfficeBridgePayload | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState("closed");
      return;
    }

    let cancelled = false;

    async function sync() {
      try {
        setState((current) => current === "connected" ? "reconnecting" : "connecting");
        const payload = await syncBridgeOnce({ baseUrl, eventBus });
        if (cancelled) return;
        setLastPayload(payload);
        setLastError(null);
        setState("connected");
      } catch (error) {
        if (cancelled) return;
        setLastError(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    }

    void sync();
    const timer = window.setInterval(() => void sync(), intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setState("closed");
    };
  }, [baseUrl, enabled, eventBus, intervalMs]);

  return { state, lastPayload, lastError };
}
