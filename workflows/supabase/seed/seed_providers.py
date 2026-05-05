"""Idempotent seed script for the providers + provider_licenses tables.

Reads two CSVs and upserts rows via the Supabase REST API. Safe to re-run.

Usage:
    export SUPABASE_URL=https://bbquooftytwprllipcsb.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python supabase/seed/seed_providers.py \\
        --providers supabase/seed/providers.csv \\
        --licenses  supabase/seed/licenses.csv

The CSV columns must match the headers in providers.csv.example /
licenses.csv.example. shift_types is pipe-separated ("NP Telemedicine|Primary Care").
Booleans accept true/false, 1/0, yes/no.

Conflicts: providers upsert on email; licenses upsert on (provider_id, state).
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
from typing import Any

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def truthy(v: str) -> bool:
    return str(v).strip().lower() in {"1", "true", "yes", "y", "t"}


def split_array(v: str) -> list[str]:
    return [s.strip() for s in v.split("|") if s.strip()]


def supabase_request(
    method: str, url: str, key: str, **kwargs: Any
) -> requests.Response:
    headers = kwargs.pop("headers", {})
    headers.update(
        {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        }
    )
    resp = requests.request(method, url, headers=headers, timeout=30, **kwargs)
    if not resp.ok:
        log.error("Supabase %s %s -> HTTP %s\n%s", method, url, resp.status_code, resp.text)
        resp.raise_for_status()
    return resp


def upsert_providers(base_url: str, key: str, rows: list[dict[str, Any]]) -> dict[str, str]:
    """Upsert providers; return {email: id} for license linking."""
    if not rows:
        return {}
    url = f"{base_url}/rest/v1/providers?on_conflict=email"
    resp = supabase_request("POST", url, key, data=json.dumps(rows))
    returned = resp.json()
    log.info("Upserted %d providers.", len(returned))
    return {r["email"]: r["id"] for r in returned if r.get("email")}


def upsert_licenses(
    base_url: str, key: str, rows: list[dict[str, Any]], email_to_id: dict[str, str]
) -> None:
    if not rows:
        return
    resolved: list[dict[str, Any]] = []
    for r in rows:
        email = r.pop("provider_email", None)
        pid = email_to_id.get(email or "")
        if not pid:
            log.warning("Skipping license — no provider with email %r", email)
            continue
        r["provider_id"] = pid
        resolved.append(r)
    if not resolved:
        return
    url = f"{base_url}/rest/v1/provider_licenses?on_conflict=provider_id,state"
    supabase_request("POST", url, key, data=json.dumps(resolved))
    log.info("Upserted %d licenses.", len(resolved))


def load_providers_csv(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            rows.append(
                {
                    "name": raw["name"].strip(),
                    "email": raw["email"].strip().lower() or None,
                    "npi": (raw.get("npi") or "").strip() or None,
                    "athena_provider_id": (raw.get("athena_provider_id") or "").strip() or None,
                    "homebase_employee_id": (raw.get("homebase_employee_id") or "").strip() or None,
                    "ehr_activation_status": (raw.get("ehr_activation_status") or "inactive").strip(),
                    "readiness_status": (raw.get("readiness_status") or "training").strip(),
                    "shift_types": split_array(raw.get("shift_types") or ""),
                    "is_telemedicine": truthy(raw.get("is_telemedicine") or ""),
                    "is_in_home": truthy(raw.get("is_in_home") or ""),
                    "active": truthy(raw.get("active") or "true"),
                }
            )
    return rows


def load_licenses_csv(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            rows.append(
                {
                    "provider_email": raw["provider_email"].strip().lower(),
                    "state": raw["state"].strip().upper(),
                    "license_number": (raw.get("license_number") or "").strip() or None,
                    "expiration_date": (raw.get("expiration_date") or "").strip() or None,
                    "status": (raw.get("status") or "active").strip(),
                }
            )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--providers", required=True, help="Path to providers CSV.")
    parser.add_argument("--licenses", help="Path to licenses CSV (optional).")
    args = parser.parse_args()

    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not key:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        return 1

    providers = load_providers_csv(args.providers)
    log.info("Loaded %d providers from %s", len(providers), args.providers)
    email_to_id = upsert_providers(base_url, key, providers)

    if args.licenses:
        licenses = load_licenses_csv(args.licenses)
        log.info("Loaded %d licenses from %s", len(licenses), args.licenses)
        upsert_licenses(base_url, key, licenses, email_to_id)

    log.info("Seed complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
