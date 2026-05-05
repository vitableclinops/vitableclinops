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
#   ./scripts/deploy-edge-functions.sh                              # deploy both
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
  "evaluate-schedule-submissions"
  "emit-shift-recommendations"
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
  # --no-verify-jwt is intentionally NOT passed; verify_jwt=true is the default.
  # If a function legitimately needs to be public, configure it in supabase/config.toml.
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo ""
echo "Done. Functions deployed:"
printf '  - %s\n' "${FUNCTIONS[@]}"
