"""Tool definitions + dispatch for the daily availability report agent.

The TOOLS list is sent to Claude as the JSON schema of available tools.
Order is stable so it caches cleanly. Each tool dispatches to a thin REST
client in this package.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import homebase, metabase, slack, supabase

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "name": "metabase_query",
        "description": (
            "Run a Metabase saved question (card) and return its rows. "
            "Used for: card_id=2431 (available slots by state, today + tomorrow), "
            "card_id=3011 (completed visits by state — monthly demand baseline), "
            "card_id=2931 (SLA attainment % by state, MTD)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "integer",
                    "description": "Metabase card (saved question) ID.",
                },
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "get_activation_candidates",
        "description": (
            "Return ranked activation candidates for the given deficit states. "
            "Each candidate is a provider licensed in that state but not yet "
            "EHR-active, with low utilization and a matching shift type. "
            "Defaults filter to NP/MD Telemedicine."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deficit_states": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Two-letter US state codes flagged as Critical or Low.",
                },
                "util_threshold": {
                    "type": "number",
                    "description": "Max utilization % to consider (default 70).",
                    "default": 70,
                },
                "candidate_limit": {
                    "type": "integer",
                    "description": "Max candidates returned per state (default 5).",
                    "default": 5,
                },
            },
            "required": ["deficit_states"],
        },
    },
    {
        "name": "get_homebase_shifts",
        "description": (
            "Return scheduled shifts from Homebase for the given date range "
            "(inclusive). Use to distinguish 'no labor scheduled' from "
            "'labor scheduled but slots not opened'. Each shift includes "
            "location_id, employee, role, start_at, end_at."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {
                    "type": "string",
                    "description": "YYYY-MM-DD (inclusive).",
                },
                "end_date": {
                    "type": "string",
                    "description": "YYYY-MM-DD (inclusive).",
                },
            },
            "required": ["start_date", "end_date"],
        },
    },
    {
        "name": "post_to_slack",
        "description": (
            "Post a message to the #appointment-availability-update channel. "
            "Returns the message ts as a string. Pass the parent ts in "
            "thread_ts to reply in-thread."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Slack mrkdwn message body.",
                },
                "thread_ts": {
                    "type": "string",
                    "description": (
                        "Parent message ts to thread under. Omit or null for a "
                        "top-level post."
                    ),
                },
            },
            "required": ["message"],
        },
    },
]


def execute(name: str, tool_input: dict[str, Any]) -> str:
    """Dispatch a tool call. Returns a JSON string for tool_result content."""
    log.info("Tool call: %s(%s)", name, _redact(tool_input))
    if name == "metabase_query":
        rows = metabase.query_card(tool_input["card_id"])
        return json.dumps({"row_count": len(rows), "rows": rows}, default=str)

    if name == "get_activation_candidates":
        result = supabase.get_activation_candidates(
            deficit_states=tool_input["deficit_states"],
            util_threshold=tool_input.get("util_threshold", 70),
            candidate_limit=tool_input.get("candidate_limit", 5),
        )
        return json.dumps({"candidates": result}, default=str)

    if name == "get_homebase_shifts":
        shifts = homebase.get_shifts(tool_input["start_date"], tool_input["end_date"])
        return json.dumps({"shift_count": len(shifts), "shifts": shifts}, default=str)

    if name == "post_to_slack":
        ts = slack.post_message(
            message=tool_input["message"],
            thread_ts=tool_input.get("thread_ts"),
        )
        return json.dumps({"ts": ts})

    raise ValueError(f"Unknown tool: {name}")


def _redact(d: dict[str, Any]) -> dict[str, Any]:
    """Trim long message fields in log output."""
    if "message" in d and isinstance(d["message"], str) and len(d["message"]) > 120:
        return {**d, "message": d["message"][:120] + "…"}
    return d
