"""Sync provider utilization from Metabase to Supabase.

Pulls today's per-provider utilization from a Metabase card and upserts
into provider_utilization_daily. If the daily card returns no rows or
errors, falls back to a 5-week rolling-average card.

Matches Metabase rows to Supabase providers by name (case-insensitive
trim). Unmatched names are logged loudly so they can be fixed in either
system — typically the Metabase card name or the Supabase `providers.name`.

Required env vars:
    METABASE_URL, METABASE_USERNAME, METABASE_PASSWORD
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    METABASE_DAILY_UTIL_CARD_ID           - Metabase card with today's util
    METABASE_5WK_UTIL_CARD_ID             - Metabase card with 5-week avg

Optional (configure to match your Metabase card columns):
    UTIL_NAME_COLUMN  - default "Provider"
    UTIL_PCT_COLUMN   - default "Utilization Rate"
    REPORT_DATE       - YYYY-MM-DD override; defaults to today (Chicago)
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from tools.metabase import query_card

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

CHICAGO = ZoneInfo("America/Chicago")


def _get_today() -> date:
    override = os.environ.get("REPORT_DATE", "").strip()
    if override:
        return date.fromisoformat(override)
    return datetime.now(CHICAGO).date()


def _normalize(name: str) -> str:
    return " ".join(name.split()).strip().lower()


def _fetch_supabase_providers(base_url: str, key: str) -> dict[str, str]:
    """Return {normalized_name -> provider_id} for active providers."""
    resp = requests.get(
        f"{base_url}/rest/v1/providers",
        params={"select": "id,name", "active": "eq.true"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    resp.raise_for_status()
    return {_normalize(p["name"]): p["id"] for p in resp.json() if p.get("name")}


def _upsert(base_url: str, key: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    resp = requests.post(
        f"{base_url}/rest/v1/provider_utilization_daily",
        params={"on_conflict": "provider_id,date"},
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        json=rows,
        timeout=30,
    )
    resp.raise_for_status()


def _build_rows(
    metabase_rows: list[dict[str, Any]],
    name_col: str,
    pct_col: str,
    name_to_id: dict[str, str],
    target_date: date,
    data_source: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Map Metabase rows → upsert payloads. Returns (rows, unmatched_names)."""
    rows: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for r in metabase_rows:
        name = r.get(name_col)
        pct = r.get(pct_col)
        if not name or pct is None:
            continue
        provider_id = name_to_id.get(_normalize(str(name)))
        if not provider_id:
            unmatched.append(str(name))
            continue
        try:
            pct_value = float(pct)
        except (TypeError, ValueError):
            unmatched.append(f"{name} (non-numeric pct={pct!r})")
            continue
        # Metabase sometimes returns 0–1 fractions, sometimes 0–100. Normalize to %.
        if pct_value <= 1.0:
            pct_value *= 100
        rows.append(
            {
                "provider_id": provider_id,
                "date": target_date.isoformat(),
                "utilization_pct": round(pct_value, 2),
                "data_source": data_source,
            }
        )
    return rows, unmatched


def _try_card(
    card_id: str,
    name_col: str,
    pct_col: str,
    name_to_id: dict[str, str],
    target_date: date,
    data_source: str,
) -> list[dict[str, Any]]:
    log.info("Fetching Metabase card %s (%s)...", card_id, data_source)
    mb_rows = query_card(int(card_id))
    rows, unmatched = _build_rows(mb_rows, name_col, pct_col, name_to_id, target_date, data_source)
    log.info("  matched=%d unmatched=%d", len(rows), len(unmatched))
    if unmatched:
        sample = unmatched[:10]
        log.warning(
            "Unmatched names (first %d of %d): %s — fix names in Supabase or Metabase to match.",
            len(sample),
            len(unmatched),
            sample,
        )
    return rows


def main() -> int:
    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    daily_card = os.environ.get("METABASE_DAILY_UTIL_CARD_ID", "").strip()
    fallback_card = os.environ.get("METABASE_5WK_UTIL_CARD_ID", "").strip()
    name_col = os.environ.get("UTIL_NAME_COLUMN", "Provider")
    pct_col = os.environ.get("UTIL_PCT_COLUMN", "Utilization Rate")

    if not daily_card and not fallback_card:
        log.error(
            "At least one of METABASE_DAILY_UTIL_CARD_ID or METABASE_5WK_UTIL_CARD_ID "
            "must be set."
        )
        return 1

    today = _get_today()
    name_to_id = _fetch_supabase_providers(base_url, key)
    log.info("Loaded %d active providers from Supabase.", len(name_to_id))
    if not name_to_id:
        log.error("No providers in Supabase yet. Run supabase/seed/seed_providers.py first.")
        return 1

    rows: list[dict[str, Any]] = []
    chosen_source = None

    if daily_card:
        try:
            rows = _try_card(daily_card, name_col, pct_col, name_to_id, today, "daily")
            if rows:
                chosen_source = "daily"
        except Exception as exc:  # noqa: BLE001 — fall back rather than abort
            log.warning("Daily utilization fetch failed: %s", exc)

    if not rows and fallback_card:
        try:
            rows = _try_card(fallback_card, name_col, pct_col, name_to_id, today, "five_week_avg")
            chosen_source = "five_week_avg"
        except Exception:
            log.exception("5-week utilization fetch failed.")
            return 1

    if not rows:
        log.warning("No utilization rows to upsert. Skipping.")
        return 0

    log.info(
        "Upserting %d rows (source=%s) for %s...",
        len(rows),
        chosen_source,
        today.isoformat(),
    )
    _upsert(base_url, key, rows)
    log.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
