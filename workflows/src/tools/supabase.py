"""Supabase REST client — calls the get_activation_candidates Postgres function."""

from __future__ import annotations

import os
from typing import Any

import requests


def get_activation_candidates(
    deficit_states: list[str],
    util_threshold: float = 70,
    candidate_limit: int = 5,
    shift_type_filter: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Call the get_activation_candidates RPC.

    Returns a flat list of candidates (one row per state × candidate),
    pre-ranked by the function. Filters default to NP/MD telemedicine.
    """
    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    payload: dict[str, Any] = {
        "deficit_states": deficit_states,
        "util_threshold": util_threshold,
        "candidate_limit": candidate_limit,
    }
    if shift_type_filter is not None:
        payload["shift_type_filter"] = shift_type_filter

    resp = requests.post(
        f"{base_url}/rest/v1/rpc/get_activation_candidates",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()
