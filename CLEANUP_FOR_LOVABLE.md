# Vitable Ops Hub — Cleanup Tasks for Lovable

Based on a data-flow audit performed 2026-04-20. Each task is scoped, actionable, and includes the exact files/tables to touch. Group tasks by priority (P0 → P2).

---

## P0 — Data Integrity (Do First)

### 1. Remove or wire up 3 orphaned tables

These tables exist in migrations but have **zero readers** anywhere in the codebase:

- `compliance_status_log`
- `agreement_summary`
- `transfer_task_templates`

**Task:** For each table:
1. Search the full codebase (src/ and supabase/functions/) for any reference.
2. If truly unused, write a new migration that drops it: `supabase/migrations/YYYYMMDDHHMMSS_drop_orphaned_tables.sql`.
3. If intentional-but-not-yet-wired, add a `-- TODO: wire into <page>` comment on the CREATE TABLE statement in the original migration and document the intended use in a new `docs/data-model.md`.

**Acceptance:** Running `grep -r "compliance_status_log\|agreement_summary\|transfer_task_templates" src/ supabase/` returns zero hits, OR each has a documented purpose.

---

### 2. Add data-freshness indicators to OpsDashboard and StateDetail

**Problem:** If `sync-metabase` or `sync-homebase` fails silently, both pages show stale data with no warning. `UtilizationPage` already does this correctly — replicate that pattern.

**Files to edit:**
- `src/pages/OpsDashboardPage.tsx`
- `src/pages/StateDetailPage.tsx`

**Task:**
1. Query `MAX(synced_at)` (or equivalent updated_at) from `state_sla_attainment` and `state_leftover_slots` on page load.
2. Display a small footer: `Last synced: {relative time} from {source}` (e.g., "Last synced 3 hours ago from metabase_sync").
3. If `MAX(synced_at) > 24 hours ago`, show a yellow banner: "⚠️ Data may be stale — last sync was {time}".
4. Reference: `src/pages/UtilizationPage.tsx` already implements this pattern.

**Prerequisite:** `state_leftover_slots` and `state_sla_attainment` need `synced_at` columns. Migration `20260420000000` added these to `provider_utilization` and `utilization_daily`; extend the pattern.

**Acceptance:** Both pages show freshness indicator; stale-data banner appears when data is >24h old.

---

### 3. Resolve the ProviderDirectoryPage TODO

**File:** `src/pages/ProviderDirectoryPage.tsx`
**Search for:** `TODO: derive from provider_state_status`

**Task:**
1. Read the surrounding code to understand what state is currently derived (or hardcoded).
2. Write a query that reads from `provider_state_status` and computes the correct value.
3. Replace the TODO with the query.
4. Also: the page currently reads BOTH `profiles` and `provider_directory_public` (a view of profiles). Determine if both are needed or if reading only `provider_directory_public` is sufficient; simplify to one.

**Acceptance:** No `TODO` comments remain in `ProviderDirectoryPage.tsx`; the page reads from a single, clear source of truth.

---

## P1 — Architectural Clarity (Next Sprint)

### 4. Separate mock data from production fallbacks

**Problem:** 13 files import from `mockData` — unclear which are legitimate static reference data (e.g., full US states list) vs. hardcoded domain data (e.g., provider names) that should come from the DB.

**Files affected (run `grep -rl "mockData" src/` to confirm):**
- `src/pages/Index.tsx`
- `src/pages/StateCompliancePage.tsx`
- `src/components/TaskDetailView.tsx`
- ~10 others

**Task:**
1. Split `src/data/mockData.ts` into two files:
   - `src/data/staticReferenceData.ts` — things that are genuinely static (US states, specialties, licensure types)
   - `src/data/DEPRECATED_mockData.ts` — domain data that should be DB-sourced
2. For each file importing from the old `mockData`:
   - If using static reference → update import to `staticReferenceData`.
   - If using domain mock data → replace with a Supabase query.
3. Once `DEPRECATED_mockData.ts` has zero imports, delete it.

**Acceptance:** `grep -r "mockData" src/` returns zero hits in page/component files; only static reference data is allowed.

---

### 5. Add failure alerting for nightly syncs

**Problem:** If `sync-metabase` (daily) or `sync-homebase` (hourly) fails, nobody knows until they notice stale data.

**Task:**
1. Add a Slack webhook URL as a Supabase secret: `SLACK_OPS_ALERTS_WEBHOOK`.
2. In `supabase/functions/sync-metabase/index.ts` and `supabase/functions/sync-homebase/index.ts`:
   - Wrap the main body in try/catch.
   - On error, POST to the Slack webhook with: function name, error message, timestamp.
3. Also alert if a sync completes but processes zero rows unexpectedly (likely upstream source issue).

**Acceptance:** Intentionally breaking the Homebase API key triggers a Slack alert in #ops-alerts.

