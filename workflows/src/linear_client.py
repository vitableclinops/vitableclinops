"""Creates Linear triage issues in the Clinical team for each action item."""

import logging
import os

import requests

LINEAR_API_URL = "https://api.linear.app/graphql"

# Hard-coded from workspace introspection — update if team/state IDs change.
CLINICAL_TEAM_ID = "f4b3421c-f5f1-45d2-af4c-15b95c4ccb08"
TRIAGE_STATE_ID = "269ec2b9-9b2a-419b-948f-bf7f2d4e5ae3"

log = logging.getLogger(__name__)

# First-name / display-name → Linear user ID (from workspace introspection).
# Add new team members here as they join Linear.
_NAME_TO_USER_ID: dict[str, str] = {
    "kate": "896cc402-0668-450f-97a5-a20dfd082d44",
    "kate stewart": "896cc402-0668-450f-97a5-a20dfd082d44",
    "maddi": "021c8dfb-ac55-4ec7-8472-910709d94c4f",
    "maddi swanagan": "021c8dfb-ac55-4ec7-8472-910709d94c4f",
    "tasneem": "846380a4-af38-4111-bde4-e5781ef8d243",
    "sarabjeet": "724d9b58-a256-43c1-84d6-a8bf9155b63a",
    "emily z": "4ed4a0fe-7b47-460d-8097-f2434f448c4b",
    "emily": "4ed4a0fe-7b47-460d-8097-f2434f448c4b",
    "lindsay": "cf5d523a-178b-4d21-91d7-b04ac8ce1058",
    "lindsay mas": "cf5d523a-178b-4d21-91d7-b04ac8ce1058",
    "adrienne": "8460db6b-57d6-4c4e-bde7-ea387b239dba",
    "adrienne doyle": "8460db6b-57d6-4c4e-bde7-ea387b239dba",
    "genevieve": "ecaf9363-98cc-4025-9202-21b199c98f73",
    "genevieve teetie": "ecaf9363-98cc-4025-9202-21b199c98f73",
    "rita": "5786c9d0-386b-4c13-8caa-e0e904a2787b",
    "bridgette": "3312e139-3d25-41a5-91df-8e96c3a4ae31",
    "bridgette tuquero": "3312e139-3d25-41a5-91df-8e96c3a4ae31",
    "dan": "d2a0a8f1-0ddb-425f-a4e2-120ea4f0cca9",
    "dan patterson": "d2a0a8f1-0ddb-425f-a4e2-120ea4f0cca9",
}


def _gql(query: str, variables: dict) -> dict:
    headers = {
        "Authorization": os.environ["LINEAR_API_KEY"],
        "Content-Type": "application/json",
    }
    resp = requests.post(
        LINEAR_API_URL,
        json={"query": query, "variables": variables},
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"Linear GraphQL error: {data['errors']}")
    return data["data"]


_CREATE_ISSUE = """
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id title url }
  }
}
"""


def create_triage_issues(meeting: dict, synthesis: dict) -> dict:
    """
    Create one triage issue per action item in the Clinical team.
    Returns {"created": int, "failed": int, "urls": [str], "errors": [str]}.
    """
    team_id = os.environ.get("LINEAR_CLINOPS_TEAM_ID", CLINICAL_TEAM_ID)
    state_id = TRIAGE_STATE_ID

    created, failed = 0, 0
    urls, errors = [], []

    for person, items in synthesis["action_items"].items():
        assignee_id = _resolve_user(person)
        if person not in ("Team", "Unassigned") and not assignee_id:
            log.warning("No Linear user found for %r — issue will be unassigned", person)

        for item in items:
            issue_input: dict = {
                "teamId": team_id,
                "stateId": state_id,
                "title": item,
                "description": (
                    f"**Source:** {meeting['title']} ({meeting['date']})\n"
                    f"**Owner:** {person}"
                ),
            }
            if assignee_id:
                issue_input["assigneeId"] = assignee_id

            try:
                result = _gql(_CREATE_ISSUE, {"input": issue_input})
                if result["issueCreate"]["success"]:
                    url = result["issueCreate"]["issue"]["url"]
                    urls.append(url)
                    created += 1
                    log.info("Created: %s", url)
                else:
                    failed += 1
                    errors.append(f"Linear rejected issue: {item!r}")
            except Exception as exc:
                failed += 1
                msg = f"Error creating {item!r}: {exc}"
                errors.append(msg)
                log.error(msg)

    return {"created": created, "failed": failed, "urls": urls, "errors": errors}


def _resolve_user(name: str) -> str | None:
    return _NAME_TO_USER_ID.get(name.lower())
