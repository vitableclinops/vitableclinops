"""Granola REST API client — fetches ClinOps Weekly Sync notes."""

import os
from datetime import date as date_type

import requests

GRANOLA_API_BASE = "https://api.granola.so/v1"


def get_todays_clinops_sync(target_date: str | None = None) -> dict:
    """
    Return the most recent ClinOps Weekly Sync from Granola for target_date.

    Returns a dict with keys: id, title, date, summary, participants.
    Raises ValueError if no matching meeting is found.
    """
    token = os.environ["GRANOLA_API_TOKEN"]
    today = target_date or date_type.today().isoformat()
    meeting_title = os.environ.get("GRANOLA_MEETING_TITLE", "ClinOps Weekly Sync")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    resp = requests.get(
        f"{GRANOLA_API_BASE}/documents",
        headers=headers,
        params={"date": today},
        timeout=30,
    )
    resp.raise_for_status()

    documents = resp.json().get("documents", [])

    matches = [
        doc for doc in documents
        if meeting_title.lower() in doc.get("title", "").lower()
    ]

    if not matches:
        titles = [d.get("title", "") for d in documents]
        raise ValueError(
            f"No '{meeting_title}' found in Granola for {today}. "
            f"Available meetings: {titles}"
        )

    doc = matches[-1]
    return {
        "id": doc["id"],
        "title": doc.get("title", meeting_title),
        "date": today,
        "summary": doc.get("summary") or doc.get("notes") or doc.get("content") or "",
        "participants": _parse_participants(doc.get("participants", [])),
    }


def _parse_participants(raw: list) -> list[str]:
    names = []
    for p in raw:
        if isinstance(p, dict):
            name = p.get("name") or p.get("email", "")
        else:
            name = str(p)
        if name:
            names.append(name)
    return names
