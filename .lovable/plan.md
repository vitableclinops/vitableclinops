
# June Scheduling MVP — `/scheduling/june-mvp`

A self-contained, upload-driven page that lets you finalize and publish the June schedule today. No new edge functions, no DB ingest of the uploaded data. Only the existing `publish_status` table is reused for cross-view tracking.

## Goal

Within ~1 hour of build time, give VAs a single page where they can:
1. Drop in 5 files.
2. See a recommended schedule (accepted vs declined) computed in-browser.
3. Toggle Homebase / EHR "posted" state per provider — reflected on every view.

## Page layout

Route: `/scheduling/june-mvp` (sibling of existing workbench, also linked in the Scheduling sidebar). Restricted to `admin` and `scheduling` roles.

```text
┌─ Header: month picker (defaults June 2026), "Recompute" button ─┐
│
│ ┌─ Upload panel (collapsible after first run) ───────────────┐
│ │ 1. Demand by state (CSV)        [drop / browse]            │
│ │ 2. Medallion licenses (CSV)     [drop / browse]            │
│ │ 3. Supervision matrix (XLSX)    [drop / browse]            │
│ │ 4. EHR state coverage (CSV)     [drop / browse]            │
│ │ 5. Jotform availability (CSV)   [drop / browse]            │
│ │ Status pills: parsed rows / providers found / states found │
│ └────────────────────────────────────────────────────────────┘
│
│ KPIs: Demand hrs · Accepted hrs · Declined hrs · Fill % · Providers
│
│ Tabs:  [By Provider]  [By Day]  [Declined]
└──────────────────────────────────────────────────────────────────┘
```

All three tabs share the same in-memory computed result, so checking "Posted to Homebase" on a provider in **By Provider** instantly updates **By Day** and the KPI bar.

## Tab details

### By Provider
- Sortable rows: name · profession · accepted hrs · # shifts · Homebase ☐ · EHR ☐
- Each row expands (accordion) to show the provider's accepted shifts (date / time / state assigned / hours) and any partially-declined shifts with reason.
- Per-row "Mark all Homebase" and "Mark all EHR" quick buttons.
- Page-level "Mark all Homebase" / "Mark all EHR" in toolbar (filtered set).

### By Day
- One accordion per calendar date, sorted ascending.
- Each day shows: total hours, # providers, list of (provider · time · state).
- Same Homebase / EHR checkboxes per provider-on-day; toggling here updates the same `publish_status` row used in By Provider (publish status is per-provider-per-month, not per-shift).

### Declined
- Flat list grouped by reason: `outside_business_hours`, `state_capacity_full`, `provider_unlicensed_in_needed_states`, `np_state_restricted`, `date_blackout`.
- Columns: provider · date · time · hours · reason · notes.
- Read-only — no publish controls (declined hours are not posted).

## Allocation algorithm (in-browser, deterministic)

Inputs (all parsed client-side):
- **Demand**: `state → monthly_hours_needed` (from file 1, "Adjusted Monthly Hours" column).
- **Eligibility**: `provider → Set<state>` = **union** of:
  - states in Medallion CSV with `Status: active`,
  - green-cell states in supervision XLSX,
  - "1"-marked states in EHR coverage CSV.
- **Restrictions**: NPs hard-blocked from `AL, GA, IN, MO, MS, SC, TN, LA` (existing core rule). Profession comes from Medallion CSV (`Profession` column) — fallback to "NP" if unknown.
- **Availability**: latest Jotform submission per provider (by `Submission Date`), parsed into discrete shift candidates:
  - Recurring weekday rules → expanded to every matching weekday in June.
  - One-off virtual / in-home dates → used as-is.
  - Subtract any blackout date ranges.

Pass 1 — Validate each shift:
- Clip to operating hours (Mon–Fri 09:00–21:00 ET, Sat–Sun 09:00–12:00 ET). If clipped to 0, decline as `outside_business_hours`.
- If provider has no eligible state with remaining demand, decline as `provider_unlicensed_in_needed_states`.

