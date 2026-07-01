create extension if not exists pgcrypto;

alter table public.state_demand_targets
  add column if not exists baseline_hours_target numeric(8,2),
  add column if not exists max_hours_target numeric(8,2),
  add column if not exists inactive boolean not null default false,
  add column if not exists demand_source_note text;

do $$
declare
  v_month date := date '2026-08-01';
  v_run_id uuid := gen_random_uuid();
  v_computed_at timestamptz := now();
begin
  update public.demand_forecast
  set is_baseline = false
  where is_baseline = true
    and date >= v_month
    and date < (v_month + interval '1 month')::date;

  with august_inputs(state, baseline_hours, max_hours, inactive) as (
    values
      ('PA', 429::numeric, 504::numeric, false),
      ('NJ', 110::numeric, 130::numeric, false),
      ('TX',  87::numeric, 102::numeric, false),
      ('FL',  88::numeric, 103::numeric, false),
      ('DE',  79::numeric,  93::numeric, false),
      ('OH',  49::numeric,  58::numeric, false),
      ('VA',  36::numeric,  42::numeric, false),
      ('WA',  35::numeric,  41::numeric, false),
      ('IN',  34::numeric,  40::numeric, false),
      ('MD',  29::numeric,  34::numeric, false),
      ('IL',  21::numeric,  25::numeric, false),
      ('GA',  19::numeric,  23::numeric, false),
      ('CO',  19::numeric,  23::numeric, false),
      ('NC',  17::numeric,  20::numeric, false),
      ('MI',  17::numeric,  20::numeric, false),
      ('CA',  15::numeric,  18::numeric, false),
      ('AZ',  11::numeric,  13::numeric, false),
      ('MN',  10::numeric,  12::numeric, false),
      ('CT',   9::numeric,  11::numeric, false),
      ('MA',   8::numeric,  10::numeric, false),
      ('AL',   7::numeric,   8::numeric, false),
      ('NH',   6::numeric,   7::numeric, false),
      ('KY',   6::numeric,   7::numeric, false),
      ('OR',   6::numeric,   7::numeric, false),
      ('MO',   4::numeric,   5::numeric, false),
      ('SC',   4::numeric,   5::numeric, false),
      ('TN',   4::numeric,   5::numeric, false),
      ('UT',   4::numeric,   5::numeric, false),
      ('LA',   3::numeric,   4::numeric, false),
      ('NM',   3::numeric,   4::numeric, false),
      ('RI',   3::numeric,   4::numeric, false),
      ('KS',   3::numeric,   4::numeric, false),
      ('NY',   3::numeric,   3::numeric, false),
      ('ME',   2::numeric,   3::numeric, false),
      ('AK',   2::numeric,   2::numeric, false),
      ('AR',   2::numeric,   2::numeric, false),
      ('WV',   1::numeric,   1::numeric, false),
      ('DC',   1::numeric,   1::numeric, false),
      ('MS',   0::numeric,   1::numeric, false),
      ('NV',   0::numeric,   1::numeric, false),
      ('WI',   0::numeric,   1::numeric, false),
      ('ID',   0::numeric,   1::numeric, false),
      ('WY',   0::numeric,   0::numeric, true),
      ('OK',   0::numeric,   0::numeric, true),
      ('NE',   0::numeric,   0::numeric, true)
  ),
  targets as (
    select
      i.state,
      v_month as month,
      round(i.max_hours)::integer as monthly_visits_target,
      greatest(0, round((i.max_hours / (31.0 / 7.0) / 6.0)::numeric)) as daily_target_slots,
      i.max_hours as monthly_hours_target,
      round((i.baseline_hours / (31.0 / 7.0))::numeric, 2) as raw_weekly_hours,
      round((i.max_hours / (31.0 / 7.0))::numeric, 2) as adjusted_weekly_hours,
      round((i.max_hours / (31.0 / 7.0) / 6.0)::numeric, 2) as daily_target_hours,
      i.baseline_hours,
      i.max_hours,
      i.inactive
    from august_inputs i
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
    'august_2026_trailing_actuals_state_max_v1',
    1.0,
    1.175,
    v_run_id,
    v_computed_at,
    baseline_hours,
    max_hours,
    inactive,
    'Trailing Apr + May + projected Jun appointments with 17.5% flat buffer. June 2026 estimated; update when actuals close.'
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
