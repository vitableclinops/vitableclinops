"""Jotform REST API client — fetches Monthly Availability form submissions."""

import json
import logging
import os

import requests

JOTFORM_API_BASE = "https://api.jotform.com"
AVAILABILITY_FORM_ID = "252224341308043"

log = logging.getLogger(__name__)


def get_new_submissions(since_id: str | None = None) -> list[dict]:
    """
    Fetch submissions from the Monthly Availability form.

    If since_id is provided, returns only submissions with ID > since_id,
    ordered oldest-first so we process in chronological order.
    Handles Jotform's pagination automatically.
    """
    api_key = os.environ["JOTFORM_API_KEY"]
    params: dict = {
        "apiKey": api_key,
        "limit": 100,
        "orderby": "id",
        "direction": "ASC",
    }
    if since_id:
        params["filter"] = json.dumps({"id:gt": since_id})

    submissions = []
    offset = 0

    while True:
        params["offset"] = offset
        resp = requests.get(
            f"{JOTFORM_API_BASE}/form/{AVAILABILITY_FORM_ID}/submissions",
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("responseCode") != 200:
            raise RuntimeError(f"Jotform API error: {data.get('message')}")

        page = data.get("content", [])
        if not page:
            break

        submissions.extend(_normalize(raw) for raw in page)

        result_set = data.get("resultSet", {})
        count = int(result_set.get("count", 0))
        offset += count
        total = int(result_set.get("limit", 0))  # Jotform uses "limit" as total count
        if count < 100 or offset >= total:
            break

    return submissions


def _normalize(raw: dict) -> dict:
    """Normalize a raw Jotform submission into a clean dict."""
    answers: dict[str, str] = {}
    for _qid, entry in raw.get("answers", {}).items():
        label = entry.get("text", "").strip()
        if not label:
            continue
        answer = entry.get("answer", "")
        if isinstance(answer, dict):
            if "first" in answer or "last" in answer:
                parts = [answer.get("first", ""), answer.get("last", "")]
                answer = " ".join(p for p in parts if p).strip()
            else:
                # Matrix / structured answer — serialize to readable key: value pairs
                parts = [f"{k}: {v}" for k, v in answer.items() if v and str(v).strip()]
                answer = "; ".join(parts)
        elif isinstance(answer, list):
            answer = ", ".join(str(a) for a in answer if a)

        answers[label] = str(answer).strip() if answer else ""

    return {
        "submission_id": raw.get("id", ""),
        "created_at": raw.get("created_at", ""),
        "answers": answers,
    }
