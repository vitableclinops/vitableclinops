

## Why Homebase Data Isn't Showing

**Root cause:** The Homebase sync (`sync-homebase`) last pulled shifts dated March 31 – April 6. Today is April 16, so the `compute-availability-slots` function only generated forecast rows for April 1–6. The Ops Dashboard queries for **today's date** and finds nothing — the data exists but is 10 days stale.

There are two problems to fix:

1. **Homebase sync needs to pull current/future shifts.** The sync function likely queries a fixed or past date window. It needs to request shifts that cover today through ~14 days ahead so the availability function has fresh data to work with.

2. **The compute function's date window is correct** (14 days back, 14 days ahead) — but it can only produce slots from shifts that exist in `homebase_shifts`. No current shifts in the table means no current forecast rows.

---

## Plan

### Step 1: Fix Homebase shift sync date window
Inspect `supabase/functions/sync-homebase/index.ts` and update the date range so it fetches shifts from **today − 14 days** through **today + 14 days** (or further). Currently it appears to only pull historical/past-week shifts.

### Step 2: Re-run the sync pipeline
1. Invoke `sync-homebase` to pull fresh shifts covering today and future dates
2. Invoke `compute-availability-slots` to regenerate forecast rows from the updated shifts
3. Verify that `state_leftover_slots` now has forecast rows for today's date

### Step 3: Verify on the Ops Dashboard
Confirm the state coverage table shows slot counts with the blue ⚡ HB badge for states with Homebase-derived forecast data.

---

### Technical detail
- `homebase_shifts` currently has 175 rows, all dated March 31 – April 6
- `state_leftover_slots` has 306 forecast rows, all for April 1–6
- The dashboard queries `.eq('slot_date', date)` where `date` = today (April 16) → 0 matches
- 76 Homebase employees synced, 44 matched to profiles

