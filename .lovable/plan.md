## Goal

Make the two "hours" numbers on the Workbench unambiguous:

- **Accepted usable** (state coverage section, currently 2,575) → label as **Telehealth only** — this is the input to state coverage / shortage math.
- **Approved hours** (Cost / Visit card, currently 2,880.3) → label as **Telehealth + Mental Health** and show the MH breakdown so the ~305 hr delta is visible at a glance.

## Verification

In `costPerVisit.ts`, `totalApprovedHours` is the sum of `accepted_hours` across every provider row, including MH coaches, therapists, and LPCs (only the visits/hr multiplier changes per `mentalHealthServiceLineForProvider`). `useStateCoverage` only counts publish rows tied to telehealth state demand. So the 305 hr gap is structurally the MH/therapy/coaching hours (plus a small in-home / unassigned residual). The plan adds a runtime breakdown so we can confirm the exact split for July 2026 in the UI itself, and so it stays correct month-over-month.

## Changes

### 1. `src/lib/scheduling/costPerVisit.ts`
Extend `SchedulingCostModel` with:
- `telehealthApprovedHours: number` — sum of accepted hours for rows where `mentalHealthServiceLineForProvider(profession, provider_name) === null`.
- `mentalHealthApprovedHours: number` — sum for rows where it returns `'mh_coaching'` or `'therapy'`.
- `mhCoachingApprovedHours` and `therapyApprovedHours` for the tooltip breakdown.

Compute inside the existing `providerRows` reduce; no new query.

### 2. `src/pages/scheduling/SchedulingWorkbenchPage.tsx`
**Cost / Visit card (line ~8631):**
- Rename `label="Approved hours"` to `label="Approved hours (TH + MH)"`.
- Change `sub` from `"Accepted provider hours"` to a two-line breakdown: `"{telehealth} TH · {mh} MH"` and a small tooltip listing MH coaching vs therapy/LPC hours.
- Update the card description (line ~8617) to say "Includes telehealth and mental health hours; state-coverage math on the readiness tab counts telehealth only."

**Readiness "Accepted usable" tile (line ~7913):**
- Keep value, change `label` to `"Accepted usable (telehealth)"`.
- Append to `sub`: `"State-coverage scope; MH hours tracked separately in Cost / Visit."`

### 3. No backend / schema changes
All data already loaded by the cost-model query; this is pure presentation.

## Out of scope
- In-home / unassigned residual breakdown (separate reconciliation tooltip, not requested here).
- Renaming the underlying field `totalApprovedHours` (kept for backwards compat with the existing test in `schedulingCostPerVisit.test.ts`).
