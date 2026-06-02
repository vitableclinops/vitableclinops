# Vitable Ops — Scheduling Subsystem Summary

> Scope: this document covers the **Scheduling Workbench, the scheduling
> dashboard, and the scheduling-related pages/flows** only — not the broader
> licensure/compliance/admin surface of the app. Where scheduling depends on
> the rest of the platform (auth, provider directory, demand methodology) it is
> noted, but the focus is the "build and publish next month's provider
> schedule" workflow.

Stack: React 18 + TypeScript + Vite + Tailwind + shadcn/ui, TanStack Query for
server state, two Supabase projects (see "Data architecture"). Charts use
recharts. Spreadsheet/CSV parsing uses `xlsx` + `papaparse`.

---

## 1. What the scheduling part does

Vitable runs a multi-state telehealth + mental-health provider network. The
scheduling subsystem is the tool a single clinical-operations manager uses to
**turn provider availability into a published monthly schedule** that hits
per-state coverage / SLA targets at the lowest provider cost.

Each month the operator forecasts demand per state, collects provider
availability via a Jotform, runs an allocation engine that decides which
submitted hours to **accept / partially accept / decline** (respecting state
licensure, scope-of-practice rules, and demand gaps), reviews the resulting
per-shift recommendations and any remaining coverage gaps, and then **publishes
the month into Homebase (the scheduling system) and the EHR**, tracking
posting progress shift-by-shift with an audit trail. Alongside this monthly
"Plan" cycle, the same workbench surfaces as-needed "Operate" work —
last-minute additional-hour requests, resubmissions/edits, unmatched
submissions, and time-off — so the operator can triage incoming changes to the
already-published active month from one place.

---

## 2. Main user-facing flows

The design brief (`docs/scheduling-workbench-uiux-brief.md`) frames all
scheduling work as **two parallel branches**:

- **Plan (Monthly Cycle):** batch-produce next month's schedule. Forecast →
  collect availability (Jotform, 1st of month) → build/allocate → fill gaps →
  publish to Homebase + EHR in one event.
- **Operate (As-Needed):** real-time work on the *currently active* month —
  additional-hour requests, edits to published shifts, daily coverage triage,
  no-shows, time-off.

### Flow A — Build and publish next month (the core flow)

The operator works left-to-right through the workbench top tabs:

1. **Readiness** (landing/dashboard tab) — a go/no-go checklist for the month.
   Shows submitted-availability hours, providers still missing submissions,
   inbox items needing review, unmatched submissions, and a "Recalculate
   schedule" action. Includes an **Onboarding readiness** check: for every
   recently-added provider it verifies the prerequisites for their Jotform
   submission to flow through (Vitable email on file, `active = true`,
   profession set, and — for non-mental-health providers — at least one active
   license). Gaps must be fixed *before* the provider submits, or the
   submission lands unmatched or auto-declined. Jump buttons route to
   Coverage / Matching / Availability / Publish.
2. **Forecast** — projected per-state demand (weekly target hours) for the
   selected month, sourced from `state_demand_targets` / `demand_forecast`.
