-- =====================================================================
-- sla_tier_by_state
--
-- Single source of truth for state-level visit-availability service
-- levels. Until now these rules lived in Notion prose and were
-- re-hardcoded in at least seven places across this repo and the
-- warehouse (see the MD-only state list duplicated in
-- src/constants/stateRestrictions.ts, src/lib/scheduling/coverage.ts,
-- src/lib/scheduling/dailyCoverageRouting.ts,
-- supabase/functions/_shared/dailyCoverageRouting.ts,
-- supabase/functions/evaluate-schedule-submissions/index.ts,
-- supabase/functions/same-next-day-coverage-alert/index.ts, and the
-- `md_only` VALUES clause in Metabase question 3951).
--
-- The rules are effective-dated so a past alert can be explained with
-- the thresholds that were live when it fired, rather than the ones
-- that happen to be live today.
--
-- SOURCES (all three agree; seeded values are transcribed, not derived)
--   1. Notion, "Same-Day / Next-Day Visit Availability SLA Policy",
--      effective 2026-09-02, ClinOps Hub / ClinOps Protocols. Declares
--      itself "the source of truth for state-level visit-availability
--      service types."
--   2. "Communication regarding SD/ND SLA change" (Google Doc) - tier
--      visit minimums: Tier 1 = 5 visits (VA: 2), Tier 2 = 2 visits
--      excluding same-day, Tier 3 = N/A.
--   3. Metabase question 3951, whose inline `tier` and `md_only`
--      VALUES clauses match 1 and 2 exactly.
--
-- COLUMN NOTES
--   horizon_days       Last day of the counting window, relative to the
--                      request date. same_day tiers use 1, not 0: the
--                      policy's visit minimum of 5 is counted "across
--                      same-day and next-day", while the same-day floor
--                      below enforces that today specifically is covered.
--   min_slots_window   Slots required across the whole horizon. Null for
--                      within_48h, where the policy sets no minimum.
--   min_slots_sameday  Separate floor on TODAY. Only same_day states
--                      have one; the policy requires "at least one
--                      eligible visit ... on the same calendar day".
--                      Null for next_day, which is explicitly
--                      "excluding same-day".
--
-- These seeded minimums are the current POLICY floors. They are known to
-- run below observed demand in the larger states - question 3951 puts
-- PA's p90 of same/next-day demand at 31 against a policy floor of 5.
-- Moving to the derived thresholds is a data change in this table, not a
-- code change, which is the reason this is a table at all.
-- =====================================================================

create table if not exists public.sla_tier_by_state (
  id                uuid primary key default gen_random_uuid(),
  state             text    not null,
  sla_tier          text    not null check (sla_tier in ('same_day', 'next_day', 'within_48h')),
  horizon_days      int     not null check (horizon_days between 0 and 2),
  physician_only    boolean not null default false,
  min_slots_window  int     check (min_slots_window is null or min_slots_window >= 0),
  min_slots_sameday int     check (min_slots_sameday is null or min_slots_sameday >= 0),
  effective_from    date    not null,
  effective_to      date,
  source            text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sla_tier_by_state_state_format check (state ~ '^[A-Z]{2}$'),
  constraint sla_tier_by_state_effective_range check (effective_to is null or effective_to > effective_from),
  constraint sla_tier_by_state_state_effective_from_key unique (state, effective_from)
);

comment on table public.sla_tier_by_state is
  'Effective-dated state-level visit-availability SLA rules. Source of truth transcribed from the Notion SD/ND SLA Policy; read this instead of hardcoding tier or physician-only state lists.';
comment on column public.sla_tier_by_state.horizon_days is
  'Last day of the counting window relative to request date. same_day uses 1 (minimum counted across today+tomorrow) with min_slots_sameday enforcing today.';
comment on column public.sla_tier_by_state.min_slots_window is
  'Policy floor on open slots across the horizon. Null where the policy sets no minimum (within_48h).';
comment on column public.sla_tier_by_state.min_slots_sameday is
  'Policy floor on open slots TODAY. Set only for same_day states; next_day is explicitly "excluding same-day".';

