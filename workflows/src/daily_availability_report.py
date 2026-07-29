"""Daily Availability Report — Anthropic API tool-use orchestrator.

Triggered by GitHub Actions every weekday at 8:00 AM America/Chicago.
Calls Claude with a frozen system prompt and four tools (Metabase, Supabase
RPC, Homebase, Slack); Claude reasons through coverage and posts a 3-part
report to #appointment-availability-update.

Required env vars:
    ANTHROPIC_API_KEY          - Anthropic API key
    METABASE_URL               - https://metabase.vitablehealth.com
    METABASE_USERNAME          - Metabase login email
    METABASE_PASSWORD          - Metabase login password
    SUPABASE_URL               - https://bbquooftytwprllipcsb.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  - service_role key (bypasses RLS)
    HOMEBASE_API_KEY           - Bearer token for Homebase API
    HOMEBASE_LOCATION_IDS      - comma-separated Homebase location IDs
    SLACK_BOT_TOKEN            - xoxb-... bot token
    SLACK_CHANNEL_ID           - C08A03ET7C3 (#appointment-availability-update)

Optional:
    REPORT_DATE  - YYYY-MM-DD override; defaults to today (America/Chicago)
    DRY_RUN      - if set, prints Slack messages instead of posting
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic

from prompts.daily_availability_prompt import SYSTEM_PROMPT
from tools import TOOLS, execute as execute_tool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MODEL = "claude-opus-4-7"
MAX_ITERATIONS = 25
CHICAGO = ZoneInfo("America/Chicago")


def _resolve_today() -> date:
    override = os.environ.get("REPORT_DATE", "").strip()
    if override:
        return date.fromisoformat(override)
    return datetime.now(CHICAGO).date()


def _build_user_message(today: date) -> str:
    tomorrow = today + timedelta(days=1)
    return (
        f"Run the daily availability report.\n"
        f"Today is {today.strftime('%A, %B %d, %Y')} ({today.isoformat()}).\n"
        f"Tomorrow is {tomorrow.strftime('%A, %B %d, %Y')} ({tomorrow.isoformat()}).\n"
        f"Begin."
    )


def _execute_tool_safely(name: str, tool_input: dict) -> tuple[str, bool]:
    """Run a tool; on failure return (error_message, is_error=True)."""
    try:
        return execute_tool(name, tool_input), False
    except Exception as exc:  # noqa: BLE001 — surface every tool error to the model
        log.exception("Tool %s failed", name)
        return f"Tool {name} failed: {type(exc).__name__}: {exc}", True


def main() -> int:
    today = _resolve_today()
    log.info("Running availability report for %s", today.isoformat())

    client = anthropic.Anthropic()
    messages: list[dict] = [{"role": "user", "content": _build_user_message(today)}]

    for iteration in range(MAX_ITERATIONS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=TOOLS,
            messages=messages,
        )

        usage = response.usage
        log.info(
            "iter=%d stop=%s in=%d out=%d cache_read=%d cache_write=%d",
            iteration,
            response.stop_reason,
            usage.input_tokens,
            usage.output_tokens,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
        )

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason != "tool_use":
            log.warning("Unexpected stop_reason: %s", response.stop_reason)
            break

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            result_text, is_error = _execute_tool_safely(block.name, block.input)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                    "is_error": is_error,
                }
            )
        messages.append({"role": "user", "content": tool_results})
    else:
        log.error("Hit MAX_ITERATIONS=%d without end_turn — aborting.", MAX_ITERATIONS)
        return 1

    log.info("Report complete in %d iterations.", iteration + 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
