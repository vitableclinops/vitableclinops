#!/usr/bin/env bash
# deploy-edge-functions.sh
#
# Deploys Supabase Edge Functions from main using the official Supabase CLI.
# This is the canonical deploy path: it uses the unmodified source files
# directly with their relative `_shared` imports, so the deployed code is
# byte-reproducible from main without intermediate bundling.
#
# Prerequisites:
#   - supabase CLI installed (https://supabase.com/docs/guides/cli)
#   - SUPABASE_ACCESS_TOKEN set (https://supabase.com/dashboard/account/tokens)
#   - Project linked: `supabase link --project-ref bbquooftytwprllipcsb` (one-time)
#
# Usage:
#   ./scripts/deploy-edge-functions.sh                              # deploy scheduling pipeline
#   ./scripts/deploy-edge-functions.sh evaluate-schedule-submissions
#   ./scripts/deploy-edge-functions.sh emit-shift-recommendations
#
# CI: this script is suitable for invocation from a GitHub Actions workflow
# triggered on push to main. See workflows/deploy-edge-functions.yml.example
# for a template.

set -euo pipefail

PROJECT_REF="bbquooftytwprllipcsb"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_FUNCTIONS=(
  "compute-demand-forecast"
  "evaluate-schedule-submissions"
  "emit-shift-recommendations"
  "sync-homebase"
  "sync-jotform-submissions"
)

if [[ $# -eq 0 ]]; then
  FUNCTIONS=("${DEFAULT_FUNCTIONS[@]}")
else
  FUNCTIONS=("$@")
fi

if ! command -v supabase >/dev/null 2>&1; then
  cat <<'EOF' >&2
ERROR: supabase CLI not found. Install via:
  brew install supabase/tap/supabase                      # macOS
  npm i -g supabase                                       # Node-based
  https://supabase.com/docs/guides/cli/getting-started    # other platforms
EOF
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN env var not set." >&2
  echo "       Generate at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

cd "$ROOT_DIR"

for fn in "${FUNCTIONS[@]}"; do
  fn_dir="supabase/functions/$fn"
  if [[ ! -d "$fn_dir" ]]; then
    echo "ERROR: $fn_dir does not exist." >&2
    exit 1
  fi
  echo ""
  echo "==> Deploying $fn from $fn_dir"
  # Some CLI versions ignore [functions.<name>] verify_jwt blocks in
  # supabase/config.toml when deploying a single function, leaving JWT
  # verification on (the default) and breaking callers that invoke with the
  # anon key. Detect the per-function setting from config.toml ourselves and
  # pass --no-verify-jwt explicitly when it's declared false there.
  jwt_flag=()
  if awk -v fn="$fn" '
    BEGIN { in_block = 0 }
    /^\[functions\./ {
      in_block = ($0 == "[functions." fn "]") ? 1 : 0
      next
    }
    in_block && /^[[:space:]]*verify_jwt[[:space:]]*=[[:space:]]*false/ { found = 1; exit }
    END { exit (found ? 0 : 1) }
  ' supabase/config.toml; then
    jwt_flag=(--no-verify-jwt)
    echo "    (verify_jwt=false per supabase/config.toml)"
  fi
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" "${jwt_flag[@]}"
done

echo ""
echo "Done. Functions deployed:"
printf '  - %s\n' "${FUNCTIONS[@]}"
