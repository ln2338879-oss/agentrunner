# DeskRPG Office Integration Plan

This is the next integration layer after the AgentRunner Office dashboard.

## Product split

```text
Discord = conversation, commands, meetings, approvals
AgentRunner = source of truth and work execution
DeskRPG Office = visual control room
```

The first DeskRPG-derived frontend should be read-only. It should display AgentRunner state, not mutate task state directly.

## Runtime endpoints

```text
GET /api/office/snapshot
GET /api/office/bridge
GET /api/office/events
```

`/api/office/bridge` returns commands that a DeskRPG adapter can translate into `EventBus.emit(...)` calls. `/api/office/events` streams refreshed snapshots.

## Bridge flow

```text
DeskRPG React page
  -> fetch /api/office/bridge
  -> apply each command through EventBus
  -> Phaser scene updates NPCs, bubbles, task board, and logs
```

Recommended first hook:

```ts
useAgentRunnerBridge({
  baseUrl: "http://127.0.0.1:8787",
  mode: "read-only",
});
```

## Command contract

| Command | DeskRPG action |
|---|---|
| `office:summary` | Update dashboard summary |
| `office:zone-map` | Register or draw office zones |
| `npc:spawn-local` | Spawn/update a local NPC for an agent |
| `npc:move-local` | Move the NPC to the mapped office zone |
| `npc:bubble` | Show current task/status text over the NPC |
| `taskboard:replace` | Replace read-only board data |
| `office:log-replace` | Replace side-panel live log |

## DeskRPG code targets

```text
src/hooks/useAgentRunnerBridge.ts
src/lib/agentrunner/types.ts
src/lib/agentrunner/bridge.ts
src/components/agentrunner/AgentRunnerPanel.tsx
src/game/scenes/GameScene.ts
src/components/TaskBoard.tsx
```

Minimal Phaser scene events:

```text
npc:spawn-local
npc:move-local
npc:bubble
office:zone-map
```

Minimal React-side events:

```text
office:summary
taskboard:replace
office:log-replace
```

## Local development

Run AgentRunner dashboard:

```bash
bun run dashboard
```

Run the DeskRPG frontend separately on port 3000. The dashboard currently reflects CORS only for local development origins:

```text
http://localhost:3000
http://127.0.0.1:3000
http://localhost:8787
http://127.0.0.1:8787
```

Do not expose the dashboard outside localhost until authentication exists.

## MVP checklist

- [ ] Keep DeskRPG login for a single local admin user.
- [ ] Hide DeskRPG chat, meeting, invite, NPC hire, and OpenClaw settings.
- [ ] Add `useAgentRunnerBridge`.
- [ ] Render Director, Builder, Factory, Designer as office NPCs.
- [ ] Move NPCs by office zone.
- [ ] Show bubbles from `npc:bubble`.
- [ ] Replace TaskBoard with read-only AgentRunner tasks.
- [ ] Replace chat/right panel with AgentRunnerPanel.
- [ ] Add Discord thread links after AgentRunner persists them.
