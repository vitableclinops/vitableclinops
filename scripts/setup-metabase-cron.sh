#!/bin/bash
# setup-metabase-cron.sh
#
# One-time setup: installs the launchd agent so the Metabase pull
# runs automatically every day at 7:00 AM.
#
# Usage:  bash scripts/setup-metabase-cron.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.vitable.metabase-pull.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.vitable.metabase-pull.plist"
ENV_FILE="$SCRIPT_DIR/../.env.metabase"
ENV_EXAMPLE="$SCRIPT_DIR/../.env.metabase.example"

echo ""
echo "=== Metabase Daily Pull — Setup ==="
echo ""

# 1. Check .env.metabase exists
if [ ! -f "$ENV_FILE" ]; then
  echo "⚠️  .env.metabase not found."
  echo "    Copy the example and fill in your credentials:"
  echo ""
  echo "    cp .env.metabase.example .env.metabase"
  echo "    open .env.metabase"
  echo ""
  read -rp "Would you like to create it now from the example? [y/N] " yn
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created .env.metabase — please fill in your credentials, then re-run this script."
    exit 0
  else
    echo "Aborting. Please create .env.metabase before running setup."
    exit 1
  fi
fi

# Warn if credentials are still placeholders
if grep -q "your-email@vitablehealth.com\|your-password\|your-service-role-key" "$ENV_FILE"; then
  echo "⚠️  .env.metabase still contains placeholder values."
  echo "    Edit the file and replace them with real credentials first:"
  echo "    open .env.metabase"
  echo ""
  read -rp "Continue anyway? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# 2. Install the plist
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DEST"
echo "✓  Copied plist → $PLIST_DEST"

# 3. Load (or reload) the agent
if launchctl list com.vitable.metabase-pull &>/dev/null; then
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi
launchctl load "$PLIST_DEST"
echo "✓  Loaded launchd agent"

echo ""
echo "Done! The pull will run every day at 7:00 AM."
echo ""
echo "To run it manually right now:"
echo "  bash scripts/run-metabase-pull.sh"
echo ""
echo "To check the log:"
echo "  tail -f exports/metabase-pull.log"
echo ""
echo "To uninstall:"
echo "  launchctl unload ~/Library/LaunchAgents/com.vitable.metabase-pull.plist"
echo "  rm ~/Library/LaunchAgents/com.vitable.metabase-pull.plist"
