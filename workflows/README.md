# ClinOps Workflows

Automated jobs that read from Metabase / Homebase / Jotform / Granola, write to Supabase / Notion / Slack / Linear, and surface decisions in line with [`SCHEDULING_DECISION_CONTRACT.md`](../SCHEDULING_DECISION_CONTRACT.md).

This directory is **independent of the Lovable frontend**. Lovable only builds `src/` at the repo root; nothing here ships to the web app.

## Layout

```
workflows/
├── src/
│   ├── workflow.py                  Weekly meeting-notes synthesizer (entry point)
│   ├── synthesizer.py               Granola transcript → Slack/Linear distillation
│   ├── slack_client.py              Shared Slack helpers
│   ├── linear_client.py             Shared Linear helpers
│   ├── granola_client.py            Granola transcript fetch
│   │
│   ├── availability_workflow.py     Jotform → Notion availability sync (entry point)
│   ├── availability_parser.py       Parses submission answers into shifts
│   ├── jotform_client.py
│   ├── notion_availability_client.py
│   │
│   ├── daily_availability_report.py     Daily Slack report (entry point)
│   ├── sync_provider_utilization.py     Nightly Metabase → Supabase rollup (entry point)
│   ├── prompts/
│   │   └── daily_availability_prompt.py
│   └── tools/                       Tool-use surface for the daily report's Claude agent
│       ├── homebase.py
│       ├── metabase.py
│       ├── supabase.py
│       └── slack.py
│
├── scripts/                         Local cron / launchd / systemd templates
├── state/                           Runtime state committed back by GitHub Actions
│   └── availability-state.json      Last-processed Jotform submission ID
├── supabase/                        Workflow-side schema (project: bbquooftytwprllipcsb)
│   ├── migrations/
│   ├── seed/
│   └── README.md
├── requirements.txt
└── .env.example
```

## Workflows

| Job | Schedule | Entry point | Triggered by |
|---|---|---|---|
| ClinOps weekly sync | Tue 12:15 PM CT | `src/workflow.py` | `.github/workflows/clinops-weekly-sync.yml` |
| Availability sync (Jotform → Notion) | every 30 min | `src/availability_workflow.py` | `.github/workflows/availability-sync.yml` |
| Daily availability report | weekdays 8:00 AM CT | `src/daily_availability_report.py` | `.github/workflows/daily-availability-report.yml` |
| Sync provider utilization | daily 4:00 AM CT | `src/sync_provider_utilization.py` | `.github/workflows/sync-provider-utilization.yml` |

## Running locally

```bash
cd workflows
cp .env.example .env       # fill in real values
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python src/daily_availability_report.py    # or any other entry point
```

The daily report reads `DRY_RUN=1` to print to stdout instead of posting to Slack.

## Supabase

This directory's `supabase/migrations/` targets the **workflow Supabase project** (`bbquooftytwprllipcsb` — "Provider Ops Hub"). The repo-root `supabase/migrations/` targets the **Lovable Supabase project** (`saksjvmqyudkowxypoce`). These are two different databases by design until consolidation completes.

New scheduling-related tables (per the contract) belong here.
