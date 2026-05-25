#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/agentrunner}"
REPO_URL="${REPO_URL:-https://github.com/ln2338879-oss/agentrunner.git}"

if ! command -v git >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y git curl unzip
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  sudo mkdir -p "$(dirname "$INSTALL_DIR")"
  sudo chown -R "$USER":"$USER" "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
git pull --ff-only || true
bun install

if [ ! -f .env ]; then
  cp .env.example .env
fi

mkdir -p data data/attachments /opt/obsidian-vaults/AgentRunnerVault /opt/game-projects/runebound docs/proof

python3 - <<'PY'
from pathlib import Path
p = Path('.env')
text = p.read_text()
replacements = {
    'DATABASE_PATH=./data/agentrunner.sqlite': 'DATABASE_PATH=/opt/agentrunner/data/agentrunner.sqlite',
    'OBSIDIAN_VAULT_PATH=./vault/AgentRunnerVault': 'OBSIDIAN_VAULT_PATH=/opt/obsidian-vaults/AgentRunnerVault',
    'PROJECT_ROOT=./game-project': 'PROJECT_ROOT=/opt/game-projects/runebound',
    'ATTACHMENTS_DIR=./data/attachments': 'ATTACHMENTS_DIR=/opt/agentrunner/data/attachments',
}
for old, new in replacements.items():
    text = text.replace(old, new)
p.write_text(text)
PY

bun run proof

echo ""
echo "Ubuntu setup complete."
echo "Edit $INSTALL_DIR/.env and fill in Discord tokens, channel IDs, and AI credentials."
echo "Then run:"
echo "  cd $INSTALL_DIR"
echo "  bun run doctor"
echo "  bun run start"
echo "  sudo cp deploy/systemd/agentrunner.service /etc/systemd/system/agentrunner.service"
echo "  sudo cp deploy/systemd/agentrunner-worker@.service /etc/systemd/system/agentrunner-worker@.service"
