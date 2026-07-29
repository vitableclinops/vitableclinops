"""Metabase REST client - runs a saved card and returns rows as a list of dicts."""

from __future__ import annotations

import os
from typing import Any

import requests

_SESSION_TOKEN: str | None = None


def query_card(card_id: int, parameters: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Execute a Metabase card and return its rows as dicts.

    Requires METABASE_URL (e.g. https://metabase.vitablehealth.com) and
    METABASE_USERNAME / METABASE_PASSWORD. The username/password pair is
    exchanged for a Metabase session token before querying cards.
    """
    base_url = _metabase_url()
    token = _metabase_session_token()

    payload: dict[str, Any] = {}
    if parameters:
        payload["parameters"] = parameters

    resp = requests.post(
        f"{base_url}/api/card/{card_id}/query/json",
        headers={"X-Metabase-Session": token, "Content-Type": "application/json"},
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


def _metabase_url() -> str:
    return os.environ.get("METABASE_URL", "https://metabase.vitablehealth.com").rstrip("/")


def _metabase_session_token() -> str:
    global _SESSION_TOKEN
    if _SESSION_TOKEN:
        return _SESSION_TOKEN

    username = os.environ["METABASE_USERNAME"]
    password = os.environ["METABASE_PASSWORD"]
    resp = requests.post(
        f"{_metabase_url()}/api/session",
        headers={"Content-Type": "application/json"},
        json={"username": username, "password": password},
        timeout=60,
    )
    resp.raise_for_status()

    token = resp.json().get("id")
    if not token:
        raise RuntimeError("Metabase auth failed: missing session id")

    _SESSION_TOKEN = str(token)
    return _SESSION_TOKEN