---

### 6. Homebase name-match escalation

**Problem:** `sync-homebase` uses fuzzy matching (threshold 0.85) to link Homebase employees → Supabase profiles. Low-confidence matches are surfaced in `DataQualityPage` but never escalated.

**Task:**
1. In `sync-homebase`, after each run, count:
   - Total employees
   - Unmatched count
   - Low-confidence (< 0.9) count
2. If `unmatched_count / total > 0.10` (10%), send a Slack alert (reuse webhook from task #5).
3. On `DataQualityPage`, add a "Resolve" action button per low-confidence match that opens the manual override UI (writing to `provider_name_mappings`).

**Acceptance:** When >10% of Homebase employees are unmatched, ops gets notified; low-confidence matches can be resolved in one click.

---

## P2 — Optimization (Backlog)

### 7. Deprecate the historical-CSV path for `state_leftover_slots`

**Context:** Currently `state_leftover_slots` has both:
- `window_type='historical'` — from manual Metabase CSV upload (`import-leftover-slots`)
- `window_type='forecast'` — from `compute-availability-slots` using Homebase shifts

Now that `compute-availability-slots` has been running stably since April 15, the historical CSV path may be obsolete.

**Task:**
1. Check the last 30 days of `state_leftover_slots` rows: are any `window_type='historical'` rows being written? If not, this path is already dead.
2. If still being used, document the gap (what does historical CSV provide that forecast doesn't?).
3. If not used:
   - Remove the upload UI from `SystemSettingsPage` and `LicenseOptimizerPage`.
   - Delete the `import-leftover-slots` edge function.
   - Update `compute-license-utilization` to only read `window_type='forecast'`.

**Acceptance:** Either the historical path is removed entirely, OR the migration document explains why both sources are needed.

---

### 8. Verify cost-analysis pipeline is actually used

**Tables:** `provider_cost_rates`, `visit_cost_snapshots`
**Edge function:** `compute-visit-cost`
**Reader page:** `ExecutiveBriefingPage`

**Task:**
1. Open `src/pages/ExecutiveBriefingPage.tsx` and confirm it actively queries and renders data from `visit_cost_snapshots`.
2. If yes: no action needed.
3. If no (cost data is computed but never displayed):
   - Remove the scheduled `compute-visit-cost` cron job.
   - Drop `visit_cost_snapshots` and `provider_cost_rates` in a new migration, OR document intended future use.

**Acceptance:** Every compute function has at least one reader page actively displaying its output.

---

### 9. Add algorithmic fallback for `demand_forecast`

**Problem:** `demand_forecast` is entirely external (Metabase-only). If the Metabase report is broken or the sync fails, `OpsDashboard`, `DemandForecast`, and `DemandMatching` pages show no data.

**Task:**
1. Create a new edge function `compute-demand-fallback`:
   - Reads the last 8 weeks of actual visit data (from `state_leftover_slots` historical + `homebase_shifts` as proxy).
   - Computes a rolling-average projection per state per week.
   - Writes to `demand_forecast` with a new column `source='computed_fallback'` (add column in migration).
2. Only write fallback rows for (state, week) combinations that don't already have a Metabase-sourced row (respect source precedence).
3. Schedule nightly after `sync-metabase`.

**Acceptance:** If `sync-metabase` fails for a week, `OpsDashboard` still shows demand projections with a "computed fallback" label.

---

## Summary checklist

```
[ ] P0.1 — Remove/document 3 orphaned tables
[ ] P0.2 — Add freshness indicators to OpsDashboard + StateDetail
[ ] P0.3 — Resolve ProviderDirectoryPage TODO
[ ] P1.4 — Split mockData into static vs. deprecated
[ ] P1.5 — Slack alerts on sync-metabase / sync-homebase failures
[ ] P1.6 — Homebase match escalation (>10% unmatched → Slack)
[ ] P2.7 — Deprecate historical-CSV path for state_leftover_slots
[ ] P2.8 — Verify ExecutiveBriefingPage uses cost data; remove if not
[ ] P2.9 — Add algorithmic fallback for demand_forecast
```

---

## Notes for Lovable

- The project lives at `/Users/maddiswanagan/Desktop/Scheduling/vitableclinops-main` (not the `Scheduling` folder).
- Always write new migrations in `supabase/migrations/` — never edit existing migrations.
- Edge functions live in `supabase/functions/<function-name>/index.ts`.
- The nightly pipeline order is sacred: `sync-homebase` (01:00) → `compute-availability-slots` (02:00) → `compute-license-utilization` (03:00). Don't reorder without understanding the dependency chain.
- `license_optimization_snapshots` feeds 7 pages — any schema change to it requires touching all 7 readers.
- Never overwrite `window_type='historical'` rows in `state_leftover_slots` with forecast data (and vice versa) — the separation is intentional.
