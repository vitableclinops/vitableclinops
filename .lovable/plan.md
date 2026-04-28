
## Goal

Build a single page where Maddi (or anyone) can paste a Slack-style question and get a structured, actionable answer:

> *"Hi @Maddi, Amanda/Mandy wants to work additional hours on May 1st from 10am-5pm EST. Do we need her hours?"*

→

> **Recommendation:** Approve 4 of 7 hours (10am–2pm EST).
> **Why:** TX is 5h short that day and Mandy is licensed/active there. After 2pm EST, surplus appears in FL where she's also licensed.
> **Conditional:** *Yes, IF you activate her in TX first* (she's ready, EHR active). Or *No, unless you deactivate her in CA first* (CA has surplus that day).

## How it works

A new page `/admin/coverage-copilot` with one chat-style input. On submit, an edge function:
1. Uses Lovable AI (Gemini) to parse the question into structured params: provider name, date, time window, timezone.
2. Resolves the provider via existing name normalization → `profiles.id`.
3. Pulls the same data the Ops Dashboard already uses for that date: shifts, licenses, state activation, demand forecast, leftover slots, SLA targets, and the provider's current state allocations.
4. Computes per-state gap/surplus for the requested window (reusing logic from `compute-coverage-recommendations`).
5. Sends the **structured facts** (not raw rows) back to Lovable AI with a strict tool-calling schema to produce the final recommendation.
6. Returns a JSON answer the UI renders as labeled sections, plus a "View raw data" expander.

The AI never invents numbers — it only narrates the precomputed facts. All math lives in the edge function.

## Page layout

```text
┌─ Coverage Copilot ──────────────────────────────────────────────┐
│ Ask anything about provider coverage and shift approvals        │
│                                                                 │
│ [ Mandy wants extra hours May 1, 10am-5pm EST...        ] [Ask] │
│                                                                 │
│ ── Recommendation ──                                            │
│  ✅ Approve 4 of 7 hours                                        │
│  Suggested window: 10am–2pm EST                                 │
│                                                                 │
│ ── Why ──                                                       │
│  • TX short 5h that day; Mandy licensed + active                │
│  • After 2pm EST, FL has surplus where she could shift          │
│                                                                 │
│ ── Conditional answers ──                                       │
│  • YES, if you activate her in TX (she is EHR-ready)            │
│  • NO, unless you deactivate her from CA (3h surplus there)     │
│                                                                 │
│ ── Facts used ──  [ expand ]                                    │
└─────────────────────────────────────────────────────────────────┘
```

A small history list under the input keeps the last ~10 questions for the session (no DB persistence in v1).

## Scope (v1)

In:
- One page, admin-only, accessible from the Ops/Admin sidebar group.
- Single-turn questions (no follow-up threading).
- Questions about a **single provider on a single date / time window**.
- Returns: recommended hours to approve, suggested time window, reasons, and conditional activate/deactivate suggestions.
- Uses already-computed data sources (Homebase shifts, licenses, state activation, demand forecast, leftover slots, SLA targets, provider readiness).

Out (v2+):
- Multi-provider / "who should I ask?" questions (already covered by existing CoverageRecommendationsCard).
- Multi-day questions ("the whole week of...").
- Persistent conversation history across sessions.
- Slack ingestion / auto-reply.

## Technical details

**New edge function `coverage-copilot`** (Lovable AI Gateway, Gemini 3 Flash):
- Input: `{ question: string }`.
- Step A — extraction: tool-calling with schema `{ provider_query, date (YYYY-MM-DD), start_local, end_local, timezone, intent ('approve_extra_hours'|'general') }`. If extraction fails, return a clarifying question.
- Step B — resolve provider via `homebase_employees.normalized_name` ⇒ `profile_id` (fuzzy match; if multiple, return disambiguation list).
- Step C — gather facts:
  - Provider's existing shifts that day (`homebase_shifts`)
  - Provider's active licenses (`provider_licenses`) and EHR/readiness status (`profiles`, `provider_readiness`)
  - Active states (`state_activation`)
  - Per-state gap/surplus for the date: reuse the math from `compute-coverage-recommendations` — extract it into `_shared/coverageMath.ts` so both functions share it.
  - Per-state surplus where this provider is currently allocated (deactivation candidates).
  - States where this provider is licensed but not active (activation candidates).
- Step D — synthesis: call Lovable AI again with strict tool schema:
  ```
  { recommendation: 'approve_full' | 'approve_partial' | 'decline',
    approved_hours: number,
    suggested_window: { start_local, end_local } | null,
    reasons: string[],
    conditional_yes: { action: 'activate', state, reason }[],
    conditional_no:  { action: 'deactivate', state, reason }[],
    confidence: 'high'|'medium'|'low' }
  ```
- Returns both the structured answer and a `facts` payload the UI shows in the expander.

**Frontend `src/pages/CoverageCopilotPage.tsx`**:
- Standard `AppSidebar` layout with `ml-0 sm:ml-16 lg:ml-64`.
- Single textarea + submit; renders structured response into labeled cards.
- TanStack Query mutation to `supabase.functions.invoke('coverage-copilot', { body: { question } })`.
- Surface 402/429 errors with toasts (per Lovable AI guidance).

**Routing**: add `/admin/coverage-copilot` in `src/App.tsx` behind `ProtectedRoute` with `requiredRoles=['admin']`. Add a sidebar entry in the Ops group.

**Refactor**: extract the shared per-state gap/surplus computation from `compute-coverage-recommendations/index.ts` into `supabase/functions/_shared/coverageMath.ts` so the new function reuses identical logic. Keep current behavior unchanged.

**No schema changes** — uses existing tables (`homebase_shifts`, `homebase_employees`, `profiles`, `provider_licenses`, `state_activation`, `demand_forecast`, `state_leftover_slots`, `state_sla_attainment`, `provider_readiness`).

## Open questions

I'd like to confirm a couple of things before building:

1. **Default timezone** for time windows in questions when not specified — assume EST/ET, or America/Chicago (matches the existing ops dashboard)?
2. **Provider name matching** — if the AI extracts an ambiguous name (e.g. "Mandy" matches two people), should the copilot return a "did you mean…" picker, or just refuse?
3. **Where does it live in the sidebar** — a new "Coverage Copilot" item in the Ops group, or embedded as a tab on the existing Ops Dashboard?
