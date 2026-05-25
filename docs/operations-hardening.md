# Operations Hardening

This guide covers the AgentRunner features that improve long-running reliability and close the gap with mature multi-agent runtimes.

## Agent Failover

AgentRunner can try multiple command candidates for ClaudeCode, Codex, and Factory workers.

```env
ENABLE_AGENT_FAILOVER=true
CLAUDE_CODE_COMMAND=claude
CLAUDE_CODE_COMMANDS=claude --profile backup||claude --profile fallback
CODEX_COMMAND=codex
CODEX_COMMANDS=codex --profile backup
FACTORY_COMMANDS=
```

Candidates are separated with `||`. The first successful command wins. The executed command and exit status are written into the agent report.

Factory also supports endpoint and model fallback:

```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_BASE_URLS=http://127.0.0.1:11434/v1||http://backup-host:11434/v1
OLLAMA_MODEL=gemma
OLLAMA_MODELS=llama3.1||mistral
```

## Browser Context Command

AgentRunner can enrich URL-heavy tasks before they are routed to agents.

```env
BROWSER_COMMAND=bun scripts/browser-fetch.ts
BROWSER_COMMAND_TIMEOUT_MS=300000
```

When a prompt includes URLs and `BROWSER_COMMAND` is set, AgentRunner sends the URLs to the command through stdin and appends stdout as `# Browser Context`.

`scripts/browser-fetch.ts` is a lightweight default command. It fetches URLs, strips basic HTML, and returns concise page text. Replace it with a Playwright script if you need Chromium screenshots, login flows, or dynamic pages.

## Worker Process Isolation

The central Discord runtime still lives in `bun run start`, but workers can now run as isolated role processes that poll the SQLite queue for pending tasks assigned to their role.

```bash
AGENTRUNNER_WORKER_ROLE=director bun run worker
AGENTRUNNER_WORKER_ROLE=builder bun run worker
AGENTRUNNER_WORKER_ROLE=factory bun run worker
```

Worker polling settings:

```env
WORKER_POLL_INTERVAL_MS=5000
WORKER_POLL_ONCE=false
```

For one-shot validation:

```bash
AGENTRUNNER_WORKER_ROLE=builder WORKER_POLL_ONCE=true bun run worker
```

The worker flow is:

```text
pending task
→ role worker claims task
→ lease is acquired
→ agent runs
→ task_runs and artifact records are written
→ task becomes completed or failed
→ lease is released
```

A systemd template is available:

```text
deploy/systemd/agentrunner-worker@.service
```

Example:

```bash
sudo systemctl enable --now agentrunner-worker@director
sudo systemctl enable --now agentrunner-worker@builder
sudo systemctl enable --now agentrunner-worker@factory
```

## Doctor Checks

`bun run doctor` checks optional browser and vision command availability in addition to runtime paths, Discord settings, AI commands, and the Ollama-compatible endpoint.
