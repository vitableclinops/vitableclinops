"""
ClinOps Weekly Sync — post-meeting automation.

Triggered by GitHub Actions every Tuesday at 12:15 PM CT.
Steps:
  1. Fetch today's ClinOps Weekly Sync notes from Granola.
  2. Parse Granola's existing AI summary for per-person action items.
  3. Post the summary to Slack #clinops-meeting-prep-and-process-improvement.
  4. Create a triage issue in Linear (Clinical team) for each action item.
"""

import logging
import os
import sys

from granola_client import get_todays_clinops_sync
from linear_client import create_triage_issues
from slack_client import post_meeting_summary
from synthesizer import extract_action_items

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    target_date = os.environ.get("WORKFLOW_DATE") or None
    log.info("Starting ClinOps post-meeting workflow (date=%s)", target_date or "today")

    # 1. Granola
    log.info("Fetching meeting notes from Granola...")
    meeting = get_todays_clinops_sync(target_date)
    log.info("Found: %s (%s)", meeting["title"], meeting["date"])

    if not meeting["summary"]:
        log.error("Meeting found but summary is empty — notes may not be ready yet.")
        sys.exit(1)

    # 2. Parse Granola's summary for action items
    log.info("Parsing action items from Granola summary...")
    synthesis = extract_action_items(meeting)
    total_items = sum(len(v) for v in synthesis["action_items"].values())
    log.info("Found %d action item(s) across %d person(s)", total_items, len(synthesis["action_items"]))

    # 3. Slack
    log.info("Posting summary to Slack...")
    post_meeting_summary(meeting, synthesis)
    log.info("Slack message posted to #clinops-meeting-prep-and-process-improvement")

    # 4. Linear
    log.info("Creating Linear triage issues...")
    result = create_triage_issues(meeting, synthesis)
    log.info("Linear: %d created, %d failed", result["created"], result["failed"])
    for url in result["urls"]:
        log.info("  %s", url)

    if result["errors"]:
        for err in result["errors"]:
            log.error("  %s", err)
        sys.exit(1)

    log.info("Done.")


if __name__ == "__main__":
    main()
