-- Recommendations produced by the daily and monthly scheduling passes.
--
-- Daily (Q8 from the contract): three categories
--   licensure_add     — providers who could be licensed in shortage states
--   reach_out         — providers who could take more hours
--   jotform_decision  — accept/partial/decline for pending submissions
--
-- Monthly (M1, M2 from the contract): six categories
--   schedule_decisions    — per-Jotform-submission accept/partial/decline
--   hire_to_fill          — states where supply can't meet demand
--   cuts                  — submissions/states we have to decline
--   deactivations         — providers to deactivate in lower-need states
--   licensure_investment  — quarterly ranked credentialing list (M2)
--   cost_per_visit        — projected, by state and network-level
--
-- payload is a JSONB blob whose shape varies by category. Documenting the
-- shapes in code (the workflow that writes/reads them) rather than locking
-- them into columns — recommendations evolve faster than schemas.

create table if not exists public.recommendations_daily (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  category        text not null
    check (category in ('licensure_add','reach_out','jotform_decision','other')),
  payload         jsonb not null,
  computed_at     timestamptz not null default now()
);

create index if not exists recommendations_daily_date_idx
  on public.recommendations_daily (date desc);
create index if not exists recommendations_daily_category_idx
  on public.recommendations_daily (category, date desc);

create table if not exists public.recommendations_monthly (
  id              uuid primary key default gen_random_uuid(),
  month           date not null,
  forecast_run_id uuid,
  category        text not null
    check (category in ('schedule_decisions','hire_to_fill','cuts','deactivations','licensure_investment','cost_per_visit','other')),
  payload         jsonb not null,
  computed_at     timestamptz not null default now()
);

create index if not exists recommendations_monthly_month_idx
  on public.recommendations_monthly (month desc);
create index if not exists recommendations_monthly_run_idx
  on public.recommendations_monthly (forecast_run_id);
create index if not exists recommendations_monthly_category_idx
  on public.recommendations_monthly (category, month desc);
