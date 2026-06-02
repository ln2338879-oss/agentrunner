# AgentRunner Office

AgentRunner Office is the built-in DeskRPG-style visual control room for AgentRunner.

It is intentionally part of the main AgentRunner repository so a server only needs one checkout:

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
bun install
bun run office
```

Open:

```text
http://127.0.0.1:3000/
```

## Runtime split

```text
Discord = conversation, commands, meetings, approvals
AgentRunner = source of truth and work execution
Office = read-only visual control room
```

The Office server reads the same SQLite database as AgentRunner and uses the same office model as the dashboard bridge.

## Commands

```bash
bun run office      # run the built-in office server
bun run office:dev  # run the office server in watch mode
```

Optional environment variables:

```env
OFFICE_HOST=127.0.0.1
OFFICE_PORT=3000
```

If these are omitted, Office defaults to `127.0.0.1:3000`.

## Routes

```text
GET /                  # Office UI
GET /office            # Office UI alias
GET /health            # Office health
GET /api/office/snapshot
GET /api/office/bridge
GET /api/office/events
```

The UI uses `/api/office/bridge` and `/api/office/events` internally.

## What is included now

The first all-in-one version includes:

- one-process Bun office server
- pixel-style canvas office
- office zones from AgentRunner state
- Director / Builder / Factory / Designer characters
- speech bubbles showing current task/status
- runtime summary panel
- agent list
- attention queue
- live task log
- bridge and snapshot API routes

This version does not require Next.js, Phaser, Socket.IO, or a second repository.

## What is intentionally not included yet

The MVP intentionally does not include these DeskRPG features:

- browser chat
- meeting room
- OpenClaw settings
- NPC hiring
- multiplayer channels
- task mutation from the office UI

Discord remains the command and approval surface. Office stays read-only until AgentRunner policy gates are wired into any future controls.

## Next steps

1. Replace the canvas placeholder sprites with selected DeskRPG pixel assets.
2. Add a local admin login gate if the office is exposed beyond localhost.
3. Add Discord thread/deep links to task cards once AgentRunner stores them.
4. Add optional controls that call AgentRunner policy-checked APIs instead of mutating state directly.
