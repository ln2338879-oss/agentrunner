# Office Bridge Endpoints

AgentRunner exposes read-only Office endpoints for a separate DeskRPG-derived frontend.

## Endpoints

```text
GET /api/office/snapshot
GET /api/office/bridge
GET /api/office/events
```

`/api/office/snapshot` returns the visual state model.

`/api/office/bridge` returns the same snapshot plus commands that a DeskRPG adapter can map to `EventBus.emit(...)`.

`/api/office/events` streams periodic `snapshot` Server-Sent Events.

## Bridge commands

```text
office:summary
office:zone-map
npc:spawn-local
npc:move-local
npc:bubble
taskboard:replace
office:log-replace
```

## Frontend role

The DeskRPG Office frontend should stay read-only at first. Discord remains the command, conversation, meeting, and approval surface. AgentRunner remains the source of truth.