-- Only one row per state may be open-ended, so "the rule in force now" is
-- never ambiguous.
create unique index if not exists sla_tier_by_state_one_current_per_state_idx
  on public.sla_tier_by_state (state)
  where effective_to is null;

create index if not exists sla_tier_by_state_tier_idx
  on public.sla_tier_by_state (sla_tier)
  where effective_to is null;

create index if not exists sla_tier_by_state_physician_only_idx
  on public.sla_tier_by_state (state)
  where effective_to is null and physician_only;

-- ---------------------------------------------------------------------
-- Seed: Notion SD/ND SLA Policy, effective 2026-09-02
-- 7 same-day + 5 next-day + 39 within-48h = 51 jurisdictions (50 states + DC)
-- ---------------------------------------------------------------------
insert into public.sla_tier_by_state
  (state, sla_tier, horizon_days, physician_only, min_slots_window, min_slots_sameday, effective_from, source)
values
  -- Tier 1 - same-day. Visit minimum 5 across same-day + next-day, VA 2.
  ('NJ', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('PA', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('FL', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('OH', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('TX', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('VA', 'same_day',   1, false, 2,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('DE', 'same_day',   1, false, 5,    1,    '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),

  -- Tier 2 - next-day. Visit minimum 2, excluding same-day.
  ('IL', 'next_day',   1, false, 2,    null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('WA', 'next_day',   1, false, 2,    null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MD', 'next_day',   1, false, 2,    null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('IN', 'next_day',   1, true,  2,    null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('GA', 'next_day',   1, true,  2,    null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),

  -- Tier 3 - within 48 hours. No policy visit minimum.
  ('AL', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('AK', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('AZ', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('AR', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('CA', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('CO', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('CT', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('DC', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('HI', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('ID', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('IA', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('KS', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('KY', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('LA', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('ME', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MA', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MI', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MN', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MS', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MO', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('MT', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NE', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NV', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NH', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NM', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NY', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('NC', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('ND', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('OK', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('OR', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('RI', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('SC', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('SD', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('TN', 'within_48h', 2, true,  null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('UT', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('VT', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('WV', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('WI', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02'),
  ('WY', 'within_48h', 2, false, null, null, '2026-09-02', 'notion:sd-nd-sla-policy-2026-09-02')
on conflict (state, effective_from) do nothing;

-- ---------------------------------------------------------------------
-- Convenience view: the rule in force today
-- ---------------------------------------------------------------------
create or replace view public.sla_tier_by_state_current
with (security_invoker = true) as
select
  state,
  sla_tier,
  horizon_days,
  physician_only,
  min_slots_window,
  min_slots_sameday,
  effective_from,
  source
from public.sla_tier_by_state
where effective_from <= current_date
  and (effective_to is null or effective_to > current_date);

comment on view public.sla_tier_by_state_current is
  'The SLA rule in force today for each state. Prefer this over querying sla_tier_by_state directly.';

-- ---------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------
create or replace function public.set_sla_tier_by_state_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sla_tier_by_state_set_updated_at on public.sla_tier_by_state;
create trigger sla_tier_by_state_set_updated_at
  before update on public.sla_tier_by_state
  for each row
  execute function public.set_sla_tier_by_state_updated_at();

-- ---------------------------------------------------------------------
-- RLS: readable by any authenticated user, writable only by service_role.
-- Mirrors public.coverage_alerts. These are operating rules, not PHI, and
-- every dashboard needs to read them; changes go through migrations or
-- an admin path running as service_role.
-- ---------------------------------------------------------------------
alter table public.sla_tier_by_state enable row level security;

revoke all on public.sla_tier_by_state from anon;
grant select on public.sla_tier_by_state to authenticated;
grant all on public.sla_tier_by_state to service_role;

revoke all on public.sla_tier_by_state_current from anon;
grant select on public.sla_tier_by_state_current to authenticated;
grant select on public.sla_tier_by_state_current to service_role;

drop policy if exists "sla_tier_by_state authenticated read" on public.sla_tier_by_state;
create policy "sla_tier_by_state authenticated read"
  on public.sla_tier_by_state
  for select
  to authenticated
  using (true);
