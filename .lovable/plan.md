

## Threaded Action Plan: Surgical Reallocation Recommendations

Extend the daily ops Slack post with **threaded replies** that propose concrete activation / deactivation moves to close coverage gaps, plus a math check on whether those moves are sufficient.

### What you'll see in Slack

**Main post (unchanged)**: Daily coverage summary + suggested providers to ping.

**Reply #1 — "Actions to improve availability"**, posted in the same thread:
```
🛠 Suggested reallocation moves

🔴 DE — gap 12.0h
   ✅ Activate: Mandy Roe (license active, ready, +6h capacity once live)
   ✅ Activate: Tom Lee (license active, ready, +4h capacity)
   = projected +10h → still 2.0h short

🟡 OH (SURPLUS state)
   ➖ Deactivate: Kelsie Smith (12h allocated, 3h demand, frees 9h to redistribute)

📊 Net effect across critical/zero states
   Total gap before: 38.5h
   Total recoverable: 28.0h
   Result: ✅ 3 of 5 states resolved · ⚠️ 2 still short (DE -2h, NJ -8h)
```

**Reply #2 — "Next actions" (only posted if gaps remain)**:
```
📞 Gaps still open after reallocation — providers to contact directly

🔴 DE (still -2h)
   → Sarah Chen (working today 9a–5p CT, 4h surplus in NY)
   → Marcus Kim (BALANCED in TX, 2 appts today)

🔴 NJ (still -8h)
   → Lin Park (working today, SURPLUS in PA)
   → Dr. Patel (MD, BALANCED in MD)
```

### How it decides moves

For each `zero / critical / low` state, the engine produces three candidate move types:

1. **Activate**: provider has `provider_licenses.status='active'` + `provider_state_status.readiness_status='ready'` + `ehr_activation_status` in `('inactive','deactivated','activation_requested')`. Estimated capacity gain = their typical weekly hours / 5 (cap at gap size). Filters out NPs in the 8 MD-only states.

2. **Deactivate**: provider in a `SURPLUS` state today (`license_optimization_snapshots.quadrant='SURPLUS'`) with `slack = allocated_hours - estimated_demand_hours >= 3h`. These free up redistributable hours but don't directly fill the gap state — surfaced as context for "where to pull from."

3. **Ping** (already-active providers to contact today): the existing `outreach_candidates` logic, filtered to those `working_today` or with `current_state_status='SURPLUS'`.

**The math check** sums the projected capacity gain from activations against the total gap. If `recoverable >= gap`, marks state ✅ resolved. Otherwise computes residual gap, which drives Reply #2.

### Files to change

- `supabase/functions/compute-coverage-recommendations/index.ts`
  - Add `activation_recommendations[]`, `deactivation_recommendations[]`, `projected_gain_hours`, `residual_gap_hours` per state
  - New query: `provider_state_status` filtered to `readiness_status='ready'` and inactive `ehr_activation_status`, joined with active licenses
  - New query: snapshots where `quadrant='SURPLUS'` for deactivation candidates
  - Per-provider capacity estimate from `utilization_daily` average over last 14 days (or fallback default of 6h/day)

- `supabase/functions/send-ops-dashboard-slack/index.ts`
  - After main `chat.postMessage` succeeds, capture `data.ts` (already done)
  - Build "Reply #1" blocks from new recommendation fields → second `chat.postMessage` with `thread_ts: data.ts`
  - Compute residual gaps; if any > 0, build "Reply #2" blocks → third `chat.postMessage` with same `thread_ts`
  - Skip threaded replies entirely if no actionable moves exist (keeps the post clean on calm days)

### Configuration

- Capacity-gain estimate per activation: capped at min(provider's avg daily hours, state gap remaining) — prevents over-counting when one provider could "fill" multiple states
- Deactivation threshold: SURPLUS slack ≥ 3h (avoids noise from minor surpluses)
- Reply #2 only triggers when residual gap > 2h (rounding tolerance)

No new tables or schema changes. No migrations.

### Open question

When proposing **activations**, should the bot also auto-create an EHR activation task assigned to the compliance admin, or just suggest in Slack and require an admin to click through to the activation queue? Default in this plan: **suggest only**, no task creation — matches the existing "ping" pattern where admins confirm before action.

