"""Homebase REST client — pulls scheduled shifts for a date range.

Verify the base URL and shift endpoint shape against your Homebase API
contract before relying in production. Defaults match the documented
v1 REST API at https://app.joinhomebase.com.
"""

from __future__ import annotations

import os
from typing import Any

import requests

DEFAULT_BASE_URL = "https://app.joinhomebase.com/api/v1"


def get_shifts(start_date: str, end_date: str) -> list[dict[str, Any]]:
    """Return shifts between start_date and end_date (YYYY-MM-DD, inclusive).

    Iterates every configured location (HOMEBASE_LOCATION_IDS, comma-separated)
    and concatenates results. Each shift is enriched with `location_id` so the
    caller can group by state via HOMEBASE_LOCATION_TO_STATE (JSON map).
    """
    base_url = os.environ.get("HOMEBASE_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    api_key = os.environ["HOMEBASE_API_KEY"]
    location_ids_raw = os.environ.get("HOMEBASE_LOCATION_IDS", "").strip()

    if not location_ids_raw:
        raise RuntimeError(
            "HOMEBASE_LOCATION_IDS is not set. "
            "Provide a comma-separated list of Homebase location IDs to pull shifts for."
        )

    location_ids = [s.strip() for s in location_ids_raw.split(",") if s.strip()]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/vnd.homebase-v1+json",
    }
    params = {"start_date": start_date, "end_date": end_date}

    all_shifts: list[dict[str, Any]] = []
    for location_id in location_ids:
        resp = requests.get(
            f"{base_url}/locations/{location_id}/shifts",
            headers=headers,
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        shifts = resp.json()
        if isinstance(shifts, dict):
            shifts = shifts.get("shifts") or shifts.get("data") or []
        for shift in shifts:
            shift["location_id"] = location_id
        all_shifts.extend(shifts)

    return all_shifts
