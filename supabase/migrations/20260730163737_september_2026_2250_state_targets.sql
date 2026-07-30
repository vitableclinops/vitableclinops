create extension if not exists pgcrypto;

alter table public.state_demand_targets
  add column if not exists baseline_hours_target numeric(8,2),
  add column if not exists max_hours_target numeric(8,2),
  add column if not exists inactive boolean not null default false,
  add column if not exists demand_source_note text;

do $$
declare
  v_month date := date '2026-09-01';
  v_run_id uuid := gen_random_uuid();
  v_computed_at timestamptz := now();
begin
  update public.demand_forecast
  set is_baseline = false
  where is_baseline = true
    and date >= v_month
    and date < (v_month + interval '1 month')::date;

  with september_inputs(state, target_hours, inactive) as (
    values
      ('PA', 778.5::numeric, false),
      ('NJ', 199.0::numeric, false),
      ('TX', 170.5::numeric, false),
      ('FL', 170.5::numeric, false),
      ('DE', 138.5::numeric, false),
      ('OH',  98.5::numeric, false),
      ('VA',  81.0::numeric, false),
      ('WA',  67.5::numeric, false),
      ('MD',  60.5::numeric, false),
      ('IN',  59.0::numeric, false),
      ('GA',  43.0::numeric, false),
      ('IL',  41.0::numeric, false),
      ('CO',  38.0::numeric, false),
      ('NC',  35.5::numeric, false),
      ('MI',  34.0::numeric, false),
      ('CA',  31.0::numeric, false),
      ('AZ',  22.0::numeric, false),
      ('MN',  18.5::numeric, false),
      ('KY',  16.5::numeric, false),
      ('MA',  15.5::numeric, false),
      ('CT',  15.0::numeric, false),
      ('NH',  13.0::numeric, false),
      ('AL',  12.0::numeric, false),
      ('OR',  10.0::numeric, false),
      ('LA',   8.5::numeric, false),
      ('MO',   7.5::numeric, false),
      ('SC',   7.5::numeric, false),
      ('TN',   7.0::numeric, false),
      ('NY',   7.0::numeric, false),
      ('UT',   6.5::numeric, false),
      ('RI',   5.5::numeric, false),
      ('NM',   5.0::numeric, false),
      ('AK',   4.5::numeric, false),
      ('KS',   4.5::numeric, false),
      ('ME',   3.5::numeric, false),
      ('AR',   3.0::numeric, false),
      ('NE',   2.5::numeric, false),
      ('WV',   2.0::numeric, false),
      ('NV',   2.0::numeric, false),
      ('WI',   1.5::numeric, false),
      ('MS',   1.0::numeric, false),
      ('DC',   1.0::numeric, false),
      ('WY',   0.5::numeric, false),
      ('OK',   0.5::numeric, false),
      ('ID',   0.5::numeric, false)
  ),
  targets as (
    select
      i.state,
      v_month as month,
      round(i.target_hours)::integer as monthly_visits_target,
      greatest(0, round((i.target_hours / (30.0 / 7.0) / 6.0)::numeric)) as daily_target_slots,
      i.target_hours as monthly_hours_target,
      round((i.target_hours / (30.0 / 7.0))::numeric, 2) as raw_weekly_hours,
      round((i.target_hours / (30.0 / 7.0))::numeric, 2) as adjusted_weekly_hours,
      round((i.target_hours / (30.0 / 7.0) / 6.0)::numeric, 2) as daily_target_hours,
      i.target_hours as baseline_hours,
      i.target_hours as max_hours,
      i.inactive
    from september_inputs i
  ),
  month_days as (
    select
      d::date as date,
      case when extract(dow from d::date) in (0, 6) then 0.5::numeric else 1.0::numeric end as day_weight
    from generate_series(
      v_month,
      (v_month + interval '1 month - 1 day')::date,
      interval '1 day'
    ) as d
  ),
  month_weight as (
    select sum(day_weight) as total_weight
    from month_days
  ),
  inserted_forecast as (
    insert into public.demand_forecast (
      date,
      state,
      projected_visits,
      forecast_run_id,
      is_baseline,
      computed_at
    )
    select
      d.date,
      t.state,
      round((t.monthly_hours_target * d.day_weight / w.total_weight)::numeric, 6) as projected_visits,
      v_run_id,
      true,
      v_computed_at
    from targets t
    cross join month_days d
    cross join month_weight w
    returning 1
  )
  insert into public.state_demand_targets (
    state,
    month,
    monthly_visits_target,
    daily_target_slots,
    monthly_hours_target,
    raw_weekly_hours,
    adjusted_weekly_hours,
    daily_target_hours,
    active_members,
    methodology_version,
    seasonal_multiplier,
    growth_multiplier,
    forecast_run_id,
    computed_at,
    baseline_hours_target,
    max_hours_target,
    inactive,
    demand_source_note
  )
  select
    state,
    month,
    monthly_visits_target,
    daily_target_slots,
    monthly_hours_target,
    raw_weekly_hours,
    adjusted_weekly_hours,
    daily_target_hours,
    null,
    'september_2026_2250_state_targets_v1',
    1.0,
    1.0,
    v_run_id,
    v_computed_at,
    baseline_hours,
    max_hours,
    inactive,
    'V3 member-based trailing actuals (Apr-Jun 2026) allocated to a 2,250 provider-hour September target per the frozen September 2026 build handoff. No per-state SLA floor applied; qualitative accommodation layer excluded.'
  from targets
  on conflict (state, month) do update
  set
    monthly_visits_target = excluded.monthly_visits_target,
    daily_target_slots = excluded.daily_target_slots,
    monthly_hours_target = excluded.monthly_hours_target,
    raw_weekly_hours = excluded.raw_weekly_hours,
    adjusted_weekly_hours = excluded.adjusted_weekly_hours,
    daily_target_hours = excluded.daily_target_hours,
    methodology_version = excluded.methodology_version,
    seasonal_multiplier = excluded.seasonal_multiplier,
    growth_multiplier = excluded.growth_multiplier,
    forecast_run_id = excluded.forecast_run_id,
    computed_at = excluded.computed_at,
    baseline_hours_target = excluded.baseline_hours_target,
    max_hours_target = excluded.max_hours_target,
    inactive = excluded.inactive,
    demand_source_note = excluded.demand_source_note;
end $$;
