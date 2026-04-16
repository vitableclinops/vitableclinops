

## Problem: Homebase API pagination cap at 100

The `iterateShifts` method requests `per_page=200`, but the Homebase API silently caps responses at **100 records**. When the function receives 100 records back, it checks `100 < 200` → true → stops paginating. This means it only ever fetches the first 100 shifts (March 31 – April 7) and never reaches current/future dates.

The same issue likely affects `iterateEmployees` (set to `perPage=100`, which happens to match the cap — so it works by luck).

## Fix

### Step 1: Lower `perPage` to 100 in `homebaseClient.ts`
Change the default `perPage` from `200` to `100` for `iterateShifts`. This way when Homebase returns exactly 100 results, the function correctly recognizes there may be more pages and continues paginating.

```
iterateShifts(..., { perPage = 100 } = {})
```

### Step 2: Re-deploy and re-sync
1. Deploy the updated `sync-homebase` function (shares the client)
2. Invoke `sync-homebase` to pull all shifts (should now paginate beyond page 1)
3. Invoke `compute-availability-slots` to regenerate forecast rows
4. Verify `shifts_synced` is significantly more than 100 and dates extend to current week

### Step 3: Verify on Ops Dashboard
Confirm the state coverage table populates with current-day forecast data showing the ⚡ HB badge.

---

**Technical detail**: One-character fix in `homebaseClient.ts` line 134: `perPage = 200` → `perPage = 100`. The pagination termination condition `batch.length < perPage` then correctly triggers only when a page is genuinely partial.