Pass 2 — Greedy fill, smallest-demand-first:
- Sort states ascending by `remaining_hours` (skip 0 and negative).
- For each shift (in date/start order):
  - Find the provider's eligible state with the smallest positive `remaining_hours`.
  - Assign min(shift_hours, state_remaining) to that state. If shift hours exceed remaining, the leftover gets re-tried against the next smallest eligible state, and any final remainder is declined as `state_capacity_full` (partial accept supported).

Output per shift: `{provider, date, start, end, accepted_hours, assigned_state, declined_hours, decline_reason}`.

Output per provider (aggregated): total accepted hours, # shifts, list of accepted/declined shifts.

## Cross-view publishing state

Reuse existing `publish_status` table on the clinops Supabase (`provider_id`, `target_month`, `homebase_posted_at`, `ehr_posted_at`).

- Provider matching to a `provider_id`: try by exact `email` against `providers.email`, fallback to normalized full name. Unmatched providers show a small ⚠ chip and are saved to a local-only state (no DB row, but checkboxes still work for the session).
- Toggling Homebase/EHR calls existing `useTogglePublishStep` / `useBulkMarkPublishStep`. All three tabs read from the same in-memory `Map<provider_id, PublishRow>` populated from the existing `useMonthlyPublishView`-style query, so updates are reactive everywhere.

## What we're explicitly NOT doing

- No DB tables for uploads. Files live in browser memory; refresh = re-upload.
- No edge function for allocation. All logic in `src/lib/juneScheduleAllocator.ts`.
- No editing of individual shift assignments — re-upload + recompute is the override path.
- No CSV export of the final schedule (can add post-MVP if needed).
- No changes to existing `/scheduling/workbench` or `/scheduling/forecast`.

## Files to add

- `src/pages/scheduling/JuneMvpPage.tsx` — the page, tabs, KPIs, upload panel.
- `src/components/scheduling/mvp/UploadPanel.tsx` — 5 file slots with parsed-status pills.
- `src/components/scheduling/mvp/ByProviderPanel.tsx`
- `src/components/scheduling/mvp/ByDayPanel.tsx`
- `src/components/scheduling/mvp/DeclinedPanel.tsx`
- `src/lib/juneSchedule/parseDemand.ts`
- `src/lib/juneSchedule/parseLicenses.ts` (Medallion CSV — regex-extract `State : XX` blocks per provider)
- `src/lib/juneSchedule/parseSupervisionXlsx.ts` (uses `xlsx` lib — already in deps if not, add it)
- `src/lib/juneSchedule/parseEhrCoverage.ts`
- `src/lib/juneSchedule/parseJotform.ts` (handles multi-line quoted cells, "Day of Week:" / "Date:" / blackout ranges)
- `src/lib/juneSchedule/allocator.ts`
- `src/lib/juneSchedule/businessHours.ts`
- `src/hooks/useJuneSchedule.ts` (combines uploads → memoized allocation result)

## Files to edit

- `src/App.tsx` — add `/scheduling/june-mvp` route (admin + scheduling).
- `src/components/scheduling/SchedulingSidebar.tsx` — add "June MVP" nav item.
- `src/components/AppSidebar.tsx` — add link in Home group for admin convenience.

## Dependencies

- `papaparse` (CSV) and `xlsx` (Excel). Add only if not already present.

## Acceptance checks

1. Upload all 5 files → KPIs populate within ~2s; counts match file row counts.
2. PA (largest demand) is filled last; small states like WY/HI fill first when an eligible provider exists.
3. A 7am ET shift gets clipped/declined as `outside_business_hours`.
4. Toggling Homebase on a provider in **By Provider** flips the corresponding row in **By Day** and updates the % KPI immediately.
5. Reloading the page preserves Homebase/EHR posted state (persisted in `publish_status`); uploads must be re-dropped.
