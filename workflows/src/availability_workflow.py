"""
Availability Sync — Jotform → Notion via Claude.

Triggered by GitHub Actions on a schedule (every 30 minutes). Steps:
  1. Load the last-processed Jotform submission ID from the state file.
  2. Fetch all new submissions from the Monthly Availability form.
  3. For each submission, use Claude to parse it into structured shift records.
  4. Look up the provider in Notion's Provider Scheduling Status database.
  5. Create each shift as a new row in the Notion Schedule Builder database.
  6. Save the last-processed submission ID back to the state file.

First-run setup:
  Run manually via workflow_dispatch with `since_id` set to the ID of the last
  submission already handled by Zapier. The workflow will process all newer
  submissions and save state for subsequent automatic runs.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from availability_parser import parse_submission_into_shifts
from jotform_client import get_new_submissions
from notion_availability_client import create_shift, find_provider_page_id

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

STATE_FILE = Path(__file__).parent.parent / "state" / "availability-state.json"


# ---------------------------------------------------------------------------
# State helpers
# ---------------------------------------------------------------------------

def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Month extraction
# ---------------------------------------------------------------------------

_MONTH_FMTS = ("%B %Y", "%b %Y", "%Y-%m", "%m/%Y")


def _extract_month(answers: dict) -> str | None:
    raw = answers.get("For which month are you submitting hours?", "").strip()
    if not raw:
        return None
    for fmt in _MONTH_FMTS:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# GitHub Actions output
# ---------------------------------------------------------------------------

def _set_gha_output(key: str, value: str) -> None:
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a") as f:
            f.write(f"{key}={value}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    state = _load_state()

    # workflow_dispatch input overrides persisted state
    since_id: str | None = os.environ.get("SINCE_ID_OVERRIDE") or state.get("last_submission_id")

    if not since_id:
        log.error(
            "No last_submission_id found in state and no SINCE_ID_OVERRIDE set.\n"
            "Run the workflow manually via workflow_dispatch with the `since_id` input "
            "set to the ID of the last Zapier-processed submission to bootstrap state."
        )
        sys.exit(1)

    log.info("Fetching Jotform submissions since ID %s", since_id)
    submissions = get_new_submissions(since_id=since_id)
    log.info("Found %d new submission(s)", len(submissions))

    if not submissions:
        log.info("Nothing to process.")
        return

    total_shifts_created = 0
    total_errors = 0
    last_id = since_id

    for submission in submissions:
        sub_id = submission["submission_id"]
        provider_name = submission["answers"].get("Full Name", "(unknown)")
        log.info("Processing submission %s — %s (submitted %s)",
                 sub_id, provider_name, submission["created_at"])

        # 1. Parse into shifts via Claude
        try:
            shifts = parse_submission_into_shifts(submission)
        except Exception as exc:
            log.error("  Parse failed for submission %s: %s", sub_id, exc)
            total_errors += 1
            last_id = sub_id
            continue

        if not shifts:
            log.info("  No shifts extracted (provider may have submitted no availability)")
            last_id = sub_id
            continue

        # 2. Look up provider in Notion
        provider_email = submission["answers"].get("Vitable Email", "").strip()
        provider_page_id: str | None = None
        if provider_email:
            try:
                provider_page_id = find_provider_page_id(provider_email)
                if provider_page_id:
                    log.info("  Matched provider %s → %s", provider_email, provider_page_id)
                else:
                    log.warning("  No provider record found for %s — shifts will be unlinked",
                                provider_email)
            except Exception as exc:
                log.warning("  Provider lookup failed for %s: %s", provider_email, exc)

        # 3. Create shifts in Notion Schedule Builder
        month = _extract_month(submission["answers"])
        for shift in shifts:
            shift["month"] = month
            try:
                url = create_shift(shift, provider_page_id, month)
                log.info("  Created: %s  →  %s", shift.get("title", "?"), url)
                total_shifts_created += 1
            except Exception as exc:
                log.error("  Failed to create shift %r: %s", shift.get("title"), exc)
                total_errors += 1

        last_id = sub_id

    log.info(
        "Done. %d shift(s) created across %d submission(s). %d error(s).",
        total_shifts_created, len(submissions), total_errors,
    )

    # Persist state
    new_state = {
        "last_submission_id": last_id,
        "last_run": datetime.now(timezone.utc).isoformat(),
    }
    _save_state(new_state)
    _set_gha_output("last_submission_id", last_id)
    log.info("State saved. Last submission ID: %s", last_id)

    if total_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
