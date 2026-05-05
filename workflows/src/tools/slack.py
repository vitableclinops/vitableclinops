"""Slack Web API client for the daily availability report — posts to one channel."""

from __future__ import annotations

import os

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError


def post_message(message: str, thread_ts: str | None = None) -> str:
    """Post a message to SLACK_CHANNEL_ID. Returns the message ts.

    If DRY_RUN is set, prints the message and returns a fake ts so the
    agent loop can still thread its follow-up replies.
    """
    channel_id = os.environ["SLACK_CHANNEL_ID"]

    if os.environ.get("DRY_RUN", "").lower() in {"1", "true", "yes"}:
        prefix = f"[thread:{thread_ts}]" if thread_ts else "[parent]"
        print(f"--- DRY_RUN slack {prefix} to {channel_id} ---\n{message}\n---")
        return thread_ts or "1234567890.000000"

    client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
    try:
        resp = client.chat_postMessage(
            channel=channel_id,
            text=message,
            mrkdwn=True,
            thread_ts=thread_ts,
        )
    except SlackApiError as exc:
        raise RuntimeError(f"Slack post failed: {exc.response['error']}") from exc

    return resp["ts"]
