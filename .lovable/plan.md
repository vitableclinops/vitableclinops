

## Targeted Outreach + Reallocation Recommendations

Turn the daily ops Slack post into an action engine: identify which specific providers to ping for under-supplied states, surface license-reallocation moves, and (optionally) email those providers directly.

---

### 1. New Slack section: "Recommended actions"

Append two blocks to the existing daily ops post (`send-ops-dashboard-slack`):

**A. Fill the gap — outreach candidates**
For each CRITICAL / ZERO state, find providers who:
- Hold an `active` license in that state, AND
- Have low utilization OR surplus in another state today (from `license_optimization_snapshots`)

Output:
```
🔴 PA — needs ~12 hrs (3 slots vs target 15)
   → Ping: Jane Doe (active PA license, 4hr surplus in NY today)
            Mark Smith (active PA license, BALANCED in OH)
   [Send outreach emails]
```

**B. Reallocate — license moves**
Cross-reference SURPLUS states with DEFICIT states:
- Providers with 4+ surplus licenses → flag for non-renewal in surplus state
- DEFICIT states with no licensed providers → recommend new applications, suggest 1–2 candidates from SURPLUS markets

Output:
```
♻️ Reallocation moves
   • Drop: Jane Doe — CA license (6th surplus license, low utilization)
   • Apply: 2 NPs in OH → MI (DEFICIT, 0 active licensees)
```

Each line links to the relevant provider/state page.

---

### 2. One-click outreach (optional button)

Add an interactive Slack button `[Send outreach emails]` per state that triggers a new edge function `send-coverage-outreach`:

- Pulls candidate providers (same logic as above)
- Sends a templated email via the existing `send-notification-email` function with subject *"Extra availability needed in {state} this week"* and body explaining the gap, target hours, and a CTA to open shifts in Homebase
- Logs each send to a new `coverage_outreach_log` table (provider_id, state, sent_at, gap_hours, sent_by) so we don't spam the same provider twice within 7 days

Cooldown: skip any provider already emailed for that state in the last 7 days.

---

### 3. Recommendation engine (shared logic)

New edge function `compute-coverage-recommendations` (called by both the Slack post and the outreach button):

Inputs: today's `license_optimization_snapshots`, `provider_licenses`, `profiles` (email + name), `state_leftover_slots`, SLA buffer from `system_config`.

Outputs per state:
```ts
{
  state, gap_hours, status,
  outreach_candidates: [{ profile_id, name, email, current_state_status, surplus_hours }],
  drop_recommendations: [{ profile_id, state, reason }],
  apply_recommendations: [{ state, candidate_profile_ids, rationale }]
}
```

Ranking rules:
- Outreach candidates ranked by: (1) currently SURPLUS in another state, (2) BALANCED, (3) lowest utilization
- Cap at top 3 candidates per state in Slack to keep the post readable
- Skip NP-prohibited states (existing `isNPProhibitedState` constant)

This same engine powers a new **"Recommended Actions"** card on `/admin/ops` and `/admin/license-optimizer` — single source of truth across Slack, dashboards, and email.

---

### 4. Schema additions

```sql
-- Track outreach to enforce 7-day cooldown and audit history
create table coverage_outreach_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),
  state_abbreviation text not null,
  gap_hours numeric,
  sent_at timestamptz default now(),
  sent_by uuid references profiles(id),
  channel text default 'email', -- 'email' | 'slack'
  email_message_id text
);
create index on coverage_outreach_log (profile_id, state_abbreviation, sent_at desc);
```

---

### Technical details

**Files to add/edit:**
- `supabase/functions/compute-coverage-recommendations/index.ts` — new shared engine
- `supabase/functions/send-coverage-outreach/index.ts` — new; reads recs, sends emails, logs to `coverage_outreach_log`
- `supabase/functions/send-ops-dashboard-slack/index.ts` — call recs engine, append two new Slack blocks, add `actions` block with state-scoped outreach buttons
- `supabase/functions/send-notification-email/index.ts` — add new `coverage_outreach` email type
- `src/pages/OpsDashboardPage.tsx` + `LicenseOptimizerPage.tsx` — new "Recommended Actions" card consuming the engine
- New migration: `coverage_outreach_log` table + RLS (admins manage, service role full access)

**Slack interactivity caveat:** Slack interactive buttons require a public webhook endpoint to receive button clicks. Two options:
1. **Simple (recommended for MVP):** Buttons link to `/admin/ops?action=outreach&state=PA` — opens the dashboard with a pre-filled confirmation modal. No Slack webhook setup needed.
2. **Full interactive:** Add a `slack-interactivity-handler` edge function and configure it as the request URL in the Slack app. Heavier setup.

I recommend option 1 for now — keeps it within the existing connector and gives admins a chance to review before sending.

**Cooldown enforcement** lives in `send-coverage-outreach` (query `coverage_outreach_log` for last 7 days before sending).

**Currently 69 active providers with email** — sufficient pool for outreach.

---

### Questions before I build

1. **Outreach send mode** — should the daily Slack post auto-trigger emails to candidate providers, or should it only *suggest* candidates and require an admin to click "Send" from the dashboard? (Recommendation: suggest-only, admin confirms.)
2. **Email-from identity** — send from a generic `ops@vitable…` or from the admin who clicked the button?
3. **Reallocation aggressiveness** — flag a license for "drop" after how many surplus states? Default 4, but you may want stricter (3) or looser (5).

