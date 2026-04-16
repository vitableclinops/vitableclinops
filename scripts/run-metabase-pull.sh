#!/bin/bash
# run-metabase-pull.sh
# Wrapper called by launchd — loads nvm, then runs the pull script.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/exports/metabase-pull.log"

mkdir -p "$PROJECT_DIR/exports"

# Rotate log if it exceeds 5 MB
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then
  mv "$LOG_FILE" "${LOG_FILE}.bak"
fi

{
  echo ""
  echo "=============================="
  echo "  Run started: $(date)"
  echo "=============================="

  # Load nvm
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

  NODE="$NVM_DIR/versions/node/v24.14.1/bin/node"
  NPX="$NVM_DIR/versions/node/v24.14.1/bin/npx"

  if [ ! -f "$NODE" ]; then
    echo "ERROR: node not found at $NODE"
    exit 1
  fi

  cd "$PROJECT_DIR"

  # Prefer tsx if installed locally, otherwise fall back to --experimental-strip-types
  if [ -f "node_modules/.bin/tsx" ]; then
    "$NPX" tsx scripts/pull-metabase.ts
  else
    "$NODE" --experimental-strip-types scripts/pull-metabase.ts
  fi

  echo "Run finished: $(date)"
} >> "$LOG_FILE" 2>&1
