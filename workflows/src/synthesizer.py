"""
Parses Granola's AI-generated meeting summary into a structured dict.

Granola already produces a '### Next Steps' section formatted as:
  - Person: Action item text
  - Person: Another action item

No external AI calls needed.
"""

import re

_NEXT_STEPS_RE = re.compile(
    r"###\s+Next\s+Steps\s*\n(.*?)(?=\n###|\Z)",
    re.DOTALL | re.IGNORECASE,
)


def extract_action_items(meeting: dict) -> dict:
    """
    Parse meeting['summary'] into {"summary": str, "action_items": {name: [str]}}.

    'summary' is the full Granola summary minus the Next Steps block.
    'action_items' maps each person's name to their list of action items.
    """
    raw = meeting.get("summary", "")
    match = _NEXT_STEPS_RE.search(raw)

    action_items: dict[str, list[str]] = {}
    if match:
        for line in match.group(1).splitlines():
            line = line.strip().lstrip("-").strip()
            if ":" not in line:
                continue
            person, _, action = line.partition(":")
            person, action = person.strip(), action.strip()
            if person and action:
                action_items.setdefault(person, []).append(action)

    # Summary text = everything before the Next Steps section
    summary_text = _NEXT_STEPS_RE.sub("", raw).strip()
    summary_text = re.sub(r"\n{3,}", "\n\n", summary_text)

    return {"summary": summary_text, "action_items": action_items}
