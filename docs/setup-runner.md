# AgentRunner Setup Runner

AgentRunner now has a Bun-based setup runner that creates a repeatable `setup-report.md` and ties setup, doctor, proof, systemd status checks, and VPS first-run guidance together.

## Commands

```bash
bun run setup
bun run setup:check
bun run setup:local
bun run setup:ubuntu
bun run setup:systemd
bun run setup:vps
```

`setup:ubuntu` and `setup:systemd` are safe by default. They write a plan into `setup-report.md`. Add `--apply` only when you want to run the planned commands.

```bash
bun run setup:ubuntu -- --apply
bun run setup:systemd -- --apply
```

Use `--yes` for non-interactive server automation:

```bash
bun run setup:systemd -- --apply --yes
```

## What the report contains

`setup-report.md` includes:

- platform detection
- setup action result or plan
- `doctor` check table
- `proof` command result when applicable
- systemd service status
- Discord bot token/channel checklist
- VPS first-run guide

The report is ignored by Git because it can contain local paths and operational details.

## Recommended flow

### Local machine

```bash
bun run setup:local
bun run doctor
bun run start
```

### Ubuntu VPS

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git /opt/agentrunner
cd /opt/agentrunner
bun install
bun run setup:ubuntu
```

Review `setup-report.md`, fill in `.env`, then run:

```bash
bun run setup:ubuntu -- --apply
bun run setup:systemd -- --apply
```

### Discord checklist

Required:

```env
DIRECTOR_DISCORD_TOKEN=
GAME_DIRECTOR_CHANNEL_ID=
```

Optional but recommended for the 3-bot runtime:

```env
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
REVIEW_LOG_CHANNEL_ID=
BUILD_LOG_CHANNEL_ID=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
REGISTER_SLASH_COMMANDS=true
```

## Runtime first-run guide

1. Run `bun run setup:check`.
2. Fix failed checks in `setup-report.md`.
3. Run `bun run proof` to verify local SQLite, vault, worker polling, and artifact output.
4. Start the runtime with `bun run start` or `sudo systemctl start agentrunner`.
5. In Discord, send:

```text
/run prompt: 테스트용 포션 아이템 5개를 JSON으로 만들고 Director가 리뷰해줘
```

6. Confirm outputs in Discord and in the Obsidian vault folders.
