# Discord Four-Bot Runtime

AgentRunner can run as four separate Discord bot accounts while sharing one SQLite runtime, one Obsidian vault, and one orchestrator.

## Role layout

| Discord bot | Required token           | Intake channel               | Forced route            | Typical model      |
| ----------- | ------------------------ | ---------------------------- | ----------------------- | ------------------ |
| Director    | `DIRECTOR_DISCORD_TOKEN` | `GAME_DIRECTOR_CHANNEL_ID`   | Auto-routing / Director | Claude Code        |
| Builder     | `BUILDER_DISCORD_TOKEN`  | `DEV_TASKS_CHANNEL_ID`       | Builder keywords        | Codex CLI          |
| Factory     | `FACTORY_DISCORD_TOKEN`  | `CONTENT_FACTORY_CHANNEL_ID` | Factory keywords        | Ollama / local LLM |
| Designer    | `DESIGNER_DISCORD_TOKEN` | `DESIGN_TASKS_CHANNEL_ID`    | Designer keywords       | Gemini image       |

The Director bot still supports automatic routing. The three worker bots create tasks from their own channels and prepend a role-specific routing instruction before handing the request to the central orchestrator.

## Required `.env` shape

```env
DIRECTOR_DISCORD_TOKEN=
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DESIGNER_DISCORD_TOKEN=

GAME_DIRECTOR_CHANNEL_ID=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
DESIGN_TASKS_CHANNEL_ID=
REVIEW_LOG_CHANNEL_ID=
BUILD_LOG_CHANNEL_ID=
```

Use four different Discord applications/bot tokens. AgentRunner refuses to start if two enabled roles share the same token, because logging the same bot account in twice causes reconnects and duplicated event handling.

Use four different intake channels. AgentRunner refuses to start if two enabled bots share the same configured intake channel. This prevents two bots from responding to the same user message.

If a worker token is set but its channel id is empty, that worker logs in but ignores all user messages. This is deliberate: it prevents accidental replies in every visible server channel.

## Message behavior

### Director channel

- Accepts normal requests.
- Classifies the task automatically as Director, Builder, Factory, or Designer.
- Supports `!help`, `!tasks`, `!task`, `!retry`, and `!steer`.
- Slash commands are registered against the Director token.

### Builder channel

- Accepts implementation/debug/build/test requests.
- Adds a Builder routing instruction before task creation.
- Still runs Director review after Builder output.

### Factory channel

- Accepts item, monster, NPC, dialogue, quest, JSON, CSV, and content generation requests.
- Adds a Factory routing instruction before task creation.
- Still runs Director review after Factory output.

### Designer channel

- Accepts image, icon, sprite, pixel art, mockup, and concept art requests.
- Adds a Designer routing instruction before task creation.
- Supports attachments through the same attachment persistence path as the Director bot.
- Still runs Director review after Designer output.

## Safe Discord setup

1. Create four Discord applications in the Developer Portal.
2. Create one bot user per application.
3. Invite all four bots to the same guild.
4. Give each bot access only to the channels it needs.
5. Enable Message Content Intent for each bot.
6. Put each token and channel id in `.env`.
7. Run `bun run doctor`.
8. Start AgentRunner with `bun run start`.

## Recommended channel permissions

| Channel    |       Director bot |   Builder bot |   Factory bot |  Designer bot |
| ---------- | -----------------: | ------------: | ------------: | ------------: |
| Director   |          Read/Send | Optional read | Optional read | Optional read |
| Builder    | Send notifications |     Read/Send |     No access |     No access |
| Factory    | Send notifications |     No access |     Read/Send |     No access |
| Designer   | Send notifications |     No access |     No access |     Read/Send |
| Review log |          Read/Send | Optional read | Optional read | Optional read |
| Build log  |          Read/Send | Optional read |     No access |     No access |

The runtime uses the Director client for notifications, so the Director bot should be able to send messages in worker and log channels.
