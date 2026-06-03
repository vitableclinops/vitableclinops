# Same-Day / Next-Day Coverage Routing — SOP

_Owner: ClinOps. Last updated: 2026-06._

This is the operating manual for the deterministic daily coverage router that
powers the **Ops Coverage Bot** Slack digest. It covers data sources, the
formulas, the Metabase card contracts, the routing logic, how to read the Slack
post, how to rerun it manually, and the known caveats.

---

## 1. What it does

Every morning (before the Slack post window) a compute job:

1. Syncs **Homebase** (near-term scheduled shifts — the schedule source of truth).
2. Syncs **Metabase** (daily demand, booked appointments, utilization).
3. Runs `compute-daily-coverage-routing` for **today + tomorrow**
   (America/Chicago).

The router answers, per active state per day: _"How many hours of confirmed
provider coverage do we have versus demand, where are the routing risks, and
what add/move options exist?"_

`send-ops-dashboard-slack` then reads the freshest run and posts:

- a **main message** with the same/next-day **access** headline: unique booked
  appointment slots, unique available appointment slots, and total unique slots
  from Daily Provider Utilization; and
- a **thread** with provider detail and data-quality notes. Routed state gaps are
  fallback/debug detail only and should not be the headline access read.

The routed same/next-day path is **separate** from the legacy
`state_leftover_slots` forecast path, which stays available for dashboard /
legacy context but is **not** used for routed decisions.

---

## 2. Canonical units

The routing engine still uses **hours of provider availability** internally. One
booked appointment is assumed to be **0.5 hours** unless Metabase supplies
explicit booked hours.

The Slack access headline uses **unique appointment slots**:

- unique booked slots = `provider_utilization_daily.booked_timeslots`
- unique available slots = `total_timeslots - booked_timeslots`
- one provider hour = two appointment slots

Do **not** sum booked/available state-slot rows as the network total. State-slot
rows can be used as a state breadth/cushion watchlist only.

---

## 3. Sources

| Input | Source | Notes |
|---|---|---|
| Scheduled shifts | `homebase_shifts` + `homebase_employees` (Supabase) | Homebase is the schedule source of truth. Employee → provider via `homebase_employees.profile_id`, whose value is `providers.id`. |
| Provider licensure / scope | `v_provider_state_eligibility` | Any row counts as licensed/scope-eligible capacity. |
| Active / EHR-live provider-state | `v_provider_state_eligibility.allocation_eligible = true` | Drives confirmed vs tentative. |
| Active states | `state_activation` (is_active) | Only active states are routed; if unavailable, the router derives states from demand sources. |
| Daily state demand | Metabase card **3478** (`Telemedicine Demand Daily`) | Columns `date`, `state`, `demand_hours` or `target_hours`. Fallback → `demand_forecast` (daily) → `state_demand_targets`. |
| Daily booked appointments | Metabase card **3479** (`Daily Provider Booked Appointments`) | Columns `date`, `provider`, `state`, `appointment_count`, optional `booked_hours`. |
| Daily unique provider slots | Metabase card **3295** (`Daily Provider Utilization`) → `provider_utilization_daily` | Columns `Provider Full Name`, `Sum of Distinct values of Time Slot ID`, `Average of Utilization rate`. Used for the Slack access headline. |
| State same/next-day slots | Metabase card **2429** (`rpt_telemedicine_availability_by_state_per_day`) → `state_access_slots_daily` | Uses `same_next_day_booked_slots`, `same_next_day_available_slots`, and `same_next_day_total_slots`. State rows are displayed individually and are not summed. |
| Add candidates (outreach) | `schedule_submissions` (Jotform availability) + `provider_utilization_daily` | Used only to suggest add-hours for residual gaps. |

### ID spaces (important)

The daily router operates in the ClinOps **`providers.id`** space. Some legacy
columns are still named `profile_id` (`homebase_employees.profile_id`, routing
persistence tables, allocator payloads), but those values are provider IDs.
Jotform `schedule_submissions.provider_id` feeds add-hour suggestions directly;
older name-only rows fall back to normalized-name matching. These suggestions
never count as confirmed coverage.

---

## 4. Metabase card requirements

The two routing cards live on dashboard 280. Configure IDs via env vars on the
edge function; defaults shown.

| Env var | Default | Card |
|---|---|---|
| `METABASE_DAILY_DEMAND_CARD_ID` | `3478` | Telemedicine Demand Daily |
| `METABASE_DAILY_BOOKED_CARD_ID` | `3479` | Daily Provider Booked Appointments |

