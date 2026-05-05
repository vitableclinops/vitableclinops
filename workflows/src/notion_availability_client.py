"""
Notion REST API client for the Availability → Schedule Builder workflow.

Handles:
  - Looking up a provider's page ID in the Provider Scheduling Status database
  - Creating shift rows in the Schedule Builder database
"""

import logging
import os
from datetime import date, timedelta

import requests

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# Full-page database (page ID == database ID for Notion REST API)
SCHEDULE_BUILDER_DB_ID = "294e8687-8fe6-80a2-bfb7-db96c78eb973"

# Provider Scheduling Status — collection ID used as database ID in Notion API
PROVIDER_STATUS_DB_ID = "284e8687-8fe6-808d-aaa2-000b2e82bd93"

_DAY_TO_WEEKDAY: dict[str, int] = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6,
}

log = logging.getLogger(__name__)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['NOTION_TOKEN']}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }


# ---------------------------------------------------------------------------
# Provider lookup
# ---------------------------------------------------------------------------

def find_provider_page_id(email: str) -> str | None:
    """
    Return the Notion page ID for the provider with the given Vitable email,
    or None if not found.
    """
    resp = requests.post(
        f"{NOTION_API_BASE}/databases/{PROVIDER_STATUS_DB_ID}/query",
        headers=_headers(),
        json={
            "filter": {
                "property": "Email",
                "rich_text": {"contains": email.lower()},
            },
            "page_size": 1,
        },
        timeout=30,
    )
    if not resp.ok:
        log.warning("Provider lookup failed (%s): %s", resp.status_code, resp.text)
        return None

    results = resp.json().get("results", [])
    return results[0]["id"] if results else None


# ---------------------------------------------------------------------------
# Shift creation
# ---------------------------------------------------------------------------

def create_shift(shift: dict, provider_page_id: str | None, month: str | None) -> str:
    """
    Create a single shift row in the Schedule Builder database.
    Returns the URL of the newly created Notion page.
    """
    properties = _build_properties(shift, provider_page_id, month)
    resp = requests.post(
        f"{NOTION_API_BASE}/pages",
        headers=_headers(),
        json={
            "parent": {"database_id": SCHEDULE_BUILDER_DB_ID},
            "properties": properties,
        },
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(
            f"Notion create page failed ({resp.status_code}): {resp.text}"
        )
    return resp.json().get("url", "")


def _build_properties(
    shift: dict, provider_page_id: str | None, month: str | None
) -> dict:
    props: dict = {
        "Shift": {
            "title": [{"text": {"content": shift.get("title", "Untitled")}}]
        },
        "Type": {"select": {"name": shift["type"]}},
        "Status": {"status": {"name": "Not started"}},
    }

    if shift.get("day"):
        props["Day"] = {"select": {"name": shift["day"]}}

    # Date property — specific date for One-off / Home / Off
    if shift.get("date") and shift["type"] != "Weekly":
        props["Date"] = {"date": {"start": shift["date"]}}

    # Time property — ISO datetime with start + optional end
    time_date = _resolve_time_date(shift, month)
    if time_date and shift.get("start_time"):
        time_prop: dict = {
            "start": f"{time_date}T{shift['start_time']}:00",
        }
        if shift.get("end_time"):
            time_prop["end"] = f"{time_date}T{shift['end_time']}:00"
        props["Time"] = {"date": time_prop}

    if provider_page_id:
        props["Provider"] = {"relation": [{"id": provider_page_id}]}

    return props


def _resolve_time_date(shift: dict, month: str | None) -> str | None:
    """Return the date string to anchor the Time property."""
    if shift.get("date"):
        return shift["date"]
    if shift.get("day") and month:
        return _first_weekday_in_month(month, shift["day"])
    return None


def _first_weekday_in_month(month: str, day_name: str) -> str | None:
    """Return YYYY-MM-DD of the first occurrence of day_name in the given YYYY-MM month."""
    try:
        year, month_num = int(month[:4]), int(month[5:7])
    except (ValueError, IndexError):
        return None
    target = _DAY_TO_WEEKDAY.get(day_name)
    if target is None:
        return None
    first = date(year, month_num, 1)
    days_ahead = (target - first.weekday()) % 7
    return (first + timedelta(days=days_ahead)).isoformat()