3. **Availability** — the submission inbox. Sub-tabs: **Submissions** (parsed
   Jotform availability per provider), **Inbox** (resubmissions/edits grouped
   with a diff vs. the prior submission), **Unmatched** (form email not in the
   provider directory — match to existing or create), **Setup** (onboarding
   readiness), **Missing** (providers who haven't submitted), **Time off**
   (unavailable date ranges extracted from the form). The operator can also
   upload a Jotform CSV/XLSX export to preview a not-yet-imported file
   (overrides the system-built shifts for previewing).
4. **Matching** — the allocation results. Per-provider accepted / partial /
   declined decisions with the per-shift recommendations, a "Needs Review"
   queue, and state eligibility per provider. This is where the engine's
   output is inspected and resolved.
5. **Coverage Gaps** — per-state coverage panel: target vs. filled, surplus vs.
   shortage, given the currently-accepted shifts.
6. **Publish** — the monthly publish action. KPI cards (shifts to publish, %
   posted to Homebase, % posted to EHR, declined count) and sub-tabs **By
   Provider / Publishing Queue / By Day / Needs Review / History**. The
   operator marks each shift (or provider) as posted to **Homebase** and to the
   **EHR**; each checkbox captures who marked it and when (hover to see audit).
   A "publish gate" banner blocks publishing unless Readiness says it's OK or a
   ClinOps lead overrides.
7. **Declined Hours** — submissions/shifts that were declined (with reasons,
   cross-referenced to the Audit tab). Badge shows the count; also reachable
   directly via the sidebar "Declined Hours" link.
8. **Audit** — full source/decision audit log: how each number traces back to
   Jotform, demand, eligibility, and prior runs.

Re-running **"Recalculate schedule"** re-invokes the allocation engine against
the latest Jotform submissions. Already-published shifts keep their
Homebase/EHR posting state; only shifts that change or disappear lose progress.

### Flow B — Handle a resubmission / additional-hours request (Operate)

A provider re-submits the Jotform or asks for more hours → the item appears in
**Availability → Inbox** with a computed diff (added / removed / changed
shifts) vs. what was previously accepted → operator accepts all, accepts
partial, or rejects inline. Earlier submissions are marked `superseded` so the
audit trail stays intact.

### Flow C — Mental-health scheduling

The same workbench renders with a `scope="mental_health"` prop at
`/scheduling/mental-health`. Mental-health providers (coaches, therapists/LPCs)
are scheduled against **service-line demand pools** (MH Coaching, Therapy/LPC)
rather than the per-state telehealth allocator, with a service-line filter in
the header.

### How a single provider's hours become a decision (engine internals)

`evaluate-schedule-submissions` (the allocation engine) processes each
(provider, month) group:

1. Normalize every submission's `parsed_shifts` through the validation pipeline
   (`_shared/availabilityValidation.ts` + `submissionTimeline.ts`): apply
   provider-specific and default AM/PM corrections, flag implausible shifts,
   expand recurring availability to weekday occurrences, reconcile resubmissions
   (later overwrites overlapping earlier slots), and subtract unavailable dates.
2. `effective_hours` = the pipeline's final approvable hours.
3. Compute eligible states from `v_provider_state_eligibility` (rolls up ClinOps
   manual licenses + Medallion API + DirectShifts static + live Metabase active
   overlay), then apply scope-of-practice policy: **MD/DO/physicians are
   reserved for MD-only states (AL, IN, GA, MS, MO, SC, TN, LA); non-physicians
   are excluded from those states.**
4. For each eligible state, demand = sum of `demand_forecast` for the month
   (these values are **hours of provider availability**, not visits — see
   methodology), with a **1.25× access-growth buffer**, minus hours already
   committed to other providers in prior runs.
5. Protect **scarce coverage windows (Friday PM, Saturday, Sunday)** before
   trimming monthly oversupply.
6. Decide: accepted_hours == effective → **accepted**; > 0 → **partial**;
   ≤ 0 → **declined**. Writes back decision + accepted/declined hours +
   per-shift recommendations.

Provider tie-breaking uses `lib/scheduling/providerPriority.ts`:
clinical supervisor > Vitable internal > DirectShifts (Brittany-priority) /
access providers.

---

## 3. Key screens / pages / components

### Primary

| Route | Component | Role gate | What it is |
|---|---|---|---|
| `/scheduling` → `/scheduling/workbench` | redirect | — | entry |
| `/scheduling/workbench` | `pages/scheduling/SchedulingWorkbenchPage.tsx` | `admin`, `scheduling` | **The Scheduling Workbench / dashboard** (the 8-tab tool above). ~5,600 lines; the centerpiece. Sidebar labels it "Scheduling Dashboard". |
| `/scheduling/mental-health` | same page, `scope="mental_health"` | `admin`, `scheduling` | MH-scoped workbench |
| `/scheduling/forecast` → `/scheduling/workbench?tab=forecast` | redirect | — | legacy alias |
| `/scheduling/june-mvp` → `/scheduling/workbench` | redirect | — | legacy alias |

`SchedulingShell.tsx` wraps scheduling pages with `SchedulingSidebar.tsx`
(slim sidebar: Scheduling Workbench / Mental Health / Declined Hours, plus an
Admin Dashboard link for admins). The month selector (`MONTH_OPTIONS`:
2026-06 → 2026-09) and "Recalculate schedule" live in the workbench header.

### Supporting components (`src/components/scheduling/`)

- `OnboardingReadinessPanel.tsx` — recent-provider prerequisite checklist (email / active / profession / licenses), grouped "Needs setup" vs "Ready", with a lookback selector.
- `ResubmissionInboxPanel.tsx` — grouped resubmission/edit cards with shift-level diffs and accept/partial/reject actions.
- `UnmatchedSubmissionsPanel.tsx` — submissions whose form email isn't in the directory; match-to-existing or create-new.
- `ProviderNotesCard.tsx` / `ProviderNoteIndicator` — per-provider operator notes.

### Related scheduling pages (in the admin "Coverage & Ops" nav, role `admin`/`pod_lead`)

These feed or mirror parts of the workbench:

- `WorkbenchPage.tsx` (`/admin/workbench`) — **"Workbench · Monthly Publish"**: a leaner standalone monthly-publish view (accepted/declined hours, % posted to Homebase/EHR, per-provider posting toggles, re-evaluate, override decisions). Overlaps with the workbench's Publish tab.
- `MonthlyForecastPage.tsx` (`/admin/monthly-forecast`) — **"Monthly Schedule Forecast"**: per-provider recommendations + per-state demand for a month; fill-rate KPIs; CSV export.
- `ShiftPlanPage.tsx` (`/admin/shift-plan`) — per-provider publish/cut **shift recommendations**; toggle publish status (pending → published_to_homebase); reads `shift_recommendations`.
- `ScheduledHoursPage.tsx` (`/admin/scheduled-hours`) — **"Scheduled Hours by Role"**: Homebase hours scheduled by role, weekly/monthly rollups (via `homebase-hours-by-role` edge function).
- `DemandForecastPage.tsx` (`/admin/demand-forecast`) — weekly demand per state; bulk CSV import into `demand_forecast`; trend charts; CSV export.

### Legacy (present in repo, not routed)

- `pages/scheduling/JuneMvpPage.tsx` ("June 2026 Schedule MVP") and
  `pages/scheduling/SchedulingForecastPage.tsx` — superseded by the workbench;
  their routes redirect into `/scheduling/workbench`.

### Core data hooks & libs

- `hooks/useMonthlyPublish.ts` — the scheduling data layer (~1,300 lines):
  submissions, publish views, eligibility, audit log, resubmission inbox,
  onboarding readiness, shift recommendations, and the publish-toggle mutations.
- `hooks/useMonthlySchedulingForecast.ts` — demand from `state_demand_targets`,
  `service_line_demand_targets`, plus SLA risk.
- `hooks/useStateCoverage.ts` — per-state coverage from targets + shift
  recommendations + eligibility.
- `hooks/useShiftRecommendations.ts` — `shift_recommendations` +
  `v_provider_shift_summary`, with a publish-status update mutation.
- `hooks/useSchedulingSourceAudit.ts` — builds the Audit-tab source trace.
- `lib/scheduling/{coverage,mentalHealth,providerPriority,submissionDiff}.ts`
  and `lib/juneSchedule/parseJotform.ts` (`buildShiftCandidates`) +
  `lib/{availabilityValidation,submissionTimeline,slaFormulas}.ts`.

---

## 4. Role-based access

Auth is in `src/hooks/useAuth.tsx`; gating is enforced by
`src/components/ProtectedRoute.tsx`. Roles come from the `user_roles` table.

- All `/scheduling/*` routes require role **`admin` OR `scheduling`**.
  (`scheduling` is a dedicated, scheduling-only role beyond the four core roles
  admin / pod_lead / provider / physician.)
- A `scheduling`-only user logging in is auto-redirected to
  `/scheduling/workbench` (see `pages/Index.tsx`); admins see the Admin
  Dashboard link in the scheduling sidebar.
- The related "Coverage & Ops" scheduling pages (`/admin/workbench`,
  `/admin/monthly-forecast`, `/admin/shift-plan`, `/admin/scheduled-hours`)
  are open to **`admin` and `pod_lead`**; `/admin/demand-forecast` is
  **`admin`** only.
- Providers themselves do not use the workbench — they only **submit
  availability via the external Jotform**; their decisions surface to them
  elsewhere in the app.

---

## 5. External integrations a user interacts with

The scheduling flow is the seam between several external systems:

- **Jotform** — providers submit monthly availability and time-off via a
  Jotform. `sync-jotform-submissions` (edge function) parses submissions into
  the `schedule_submissions` table; the workbench also accepts a manual
  CSV/XLSX upload of a Jotform export for previewing.
- **Homebase** — the scheduling/timeclock system the schedule is published
  into. The operator manually posts week-by-week in Homebase, then checks off
  "posted to Homebase" per shift in the Publish tab.
  `homebase-hours-by-role` reads scheduled hours back by role.
- **EHR** — the schedule is also posted into the EHR (manual), tracked with a
  separate "posted to EHR" checkbox per shift.
- **Metabase** — source of the demand forecast and provider state-activity /
  utilization. `compute-demand-forecast` reads Metabase cards
  (2974 telehealth, 2973 MH coaching, 2971 therapy, 2972 in-home) to populate
  demand targets.
- **Medallion / DirectShifts / ClinOps manual licenses** — feed
  `v_provider_state_eligibility`, which constrains which states a provider's
  hours can be allocated to.
- **Slack** — coverage/availability digests and reminders are pushed via
  edge functions (e.g. `send-ops-dashboard-slack`) and a separate
  `workflows/` Python job for the daily availability report.

### Scheduling edge functions (in `supabase/functions/`)

`sync-jotform-submissions`, `evaluate-schedule-submissions` (the allocator),
`compute-demand-forecast`, `emit-shift-recommendations`,
`compute-availability-slots`, `homebase-hours-by-role`, `import-demand-forecast`.
Shared logic lives in `_shared/submissionTimeline.ts`,
`_shared/availabilityValidation.ts`, `_shared/providerPriority.ts`.

### Data architecture (two Supabase projects)

- **Primary project** (`@/integrations/supabase/client`) — auth, profiles,
  licensure, agreements, tasks.
- **ClinOps project** `bbquooftytwprllipcsb`
  (`@/integrations/supabase/clinopsClient`, env
  `VITE_CLINOPS_SUPABASE_URL` / `_PUBLISHABLE_KEY`) — the **scheduling
  pipeline**: `schedule_submissions`, `demand_forecast`,
  `state_demand_targets`, `service_line_demand_targets`,
  `shift_recommendations`, `providers`, `v_provider_state_eligibility`,
  `v_provider_shift_summary`, publish-status tables. The UI reads this project
  read-only via the anon key; **all writes go through edge functions.**

---

## 6. Notable configurations / settings the operator controls

- **Target month** — header dropdown (`MONTH_OPTIONS`, currently
  Jun–Sep 2026); deep-linkable via `?tab=` query param.
- **Service-line scope** — telehealth (default) vs. mental-health
  (`/scheduling/mental-health`), with an MH service-line filter
  (MH Coaching vs. Therapy/LPC).
- **Recalculate schedule** — re-runs the allocation engine on the latest
  submissions, preserving posting state for unchanged shifts.
- **Publish posting state** — per-shift / per-provider "posted to Homebase"
  and "posted to EHR" toggles, each audited (who + when), gated by the
  Readiness check.
- **Decision overrides** — operator can override an accept/partial/decline
  decision and resolve "Needs Review" items; resubmissions supersede earlier
  ones with the audit trail kept.
- **Onboarding-readiness lookback window** — 14/30/60/90 days.
- **Provider-specific availability overrides** — `src/config/availabilityOverrides.ts`
  (e.g. AM/PM corrections) applied during normalization.

### Demand methodology & policy constants (canonical; see `CLAUDE.md` and `SCHEDULING_DECISION_CONTRACT.md`)

- Forecast card values are **weekly hours of provider availability** (≈ 1
  visit/hr given 30-min appointments + same/next-day SLA buffer); not divided
  by two.
- **Cohort buffers** (flat %): Core (PA, NJ) +17.5%; Growth (TX, OH, FL) +20%;
  MD-Only (GA, IN, MO, TN, SC, MS, AL) +20%; DMV (DC, MD, VA) +15%; DE +15%;
  "021"/everything-else +15%.
- Allocator applies an additional **1.25× access-growth buffer** and a
  **scarce-window (Fri PM / Sat / Sun) protection** rule.
- **MD-only states** (AL, IN, GA, MS, MO, SC, TN, LA) receive demand-hour
  allocation only from MD/DO/physician providers; NPs are filtered out there.
- Daily SLA target ≈ `max(5, monthly_visits/20 × 1.5)`; SLA buckets
  critical (<1.0×) / low (1.0–2.0×) / ok (≥2.0×); SLA flag at `sla_pct < 85%`.
- Cost-per-visit target **< $60**: the objective is the smallest provider
  footprint that still keeps every state covered with buffer.
</content>
