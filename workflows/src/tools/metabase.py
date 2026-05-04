"""Metabase REST client — runs a saved card and returns rows as a list of dicts."""

from __future__ import annotations

import os
from typing import Any

import requests


def query_card(card_id: int, parameters: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Execute a Metabase card and return its rows as dicts.

    Requires METABASE_URL (e.g. https://metabase.vitablehealth.com) and
    METABASE_API_KEY. The API key is sent as the X-API-Key header — generate
    one in Metabase Admin → Settings → API Keys.
    """
    base_url = os.environ["METABASE_URL"].rstrip("/")
    api_key = os.environ["METABASE_API_KEY"]

    payload: dict[str, Any] = {}
    if parameters:
        payload["parameters"] = parameters

    resp = requests.post(
        f"{base_url}/api/card/{card_id}/query/json",
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()

    data = resp.json()
    # The /query/json endpoint returns a list of row-dicts directly. Some
    # Metabase versions wrap it under {"data": {"rows": [...], "cols": [...]}}.
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "data" in data:
        cols = [c["name"] for c in data["data"].get("cols", [])]
        return [dict(zip(cols, row)) for row in data["data"].get("rows", [])]
    raise RuntimeError(f"Unexpected Metabase response shape for card {card_id}: {type(data).__name__}")
