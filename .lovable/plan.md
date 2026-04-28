## What's actually wrong

The Mandy / May 1 answer is incorrect for two independent reasons:

**Bug A — Provider mode silently has no demand data, so every gap looks like zero.**
Provider mode only loads `demand_forecast` rows for `week_start = getMonday(date)`. For May 1, that's `2026-04-27`, but the database only has forecast rows for weeks `2026-04-13` and `2026-04-20`. Result: `forecastByState` is empty, every state gets `target_slots = null`, no gap can ever be computed, and `total_network_gap_hours_in_eligible_states` shows 0. Network mode already handles this with a "fall back to most recent forecast week" path; provider mode doesn't.

**Bug B — Misleading "active in 44 states" label.**
The fact `active_state_count` is computed as `eligible_to_practice && state_activation.is_active` — i.e. *the state is in our network*, not *Amanda is EHR-active in that state*. Amanda has zero `provider_state_status` rows so she isn't EHR-active anywhere. The AI parrots "active in 44 states" and concludes she's all set, when really the right framing is "licensed in 45 network states, EHR-active in 0 of them."

Net effect today: provider mode reports zero gap and zero activation opportunities → AI declines → user (correctly) doesn't trust it because network mode shows 75.9h of gap on the same date with PA / NJ / TX leading.

## Fix plan

### 1. Mirror network mode's forecast fallback in provider mode
In `supabase/functions/coverage-copilot/index.ts`, after the existing `demand_forecast` load (around line 255), if the result is empty, run the same fallback the network function uses (lines ~640–655):

- Query `demand_forecast` ordered by `week_start desc limit 200`.
- Take the most recent `week_start`, build a per-state map from those rows.
- Use it as the source for `forecastByState`.
- Record the fallback week (e.g. `forecast_source: "fallback from week 2026-04-20"`) on the facts object so the AI and the plain-English narrative can mention it and lower confidence.

### 2. Split "active" into two honest counts
Keep `currently_active` on `stateFacts` (it correctly means "state is in the network"), but rename and add fields on the top-level `facts`:

- `licensed_state_count` → states where she's licensed AND legally eligible (replaces today's `eligible_state_count`, same value, clearer name).
- `network_state_count` → of those, states where `state_activation.is_active = true` (replaces today's misleading `active_state_count`).
- `ehr_active_state_count` → of those, states where `provider_state_status.ehr_activation_status = 'active'`.
- `ehr_active_states` → array of the actual abbreviations, so the AI can name them.

Update the plain-English narrative to read like:
> "Amanda Clement is licensed in 45 network state(s) where she can legally practice, but EHR-active in only 0 of them. Hours can only be approved in EHR-active states without an activation step."

### 3. Tighten the synth system prompt
- Make the AI distinguish "licensed", "in network", and "EHR-active" using the new fields.
- When `ehr_active_state_count = 0`, the only path to approval is conditional activation — never claim she's "ready to take hours" off licensure alone.
- When `forecast_source` indicates a fallback was used, include a sentence noting the forecast week used and lower confidence to medium.

### 4. Sanity-check the resulting facts against network mode
After the fix, for the Mandy / May 1 case the provider-mode facts should show:
- `licensed_state_count`: 45, `network_state_count`: 44, `ehr_active_state_count`: 0
- `forecast_source`: fallback from week 2026-04-20
- `total_network_gap_hours_in_eligible_states` ≈ 75.9 (matches network mode)
- `activation_opportunities` populated with PA (29.2h), TX (7.7h), NJ (5.7h), DE, OH, etc. — exactly the states the user expected.
- The AI summary becomes a conditional yes: "Yes, but only if we activate her in PA / NJ / TX — gaps are preliminary, expect them to shrink."

### 5. Update the data-freshness memory note
`mem://features/coverage-copilot-data-freshness` should mention that provider mode now uses the same forecast fallback as network mode, so the two answers stay in sync.

## Out of scope
- No schema changes; no new triggers; no UI changes to `CoverageCopilotPage.tsx` (the JSON facts panel will simply show the corrected/renamed fields).
- Not touching the `SLOTS_PER_HOUR` mismatch with `compute-coverage-bridge` (that's a separate rounding question).

## Files to edit
- `supabase/functions/coverage-copilot/index.ts` — provider-mode fact assembly, plain-English narrative, synth system prompt.
- `mem://features/coverage-copilot-data-freshness` — note the fallback parity.