**Card 3478 — daily state demand.** One row per (date, state). Recognized
columns (case/space-insensitive): `date` (`Date`, `Day`, `date_actual: Day`),
`state` (`State`, `Appointment State`), and one of `demand_hours` /
`Target Hrs` / `Target Hours` / `hours`.

**Card 3479 — daily provider booked appointments.** One row per (date,
provider, state). Recognized columns: `date`, `provider` (`Provider Full Name`),
`state`, `appointment_count` (`Appointments`, `Count`), and optional
`booked_hours` (`Booked Hrs`). Provider names are matched to `providers.name`
using exact normalized name, `provider_name_mappings` aliases, canonical name
matching, then high-confidence fuzzy matching.

### Fallback behavior (launch-safe)

If card 3478 is missing or returns no rows for a (date, state), demand is
resolved in order:

1. **`daily_card`** — card 3478 value.
2. **`demand_forecast_fallback`** — `demand_forecast` daily baseline row
   (`date`, `state`, `projected_visits` = hours, `is_baseline = true`).
3. **`state_demand_targets_fallback`** — `state_demand_targets.daily_target_hours`
   for the month.
4. Otherwise → **NO DATA**.

If card 3479 is missing, there are simply no booked locks that day (the run
still completes). Missing Metabase credentials → demand uses fallbacks and no
booked locks.

### Supporting cards (context / diagnostics)

Synced by `sync-metabase` and used for the dashboard, state watchlists, and SLA
context: 2973 / 2971 / 2972 (service-line demand), 1415 (active members), 3287 /
2614 (utilization baselines), 2691 / 2457 (slot & appointment counts), 2957 /
2111 / 2440 / 2445 / 2474 / 2470 / 1178 / 2460 (diagnostics).

---

## 5. Allocation rules

Implemented in `src/lib/scheduling/dailyCoverageRouting.ts` (mirrored to
`supabase/functions/_shared/dailyCoverageRouting.ts`; unit-tested in
`src/test/dailyCoverageRouting.test.ts`).

**Confirmed usable coverage requires all of:** matched Homebase provider,
scheduled shift, active license, scope eligibility, and active/EHR-live
provider-state status.

**Tentative coverage** = licensed + scope-eligible but **not** confirmed
active/EHR-live. Tentative never counts toward status — it is the headroom if
those provider-states were activated.

