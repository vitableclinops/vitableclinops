# Vitable ClinOps — Scheduling Decision Contract

This document defines the canonical questions the scheduling system must answer, the data source for each, where the answer is stored, and the recommendations produced. Every scheduling-related job, dashboard, Slack message, and schedule-builder output must trace back to a question in this contract.

Owners: ClinOps. Implementing repos: `vitableclinops` (UI + schema) and `clinops-workflows` (jobs).

---

## Daily Questions

Run every morning at 7am ET.

### Q1. Who is working today, when, and for how long?
- **Source:** Homebase API
- **Storage:** `shifts` (Supabase)
- **Fields:** `provider_id`, `date`, `start_time`, `end_time`, `hours`, `role`

### Q2. Where is each working provider licensed?
- **Source:** Supabase (manually maintained, seeded from existing licensure records and Jotform onboarding)
- **Storage:** `provider_licensure` (table already defined in migrations; needs backfill)
- **Fields:** `provider_id`, `state`, `license_type`, `status`, `expires_at`

### Q3. Where is each provider currently active?
- **Source:** Metabase — provider × state matrix table (`1` = active in that state, blank = not active)
- **Storage:** `provider_state_active` (Supabase)
- **Fields:** `provider_id`, `state`, `is_active`, `synced_at`

### Q4. What is each provider's utilization?
- **Cadence:** *Not daily.* Providers don't all work every day, so daily utilization is noisy.
- **Metrics:** rolling **max over past 7 days** + **average over past 30 days**
- **Source:** Metabase
- **Storage:** `utilization_summary` (Supabase)
- **Fields:** `provider_id`, `week_max_pct`, `month_avg_pct`, `computed_at`

### Q5. Which states are meeting same-day and next-day SLA?
- **Source:** Metabase
- **Storage:** `sla_daily` (Supabase)
- **Fields:** `date`, `state`, `available_slots`, `daily_target`, `ratio`, `sla_pct`, `status`, `sla_flagged`
- **Status calculation** (canonical — also encoded in `workflows/src/prompts/daily_availability_prompt.py`):
  ```
  daily_demand = monthly_completed_visits / 20      # 20 working days/month
  daily_target = max(5, daily_demand * 1.5)         # 50% wiggle room, floor of 5
  ratio        = available_slots / daily_target
  ```
- **Buckets:**
  - `critical` — `ratio < 1.0` (shortfall)
  - `low` — `1.0 ≤ ratio < 2.0` (covered, thin buffer)
  - `ok` — `ratio ≥ 2.0` (well-covered)
  - `zero` / `no_data` — used when `available_slots == 0` or Metabase data missing
- **SLA flag:** independent of bucket. `sla_flagged = True` when `sla_pct < 85%` (Metabase card 2931, MTD).

### Q6. What is the daily demand per state per date?
- **Source:** Metabase forecast (and/or Claude-computed forecast)
- **Storage:** `demand_forecast` (table already in migrations; needs to be applied + populated)
- **Fields:** `date`, `state`, `projected_visits`, `target_slots`

---

## Calculated Questions

Computed by `clinops-workflows` from the data above. No new external sources.

### Q7. Which (date, state) combos are in surplus vs. shortage?
- **Computation:** scheduled capacity (Q1 ∩ Q2 ∩ Q3) vs. demand (Q6).
- **Storage:** `coverage_gaps_daily` (Supabase)
- **Fields:** `date`, `state`, `scheduled_capacity`, `projected_demand`, `gap` (signed), `status`.

### Q8. What should we do to make the schedule more efficient?

Three sub-questions, written to `recommendations_daily`:

- **Q8a — Licensure adjustments.** For shortage states, identify low-utilization providers who could be licensed there. Output: `(provider, state, projected_gap_closure, current_utilization)`.
- **Q8b — Providers to reach out to for more hours.** Providers in licensed shortage-states with low Q4 utilization and capacity to take more. Output: ranked list with current hours, suggested additional hours, target dates.
- **Q8c — Hours to accept (Jotform).** For each pending Jotform submission, decide accept / partial / decline based on whether their hours close a Q7 gap without creating surplus.

---

## Monthly / Ongoing Questions

### M1. Monthly schedule building (e.g., June)

**Inputs:**
- Projected by-state demand forecast for the month (Q6 extended; uses the `demand-forecast` skill in `/demand-forecast/SKILL.md`)
- Provider hour requests for the month from Jotform
- Provider licensure (Q2)
- Where each provider is currently active (Q3)
- Provider pay rates (`provider_pay_rates`)
- Provider utilization is measured for visibility/outreach only; it is not part of default monthly ranking unless explicitly enabled.

