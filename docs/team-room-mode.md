# Team Room Mode

Team Room Mode is the Director-led Discord operating mode.

## Run

```bash
bun run team
```

Use the existing runtime with:

```bash
bun run start
```

## Channel layout

```env
GAME_DIRECTOR_CHANNEL_ID=<team-room-channel>
REVIEW_LOG_CHANNEL_ID=<runtime-log-channel>
BUILD_LOG_CHANNEL_ID=<runtime-log-channel-or-build-log-channel>
```

`GAME_DIRECTOR_CHANNEL_ID` is the shared team room.

## Rule

Only the Director bot turns user messages into AgentRunner tasks.

Builder, Factory, and Designer bot clients can still log in and speak in the shared team room through the notifier, but they do not process user messages in this mode.

## Logs

Runtime status belongs in log channels, not the team room.

Examples:

```text
task created
worker report
review result
approved
failed
startup recovery
```

## Visible team room messages

The team room should contain conversation-level messages:

```text
Director: I received the request and assigned it to Builder.
Builder: result summary
Director: Review result: APPROVED
Director: Task complete.
```

## Current scope

This mode wires role bot accounts into a shared room notifier and turns worker bots into output-only participants. Scheduler step-by-step conversation streaming can be expanded next.