**Scope (MD-only states):** `AL, IN, GA, MS, MO, SC, TN, LA` can only be
covered by physicians (MD/DO). Any provider may cover non-restricted states.
(This is the "who can see a patient today" rule — distinct from the month-ahead
evaluator's policy of reserving scarce MD capacity.)

**Order of operations:**

1. **Lock booked appointments first.** A matched + scheduled provider's booked
   appointments consume both their shift capacity **and** the state's demand
   before any free capacity is routed. `booked_hours` is used when present;
   otherwise `appointment_count × 0.5`. A booked appointment also marks that
   provider-state as confirmed (a real appointment is the strongest signal they
   are live there). Unmatched booked rows are recorded as **data-quality
   warnings** and are **not** locked to capacity or demand.
2. **Greedy confirmed allocation.** Remaining shift capacity is assigned:
   - Providers with **fewer eligible shortage states** go first (so a
     single-state provider isn't crowded out by a flexible one). Ordering is
     snapshotted from initial demand for determinism.
   - Each provider pours free hours into their **largest remaining confirmed
     gap** first, then the next, until exhausted.
   - Deterministic tie-breaks: state name, then provider name.
3. **Tentative upside** is computed per state as the free hours of
   tentatively-eligible scheduled providers, **capped at the remaining gap**.

**Recommendations:**

- **Moves** — already-scheduled providers' free capacity routed to shortage
  states (the confirmed assignments above).
- **Adds** — for residual gaps: tentatively-eligible scheduled providers
  (activate them), then Jotform-available providers not scheduled today, then
  licensed low-utilization providers.

---

## 6. Status

Status is driven by **confirmed coverage only** (booked locks + confirmed
assignments) versus demand:

| Status | Rule |
|---|---|
| 🟢 OK | confirmed ÷ demand ≥ 100% |
| 🟡 LOW | 50% ≤ confirmed ÷ demand < 100% |
| 🟠 CRITICAL | confirmed ÷ demand < 50% |
| 🔴 ZERO | confirmed coverage = 0 (demand > 0) |
| ⚪ NO DATA | no demand value from any source |

---

## 7. Reading the Slack digest

**Main post** — access-first. The headline states whether same/next-day access
is healthy, then shows unique booked slots, unique available slots, total unique
slots, and booked/available percentages. The state section shows lowest
availability and highest utilization by state using same/next-day state slots.
State rows are directional and non-additive.

**Thread:**

1. **Confirmed providers scheduled today** — each provider's scheduled hours,
   booked hours, routed states, and free hours.
2. **Provider utilization watchlist** — fully booked and nearly full providers
   from the unique provider-slot snapshot.
3. **State access by state** — full state table. Booked values are unique booked
   visits from the booked-appointments/routing feed; available values are
   state-level same/next-day open slots.
4. **Tomorrow preview** + **data-quality notes** when present.

If the unique provider-slot snapshot is missing, the bot may show routing
fallback detail. Treat that as temporary/debug output, not the access headline.

---

## 8. Manual rerun

Recompute the routing run (writes a fresh run):

```bash
curl -X POST \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  "https://bbquooftytwprllipcsb.supabase.co/functions/v1/compute-daily-coverage-routing" \
  --data '{"run_label":"manual"}'                       # today + tomorrow
  # --data '{"dates":["2026-06-02"]}'                   # specific date
  # --data '{"dry_run":true}'                           # compute, do not persist
```

Re-post the Slack digest:

```bash
curl -X POST .../functions/v1/send-ops-dashboard-slack --data '{}'                 # read latest fresh run
curl -X POST .../functions/v1/send-ops-dashboard-slack --data '{"recompute":true}' # force recompute first
curl -X POST .../functions/v1/send-ops-dashboard-slack --data '{"dry_run":true}'   # build blocks, do not post
curl -X POST .../functions/v1/send-ops-dashboard-slack --data '{"date":"2026-06-02"}'
```

The whole morning sequence can be triggered from GitHub Actions →
**ClinOps — Daily coverage routing** → _Run workflow_.

---

## 9. Worked examples

These mirror the unit tests in `src/test/dailyCoverageRouting.test.ts`, so they
stay true to actual engine behavior.

**A. Booked lock + greedy fill.** Provider scheduled 8h, licensed + EHR-live in
PA and NJ. 4 booked appointments in PA (no booked hours) → 4 × 0.5 = **2h**
locked to PA (demand and capacity). Demand PA 8h, NJ 8h. After the lock PA needs
6h more, NJ needs 8h; the provider's 6 free hours fill the **larger gap first**
(NJ): NJ gets 6h confirmed, PA stays at 2h confirmed. Result: PA gap 6h, NJ gap
2h.

**B. Tentative only.** Provider scheduled 6h, licensed in FL but **not**
EHR-live. FL demand 8h → confirmed coverage 0 → **ZERO**, with **+6h tentative
upside** and an "activate" add recommendation. Tentative never changes the
status.

**C. MD-only restriction.** GA demand 8h. An NP and an MD are both scheduled,
licensed, and EHR-live in GA. Only the MD's 5h counts (NP is scope-ineligible
in GA) → confirmed 5h, **LOW**, the only routed move is the MD.

**D. Constrained-first ordering.** PA and NJ each need 4h. A flexible provider
(PA+NJ, 4h) and a PA-only provider (4h) are scheduled. The PA-only provider
takes PA; the flexible provider fills NJ → both **OK**.

**E. Missing demand.** A state with no card value and no fallback → **NO DATA**
(null ratio), excluded from allocation but reported.

---

## 10. Known caveats

- **Unmatched Homebase employees** (shift with no `profile_id`) and **unmatched
  booked rows** (provider name not matched to a provider) are surfaced as
  data-quality warnings and **excluded** from confirmed capacity / demand. Fix
  the match in `provider_name_mappings` (Homebase) or the directory so they
  count next run.
- **Booked = confirmed.** A booked appointment marks the provider-state
  confirmed even if the active-state overlay hasn't caught up, because the
  appointment proves they are live there.
- **Tentative upside is non-exclusive potential**, capped at the per-state gap;
  it is not additive across states for the same provider.
- **Jotform availability adds** use `schedule_submissions.provider_id` when
  present; older name-only rows are best-effort suggestions only.
- **`types.ts` is stale for `demand_forecast` / `state_demand_targets`.** The
  canonical schema is whatever `compute-demand-forecast` writes (`date`,
  `state`, `projected_visits`, `is_baseline`; `daily_target_hours`). The router
  reads those columns directly.
- The legacy `state_leftover_slots` path is intentionally **not** used for
  routed decisions.
