## MVP Goal

Get a VA publishing the **June 2026** schedule into Homebase and the EHR in the next hour. Keep all changes scoped to the existing scheduling data so nothing else in the app moves.

## What's already built (we reuse it)

- `schedule_submissions` (per-provider monthly availability, parsed shifts, accepted/declined hours, decision_status)
- `publish_status` (per provider × month, with `homebase_posted_at` / `ehr_posted_at`)
- `useMonthlyPublishView`, `useTogglePublishStep`, `useShiftRecommendations` — already wire the provider view + Homebase/EHR checkboxes
- Existing **Workbench** page (`/admin/workbench`) has the Provider tab and an All Shifts tab

The MVP is a slim re-shell of these hooks plus two new views. No new business logic, no schema changes beyond the role enum.

---

## 1. New `scheduling` role

- Add `'scheduling'` to the `app_role` enum (migration).
- `AppSidebar` and `ProtectedRoute` already use `hasRole`. Treat `scheduling` as having access only to the new `/scheduling/*` routes. Admins keep full access (the role check is OR-based).
- Provision via existing User Roles page — no new admin UI needed.

## 2. New `/scheduling` shell

A dedicated landing page + slim sidebar so the VA never sees licensure/agreements/etc.

```text
/scheduling                 → redirects to /scheduling/workbench
/scheduling/workbench       → Provider · By-Day · Declined · All Shifts (tabs)
/scheduling/forecast        → existing MonthlyForecastPage (read-only, reused)
```

Slim sidebar (`SchedulingSidebar.tsx`, new file): logo, "Workbench", "Forecast", user avatar. Nothing else. Admins navigating to `/scheduling/*` see the same slim shell (we don't show the full admin sidebar here — keeps the VA experience identical to what an admin can QA).

A small "Back to admin" link appears for users who also have the `admin` role.

## 3. Workbench tabs (the actual work surface)

Single page, four tabs, all bound to the same month picker (default **June 2026**) and all reading from the same hooks so checkboxes stay in sync across views.

### Tab A — By Provider (already exists, +1 button)

Reuse the current Monthly Publish table. Add at the top of the table:

```text
[ Mark all visible as posted to Homebase ]   [ Mark all visible as posted to EHR ]
```

- Operates on the currently filtered + accepted/partial rows
- Calls `useTogglePublishStep` in a loop (or a small batch wrapper) with `done: true`
- Toast shows count: "Marked 14 providers as posted to Homebase"
- Each individual checkbox still works for one-off corrections

### Tab B — By Day (new)

Pivots the same `parsed_shifts` data by date instead of by provider.

```text
Tue, Jun 3        12 shifts · 38 hrs       [ Homebase: 8/12 ✓ ]  [ EHR: 0/12 ]
  ▸ Jasmine Smith    9:00–13:00  NP Tele  PA   ☐ HB  ☐ EHR
  ▸ Daniyel Patel   10:00–14:00  NP Tele  TX   ☑ HB  ☐ EHR
  ...
Wed, Jun 4        9 shifts · 32 hrs        [ Mark all HB ]  [ Mark all EHR ]
  ...
```

- One collapsible card per date
- Per-row HB/EHR checkboxes are **provider-scoped** (toggling here flips the same `publish_status` row used by the Provider tab — that's the "linked across views" requirement)
- Per-day "Mark all HB / Mark all EHR" buttons act on every provider with a shift on that day
- Source data: `useShiftRecommendations(month)` (already returns provider+date+state+type) joined client-side with `publish_status` from `useMonthlyPublishView`

### Tab C — Declined (new, global)

Flat table of every shift inside `parsed_shifts` whose `status === 'declined'` (or rows where `decision_status === 'declined'`), across all providers for the selected month.

Columns: Provider · Date · Day · Start · End · Hours · State · Shift type · Reason (from `decision_notes`).

Read-only, sortable, CSV export. No publish checkboxes — declined shifts don't go to Homebase.

### Tab D — All Shifts (already exists)

Keep as-is. It's the flat sanity-check view.

## 4. Cross-view linking (the non-negotiable)

All four tabs read/write the **same** `publish_status` row keyed by `(provider_id, target_month)`. The Provider Homebase checkbox, the By-Day per-row checkbox, and the bulk buttons all hit `useTogglePublishStep`. React Query's `['workbench','monthly-publish']` invalidation already broadcasts updates to every mounted view. No new tables, no new sync logic.

> **Caveat to confirm:** publish status is currently per-provider-per-month, not per-shift. So if Provider X has 8 shifts and you check "HB done" for one shift in the By-Day view, it marks the whole provider as HB-done (the same row updates everywhere). That matches your "single Mark all HB / Mark all EHR" answer and avoids a schema change. Flag if you want per-shift granularity instead — that would be a bigger build (new `shift_publish_status` table).

## 5. Out of scope for this MVP

- Inbox, Forecast overrides, Build grid, Coverage triage from the v2 brief
- Per-shift publish tracking
- Jotform → submissions sync changes (uses what's already there)
- Any licensure / agreements / hiring surfaces

---

## Technical details

**Files added**
- `supabase/migrations/<ts>_add_scheduling_role.sql` — `ALTER TYPE app_role ADD VALUE 'scheduling';`
- `src/components/scheduling/SchedulingSidebar.tsx` — slim 2-link nav
- `src/components/scheduling/SchedulingShell.tsx` — layout wrapper
- `src/pages/scheduling/SchedulingWorkbenchPage.tsx` — 4-tab page (lifts current Workbench logic, adds bulk buttons + By-Day + Declined)
- `src/components/scheduling/ByDayPanel.tsx`
- `src/components/scheduling/DeclinedPanel.tsx`

**Files edited**
- `src/App.tsx` — add 3 routes under `/scheduling/*`, gated by `requiredRoles={['admin','scheduling']}`
- `src/hooks/useMonthlyPublish.ts` — add `useBulkTogglePublishStep` (loops over `useTogglePublishStep` server-side via a single upsert array)
- `src/components/AppSidebar.tsx` — no change (admins still see Monthly Forecast etc.)
- `src/components/ProtectedRoute.tsx` — no change (already supports role list)

**Data flow**
- All views: `useMonthlyPublishView(month)` + `useShiftRecommendations(month)` (already exist)
- Bulk action: single `upsert` to `publish_status` with array of `(provider_id, target_month, homebase_posted_at|ehr_posted_at)` rows; one toast, one query invalidation

**Defaults**
- Month picker defaults to `2026-06-01`
- "Declined" tab pulls `parsed_shifts[*].status === 'declined'` + any submission with `decision_status='declined'`

## Acceptance check (do these in order after implementation)

1. Sign in as admin, visit `/scheduling/workbench` — slim sidebar, June 2026 selected.
2. Click "Mark all visible as posted to Homebase" on the Provider tab — all checkboxes flip, toast confirms count.
3. Switch to By Day tab — same providers show ☑ HB on every date they appear.
4. Uncheck one provider's HB on a day card — Provider tab reflects the change immediately.
5. Declined tab shows declined shifts only, with reason.
6. Create a test user with the `scheduling` role — they can reach `/scheduling/*` but get redirected away from `/admin/*`.