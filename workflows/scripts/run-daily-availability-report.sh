#!/usr/bin/env bash
# Runs the daily availability report skill via Claude Code CLI.
# Invoked by the systemd timer daily-availability-report.timer at 8:00 AM Central.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/daily-availability-report-$(date +%Y-%m-%d).log"

mkdir -p "${LOG_DIR}"

# CLINOPS_ANON_KEY must be set in the environment drop-in:
#   ~/.config/systemd/user/daily-availability-report.service.d/env.conf
#
# To set it, run:
#   mkdir -p ~/.config/systemd/user/daily-availability-report.service.d
#   printf '[Service]\nEnvironment="CLINOPS_ANON_KEY=<your-key-here>"\n' \
#     > ~/.config/systemd/user/daily-availability-report.service.d/env.conf
#   systemctl --user daemon-reload

if [[ -z "${CLINOPS_ANON_KEY:-}" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: CLINOPS_ANON_KEY is not set. Aborting." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting daily availability report..." | tee -a "${LOG_FILE}"

/opt/node22/bin/claude \
  --dangerously-skip-permissions \
  -p "run the availability report" \
  2>&1 | tee -a "${LOG_FILE}"

EXIT_CODE=${PIPESTATUS[0]}

if [[ ${EXIT_CODE} -eq 0 ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Report completed successfully." | tee -a "${LOG_FILE}"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: Report exited with code ${EXIT_CODE}." | tee -a "${LOG_FILE}"
fi

# Prune logs older than 30 days
find "${LOG_DIR}" -name "daily-availability-report-*.log" -mtime +30 -delete

exit ${EXIT_CODE}
