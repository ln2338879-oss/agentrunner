# DeskRPG Office Adapter Starter

This folder contains a copy-ready starter adapter for a DeskRPG-derived frontend.

The intended split is:

```text
Discord = conversation, commands, meetings, approvals
AgentRunner = source of truth and work execution
DeskRPG Office = read-only visual control room
```

## AgentRunner endpoints

Run AgentRunner dashboard first:

```bash
bun run dashboard
```

Then the DeskRPG frontend can read:

```text
GET http://127.0.0.1:8787/api/office/bridge
GET http://127.0.0.1:8787/api/office/events
```

## Files

Copy these files into the DeskRPG-derived frontend:

```text
src/lib/agentrunner/types.ts
src/lib/agentrunner/bridge.ts
src/hooks/useAgentRunnerBridge.ts
```

The hook accepts an EventBus-like object:

```ts
useAgentRunnerBridge({
  baseUrl: "http://127.0.0.1:8787",
  eventBus: EventBus,
});
```

It fetches `/api/office/bridge`, applies every returned command to `eventBus.emit(type, payload)`, then listens to `/api/office/events` and refetches bridge commands whenever AgentRunner publishes a new snapshot.

## Expected DeskRPG handlers

The Phaser scene should handle:

```text
office:zone-map
npc:spawn-local
npc:move-local
npc:bubble
```

The React side panel or task board should handle:

```text
office:summary
taskboard:replace
office:log-replace
```

Keep these handlers read-only for the MVP. Approvals and commands should stay in Discord.
