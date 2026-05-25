#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh first."
  exit 1
fi

bun install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in Discord tokens and channel IDs before running the Discord runtime."
fi

mkdir -p data data/attachments vault/AgentRunnerVault game-project docs/proof

bun run proof

echo ""
echo "Local setup complete."
echo "Next commands:"
echo "  bun run doctor"
echo "  bun run start"
echo "  bun run dashboard"
echo "  AGENTRUNNER_WORKER_ROLE=builder WORKER_POLL_ONCE=true bun run worker"
