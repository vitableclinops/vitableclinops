# suggest-activation-candidates

Ranks providers who are **licensed** in a deficit state but **not yet activated** there, with utilization at or below a threshold. Powers the "Same-day activation candidates" panel on `/admin/license-optimizer`.

## Request

```
POST /functions/v1/suggest-activation-candidates
{
  "target_date": "2026-04-21",            // optional, defaults to today UTC
  "state": "PA",                          // optional, restrict to one state
  "utilization_threshold": 70,            // optional, default 70 (percent)
  "limit": 10,                            // optional, default 10 per state
  "persist": true                         // optional, logs a run row
}
```

## Response shape

```json
{
  "target_date": "2026-04-21",
  "utilization_threshold": 70,
  "data_source": "daily" | "five_week_avg" | "mixed",
  "deficit_state_count": 3,
  "candidate_count": 7,
  "deficit_states": [
    {
      "state": "PA",
      "unfilled_slots": 18,
      "candidates": [
        {
          "profile_id": "…",
          "provider_name": "Jane Doe",
          "state": "PA",
          "utilization_pct": 42.5,
          "data_source": "daily",
          "readiness_status": "ready",
          "ehr_activation_status": "inactive",
          "score": 27.5,
          "unfilled_slots": 18
        }
      ]
    }
  ]
}
```

## Data pipeline

1. **Deficit states:** Primary — `license_optimization_snapshots` where `snapshot_date = target_date` and `quadrant = 'DEFICIT'`. Fallback — `state_leftover_slots` where `slot_date = target_date` and `unfilled_slots > 0`.
2. **Eligibility:** `provider_licenses.status = 'active'` in deficit state AND `provider_state_status.ehr_activation_status != 'active'` (or missing row).
3. **Utilization:** Primary — `provider_utilization_daily` for `target_date`. Fallback — newest `provider_utilization` row (5-week rolling average) per provider.
4. **Ranking:** `score = max(0, threshold - utilization_pct) * log2(max(unfilled_slots, 1) + 1)`.

## Metabase card required for "Live today" data

To populate `provider_utilization_daily`, create a Metabase card named **"Daily Provider Utilization"** that returns one row per provider for a single day (today). The sync-metabase function finds it by name.

### Required columns (any of these aliases work)

| Concept | Accepted headers |
| --- | --- |
| Provider | `Provider Full Name`, `Provider`, `Provider Name`, `provider_full_name`, `Name` |
| Date | `Date`, `Day`, `util_date`, `date_actual` — if omitted, defaults to today |
| Utilization | `Utilization Rate`, `utilization`, `Booking Rate` (as a % or 0–1 fraction) |
| Booked (optional) | `Booked Timeslots`, `Booked`, `Appointments`, `Bookings` |
| Total (optional) | `Total Timeslots`, `Timeslots`, `Available Timeslots` |

If the utilization column is missing but both booked and total are present, the handler computes `booked / total * 100`.

### Suggested SQL sketch

```sql
-- Daily per-provider utilization (replace table names with your data warehouse equivalents)
SELECT
  p.full_name                        AS "Provider Full Name",
  CURRENT_DATE                       AS "Date",
  COUNT(*) FILTER (WHERE ts.booked)  AS "Booked Timeslots",
  COUNT(*)                           AS "Total Timeslots",
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ts.booked) / NULLIF(COUNT(*), 0),
    2
  )                                  AS "Utilization Rate"
FROM time_slots ts
JOIN providers p ON p.id = ts.provider_id
WHERE ts.slot_date = CURRENT_DATE
GROUP BY p.full_name;
```

### Pinning the card ID

After creating the card, find its ID in the Metabase URL and pin it in `sync-metabase/index.ts` next to the `name: 'Daily Provider Utilization'` entry:

```ts
{
  cardId: 9999,  // ← paste the card ID here
  name: 'Daily Provider Utilization',
  handler: handleProviderUtilizationDaily,
},
```

Pinning skips fuzzy-search and survives card renames.

## Before using

1. Apply migration `20260421000000_provider_utilization_daily_and_candidates.sql`.
2. Deploy `suggest-activation-candidates` and the updated `sync-metabase`.
3. (Optional) Create + pin the Daily Provider Utilization card. Without it the function falls back to the 5-week rolling average and marks results as `five_week_avg`.
