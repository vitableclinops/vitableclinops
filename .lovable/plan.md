## Problem

Coverage Copilot mixes two data sources with very different freshness:

- **Homebase shifts / availability slots** — the *schedule* (forward-looking, refreshed regularly)
- **Metabase actuals (visits, leftover/unfilled slots, utilization)** — the *what actually happened* lookback, which lags ~12h after a day ends (and isn't reliable until midnight the following day)

Right now the network mode pulls `state_leftover_slots` with `window_type IN ('historical','forecast')` and treats today's and yesterday's `historical` rows as ground truth. That can produce misleading "surplus" numbers because half the day's bookings haven't landed in Metabase yet.

## Goal

Teach Copilot to:
1. Treat any `historical`/Metabase-derived data for **today and yesterday** as *preliminary* (or skip it entirely).
2. Prefer the *schedule* (forward) view for those days.
3. Surface this caveat in both `plain_english` facts and the synthesized answer so users know when a number is provisional.

## Scope of changes

Single file: `supabase/functions/coverage-copilot/index.ts`. No DB migrations, no UI changes required (the existing "Facts used" panel already renders the new `plain_english` lines and a `data_freshness` field). Optionally a tiny UI tweak to render a "Preliminary" badge on affected days — nice-to-have, ask user.

### 1. Add a freshness cutoff helper

```text
metabaseCutoffDate(now) =
  the latest YYYY-MM-DD whose actuals are considered settled.
  Rule: a day D is settled once we are >= 12h past end-of-day D in ET.
  Simpler approximation: cutoff = (today_ET - 2 days).
  Anything strictly after cutoff is "preliminary".
```

We'll implement the simple rule (`today - 2`) first because it matches the user's stated "midnight the next day + 12h" guidance and avoids timezone headaches. Configurable via `system_config` key `metabase_lag_days` (default 2).

### 2. Re-classify slot rows in `runNetworkMode`

When building `slotKey`:

- For each row, compute `is_preliminary = (window_type === 'historical' && slot_date > cutoff)`.
- Keep the row but tag it. Existing "prefer historical over forecast" logic stays for settled days; for preliminary days, **prefer `forecast` rows** if both exist (the schedule is more trustworthy than half-loaded actuals).
- Each `DayState` gains `is_preliminary: boolean` and `data_source: 'metabase_settled' | 'metabase_preliminary' | 'schedule_forecast'`.

### 3. Adjust aggregates

- Per-day totals get a `preliminary: boolean` flag (true if any contributing row is preliminary).
- `firstDayWithGaps` ignores days where `preliminary === true && total_gap_hours > 0` *unless* there are no settled gap days at all — in which case still return it but mark it preliminary.
- Top gap/surplus states unchanged in computation, but the facts payload gets a `preliminary_days: string[]` list.

### 4. Facts payload additions

Add to the `facts` object:

```text
data_freshness: {
  metabase_lag_days: 2,
  settled_through: <cutoff date>,
  preliminary_dates: [...],
  note: "Metabase visit data lags ~12h after each day ends. Days after <cutoff> use the Homebase schedule (forecast) instead of actuals; treat any 'preliminary' numbers as provisional."
}
```

Append to `plain_english`:

- "Metabase actuals are settled through `<cutoff>`. Coverage for `<list>` is based on the Homebase schedule (forecast) and will be revised once visits import overnight."
- If a gap day is preliminary: "The earliest gap day (`<date>`) is preliminary — confirm tomorrow once Metabase actuals land."

### 5. Synth prompt update

Extend the `synthSystem` instructions:

- "If `facts.data_freshness.preliminary_dates` includes a date you reference, explicitly flag it as preliminary in the summary and add a `suggested_actions` item to re-check after the overnight Metabase sync."

### 6. Provider mode (`runProviderMode`)

Same treatment for the slot lookups it does in lines ~219-222 and the homebase shift block at ~316-328: tag any `historical` row whose `slot_date > cutoff` as preliminary, surface in that mode's `plain_english` and facts.

## Out of scope

- Changing the `import-leftover-slots` / Metabase pipelines.
- Changing `state_leftover_slots` schema.
- UI redesign — the existing panel will render new bullets and JSON. We can later add a small "Preliminary" pill on per-day rows if you want; flag below.

## Open question (will ask before implementing)

1. Is `today - 2` the right cutoff, or should it be `today - 1` after, say, 12pm local? (The former is safer; the latter is fresher.)
2. Should preliminary-day surplus be **hidden** from the "top surplus states" list, or just **labeled**? Hiding avoids the misleading 692.4h-style number entirely.
