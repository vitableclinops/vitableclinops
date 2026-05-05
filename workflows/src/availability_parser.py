"""
Uses the Claude API to parse a Jotform availability submission into structured
shift records ready for insertion into the Notion Schedule Builder database.
"""

import json
import logging
import os
import re

import anthropic

log = logging.getLogger(__name__)

_SKIP_LABELS = {
    "Please attest to the following:",
    "How likely are you to recommend working with Vitable to another provider?",
    "Please share feedback on your rating so we can prioritize ways to improve "
    "your experience at Vitable:",
    "Are you interested in being contacted for last-minute availability needs?",
    "How many miles are you willing to travel for in-home or clinic shifts?",
    "Submit",
    "Page Break",
    "Monthly Availability",
}

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def parse_submission_into_shifts(submission: dict) -> list[dict]:
    """
    Parse a normalized Jotform submission into a list of shift dicts.

    Each shift dict contains:
        title        str   — display name for the Notion page
        type         str   — "Weekly" | "One-off" | "Home" | "Off"
        day          str|None  — "Monday"–"Sunday" (Weekly only)
        date         str|None  — "YYYY-MM-DD" (One-off / Home / Off)
        start_time   str|None  — "HH:MM" 24-hour ET
        end_time     str|None  — "HH:MM" 24-hour ET
    """
    answers = submission["answers"]
    provider_name = answers.get("Full Name", "").strip()
    provider_email = answers.get("Vitable Email", "").strip()
    month_raw = answers.get("For which month are you submitting hours?", "").strip()

    # Build the availability text block, skipping noise fields
    avail_lines = []
    for label, value in answers.items():
        if label in _SKIP_LABELS or not value:
            continue
        if label in ("Full Name", "Vitable Email",
                     "For which month are you submitting hours?"):
            continue
        avail_lines.append(f"- {label}: {value}")

    avail_text = "\n".join(avail_lines) if avail_lines else "(no availability provided)"

    last_name = provider_name.split()[-1] if provider_name else "Provider"
    prompt = f"""Provider: {provider_name} ({provider_email})
Submission month: {month_raw}

Availability form answers:
{avail_text}

Parse the above into individual shift records. Rules:
1. "Recurring weekly virtual shifts" → one record per (day, time-block), Type="Weekly"
2. "One-off virtual shifts" → one record per specific date/time, Type="One-off"
3. "In-home and clinic shifts" → one record per specific date/time, Type="Home"
4. Unavailable / blocked dates → one record per date, Type="Off"
5. Ignore any section with no times provided. Ignore NPS, feedback, and attestation.
6. If nothing can be parsed, return [].

Return ONLY a JSON array (no prose, no code fences) where each element is:
{{
  "title": "{last_name} — <day or date> <start>–<end>",
  "type": "Weekly" | "One-off" | "Home" | "Off",
  "day": "Monday"|"Tuesday"|"Wednesday"|"Thursday"|"Friday"|"Saturday"|"Sunday"|null,
  "date": "YYYY-MM-DD" | null,
  "start_time": "HH:MM" | null,
  "end_time": "HH:MM" | null
}}

For Weekly: set "day", leave "date" null.
For One-off / Home / Off: set "date", leave "day" null.
Times are Eastern Time, 24-hour format.
Month context for resolving partial dates: {month_raw}.
"""

    message = _get_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=(
            "You are a scheduling assistant for Vitable Health. "
            "Parse provider availability form data into structured JSON shift records. "
            "Return ONLY a valid JSON array — no explanatory text, no code fences."
        ),
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip accidental markdown fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        shifts = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.error("Claude returned invalid JSON for submission %s: %s",
                  submission["submission_id"], exc)
        log.debug("Raw Claude response: %s", raw)
        return []

    if not isinstance(shifts, list):
        log.error("Claude returned non-list for submission %s", submission["submission_id"])
        return []

    # Attach metadata used downstream
    for shift in shifts:
        shift["provider_name"] = provider_name
        shift["provider_email"] = provider_email
        shift["submission_id"] = submission["submission_id"]

    log.info("  Claude parsed %d shift(s) from submission %s",
             len(shifts), submission["submission_id"])
    return shifts
