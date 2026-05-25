#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh first."
  exit 1
fi

bun src/setup/index.ts --local "$@"
