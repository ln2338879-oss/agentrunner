# Setup and Runtime Proof

This guide explains how to install AgentRunner and generate local runtime proof.

## Local Setup

```bash
bash scripts/setup-local.sh
```

The local setup script:

```text
installs dependencies with Bun
creates .env from .env.example when missing
creates data, vault, project, and proof directories
runs bun run proof
prints next commands
```

## Ubuntu Setup

```bash
bash scripts/setup-ubuntu.sh
```

The Ubuntu setup script:

```text
checks git/curl/unzip
installs Bun when missing
clones the repository into /opt/agentrunner by default
installs dependencies
creates .env when missing
sets server-oriented runtime paths
runs bun run proof
prints systemd next steps
```

You can override the install directory and repository URL:

```bash
INSTALL_DIR=/opt/agentrunner REPO_URL=https://github.com/ln2338879-oss/agentrunner.git bash scripts/setup-ubuntu.sh
```

## Runtime Proof

Run:

```bash
bun run proof
```

This command creates a local proof run without requiring Discord tokens, Claude/Codex credentials, or an Ollama server.

It verifies:

```text
Doctor internal path checks
SQLite database creation
Obsidian Vault folder creation
sample task creation
worker queue polling
worker report artifact creation
task completed status
```

The proof file is written to:

```text
docs/proof/runtime-proof.md
```

Local proof runtime files are written to `.agentrunner-proof/`, which is ignored by Git.

## Production Validation

After local proof passes, configure real values in `.env`:

```text
Discord bot tokens
Discord channel IDs
ClaudeCode command/auth
Codex command/auth
Ollama endpoint/model
Vision command, optional
Browser command, optional
```

Then run:

```bash
bun run doctor
bun run start
```

For worker validation:

```bash
AGENTRUNNER_WORKER_ROLE=builder WORKER_POLL_ONCE=true bun run worker
```

For continuous worker polling:

```bash
AGENTRUNNER_WORKER_ROLE=builder bun run worker
```
