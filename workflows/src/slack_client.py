"""Posts the meeting summary and per-person action items to Slack."""

import os

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

CHANNEL = "clinops-meeting-prep-and-process-improvement"


def post_meeting_summary(meeting: dict, synthesis: dict) -> None:
    client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
    message = _format_message(meeting, synthesis)
    try:
        client.chat_postMessage(channel=f"#{CHANNEL}", text=message, mrkdwn=True)
    except SlackApiError as exc:
        raise RuntimeError(f"Slack post failed: {exc.response['error']}") from exc


def _format_message(meeting: dict, synthesis: dict) -> str:
    lines = [
        f"*ClinOps Weekly Sync — {meeting['date']}*",
        "",
        synthesis["summary"],
        "",
        "*Action Items by Person*",
    ]

    for person, items in synthesis["action_items"].items():
        if not items:
            continue
        lines.append(f"\n*{person}*")
        for item in items:
            lines.append(f"• {item}")

    return "\n".join(lines)
