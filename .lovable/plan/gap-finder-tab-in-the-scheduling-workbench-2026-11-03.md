# Gap Finder tab in the Scheduling Workbench

## Short answer
Yes, this is achievable, and most of the plumbing already exists. The suggested prompt assumes a fresh build; this plan reuses what the app already has instead of creating duplicate tables and syncs.

## What already exists (reuse, don't rebuild)
- Homebase shifts are already pulled on a schedule (locations, employees, shifts) by the existing Homebase sync, with name matching to provider profiles. No new Homebase function or `scheduled_hours_snapshot` table is needed.
- Expected demand already exists: the ClinOps forecast produces weekly telehealth hours of availability per state (cohort buffers included), stored as monthly/weekly targets. Units are already hours, so the "visits vs hours" conversion concern is solved.
- Provider licensed / EHR-active states are already known per profile.

## The one real gap: daily demand shape
Current demand is weekly per state. To say "next Tuesday has 100 scheduled vs 120 expected," weekly hours must be split by day of week. Plan: compute a day-of-week share per state from trailing 8-12 weeks of Metabase visit volume (weekends naturally get smaller shares), with holidays flagged. Daily expected = weekly target x that day's share.

## What gets built
1. Daily demand profile: a small stored table of day-of-week shares per state, refreshed weekly from Metabase, plus a holiday list.
2. Gap calculation per date + state: scheduled hours (from synced Homebase shifts) vs expected hours, gap hours, coverage %.
3. New "Gap Finder" section in the Scheduling Workbench (alongside existing sections, nothing else changed):
   - Month picker (default next month), state filter, provider picker that defaults states to that provider's EHR-active states.
   - Calendar heatmap colored by coverage (red under 90%, yellow 90-100%, green over 100%); click a day to see its shifts.
   - Table sorted by largest gap, with CSV export; summary cards (total gap hours, days under 90%, top 5 gap days).
   - "Refresh from Homebase" button using the existing sync, with last-pulled time.
   - Provider Offer Check: enter offered date/time/state; each is labeled Fills a gap / Marginal / Adds to surplus, with total gap hours closed. Read-only; nothing written back to Homebase.

## Recommendations beyond the suggested prompt
- Skip the CSV demand upload: the forecast is already automated, so manual uploads would drift from it.
- Telehealth only to start (matches how demand targets are stored); other service lines later.
- Daily first, but keep shift start/end times so hour-of-day gaps can be added later.
- MD-only states (AL, GA, IN, MO, MS, SC, TN, LA): only count physician shifts, and block NP offers there.

## Technical details
- Source tables: existing Homebase shift tables + `state_demand_targets` / `demand_forecast`.
- New: `demand_dow_profile` (state, dow, share, computed_at) populated by an edge function querying Metabase via the existing connection; a `coverage_gap_by_date_state` view or client-side join.
- UI: new section component in the Scheduling Workbench (`?section=gap-finder`).
- Tests for gap math, coverage thresholds, and offer labeling.
