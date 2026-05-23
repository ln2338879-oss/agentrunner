# Doctor and Vision Setup

## Runtime Doctor

Run this after installing AgentRunner on a local machine, mini PC, or VPS:

```bash
bun run doctor
```

The doctor checks:

```text
.env presence
SQLite database directory
Obsidian Vault write access
Project Root write access
Attachments directory write access
Director token and channel ID
ClaudeCode command
Codex command
Ollama/OpenAI-compatible endpoint
Vision command
```

A failed check means the server may not be ready for unattended Discord-driven game development.

## Vision Command

AgentRunner calls `VISION_COMMAND` when Discord image attachments have been saved as local files. The command receives image paths through stdin and writes analysis to stdout.

OpenAI example:

```env
VISION_COMMAND=bun scripts/vision-openai.ts
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
```

Gemini example:

```env
VISION_COMMAND=bun scripts/vision-gemini.ts
GEMINI_API_KEY=...
GEMINI_VISION_MODEL=gemini-2.5-flash
```

The scripts are examples. You can replace `VISION_COMMAND` with any local CLI that reads stdin and writes image analysis to stdout.