**Two-sided objective:**
- **Lower bound:** cover projected demand with wiggle room (target = `monthly_visits/20 × 1.5`, floor 5 slots/day per state).
- **Upper bound:** stay under cost-per-visit ceiling. **Target: <$60/visit. Current state: well above target.**
- Overshooting inflates cost-per-visit by paying for unused capacity; undershooting hurts member experience and SLA. Optimize for the smallest provider footprint that still keeps every state at `ratio ≥ 1.5` on the daily SLA bucket.
- **Equity guardrails:** Validated clinical lead/admin hours are accepted in full before demand trimming, hourly rate is the next routing signal, and DirectShifts/access should land near 15% of accepted telehealth appointment volume when eligible supply exists; same-rate DirectShifts/access providers should receive similar accepted percentages of submitted forecastable hours; non-clinical providers hit a 75% submitted-hours soft cap before additional hours are routed to them. Genevieve Teetie, Shanta Williams, and Rebecca Keuch are explicit clinical lead/admin overrides even when source metadata does not carry that label.

**Outputs (per provider):**
- `accepted_hours` — subset of their Jotform submission we approve
- `declined_hours` — submission hours we decline (would create surplus)
- `state_assignment` — which state(s) the accepted hours serve

**Outputs (network-level):**
- `hire_to_fill` — states where even accepting all submitted hours leaves a demand gap (signal for hiring)
- `cuts_required` — states/dates where we have to decline otherwise-willing hours
- `state_deactivations` — providers currently active in states where demand can be covered without them, freeing them to focus on licensure-constrained states
- `projected_cost_per_visit` — per state and network-level, given the proposed schedule
- `equity_audit` — DirectShifts/access share, same-rate spread, provider acceptance percentage, soft-cap state, and no-zero floor outcome.

**August 2026 exception:** August uses a documented 2,250-hour / 4,500-slot flat per-state target, removes the DirectShifts percentage-share target, and applies the DirectShifts NP 60-hour floor / 80-hour target rule. See `docs/august-2026-forecast-rationale.md`.

### M2. Licensure investment plan (quarterly)

Which `(provider, state)` license additions would have produced the largest historical SLA improvement (per Q5 history)? Output ranked list to guide credentialing investment.

---

## Outputs / Surfaces

| Surface | Where | What it shows |
|---|---|---|
| Daily ops dashboard | Lovable `/admin/scheduling` (new) | Q1, Q5, Q7, Q8 (today + 7-day) |
| Question bot | Lovable | Natural-language access to Q1–Q8, M1, M2 |
| Efficiency monitor | Lovable | Historical view of recommendation acceptance vs. SLA outcome |
| Slack daily digest | `clinops-workflows` → Slack | State coverage map (met/critical/low/zero/no_data), per-state visit count ("1/2 required visits in MO"), Q8 top recommendations. **Existing report; extend rather than replace.** |
| Schedule builder | Notion or Sheet (TBD) | M1 output: per-provider accepted/declined hours for the month |

---

## Required Supabase Tables

Already defined in migrations (need to be re-applied to the new project):
- `providers`, `provider_licensure`, `provider_services`, `provider_state_activation`, `provider_state_service_coverage`
- `demand_forecast`, `utilization_daily` (will be replaced/augmented by `utilization_summary`)

Need to add:
- `shifts` — Homebase daily sync
- `provider_state_active` — Metabase daily sync (replaces `provider_state_activation` if redundant — TBD)
- `utilization_summary` — Metabase rollup (week_max + month_avg)
- `sla_daily` — Metabase daily sync
- `coverage_gaps_daily` — calculated
- `provider_pay_rates` — Metabase or manual
- `state_demand_targets` — manual SLA visit targets per state
- `schedule_submissions` — Jotform webhook
- `recommendations_daily` — calculated (Q8a/b/c)
- `recommendations_monthly` — calculated (M1/M2)

---

## Constants and constraints

These were open questions during drafting and have been resolved. Encode in code, not interpretation.

| Setting | Value | Source / rationale |
|---|---|---|
| Daily slot target formula | `max(5, monthly_visits/20 × 1.5)` | `workflows/src/prompts/daily_availability_prompt.py` |
| Daily slot wiggle room | **50%** (the 1.5× multiplier) | Same |
| Daily slot floor | 5 slots/day per state | Same |
| SLA bucket: critical | ratio < 1.0 | Same |
| SLA bucket: low | 1.0 ≤ ratio < 2.0 | Same |
| SLA bucket: ok | ratio ≥ 2.0 | Same |
| SLA flag threshold | `sla_pct < 85%` (MTD) | Same |
| Monthly demand growth buffer | 15–30% (per market, by recent trend) | `demand-forecast` skill |
| Cost-per-visit target | **<$60** (currently above target) | Maddi |
| `state_demand_targets` cadence | **Derived monthly from forecast**, refreshed at the start of each month | Maddi |
| `state_demand_targets` ownership | Computed by `demand-forecast` skill output → written to Supabase | Maddi |
