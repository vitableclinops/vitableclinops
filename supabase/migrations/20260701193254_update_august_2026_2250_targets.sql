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

  with august_inputs(state, target_hours, target_slots, inactive) as (
    values
      ('PA', 810::numeric, 1620::integer, false),
      ('NJ', 208::numeric,  416::integer, false),
      ('TX', 165::numeric,  330::integer, false),
      ('FL', 165::numeric,  330::integer, false),
      ('DE', 150::numeric,  300::integer, false),
      ('OH',  93::numeric,  186::integer, false),
      ('VA',  68::numeric,  136::integer, false),
      ('WA',  66::numeric,  132::integer, false),
      ('IN',  64::numeric,  128::integer, false),
      ('MD',  54::numeric,  108::integer, false),
      ('IL',  40::numeric,   80::integer, false),
      ('GA',  36::numeric,   72::integer, false),
      ('CO',  36::numeric,   72::integer, false),
      ('NC',  32::numeric,   64::integer, false),
      ('MI',  32::numeric,   64::integer, false),
      ('CA',  29::numeric,   58::integer, false),
      ('AZ',  21::numeric,   42::integer, false),
      ('MN',  20::numeric,   40::integer, false),
      ('CT',  17::numeric,   34::integer, false),
      ('MA',  15::numeric,   30::integer, false),
      ('AL',  13::numeric,   26::integer, false),
      ('NH',  11::numeric,   22::integer, false),
      ('KY',  11::numeric,   22::integer, false),
      ('OR',  11::numeric,   22::integer, false),
      ('MO',   8::numeric,   16::integer, false),
      ('SC',   8::numeric,   16::integer, false),
      ('TN',   8::numeric,   16::integer, false),
      ('UT',   8::numeric,   16::integer, false),
      ('LA',   6::numeric,   12::integer, false),
      ('NM',   6::numeric,   12::integer, false),
      ('RI',   6::numeric,   12::integer, false),
      ('KS',   6::numeric,   12::integer, false),
      ('NY',   5::numeric,   10::integer, false),
      ('ME',   5::numeric,   10::integer, false),
      ('AK',   4::numeric,    8::integer, false),
      ('AR',   3::numeric,    6::integer, false),
      ('WV',   2::numeric,    4::integer, false),
      ('DC',   2::numeric,    4::integer, false),
      ('MS',   1::numeric,    2::integer, false),
      ('NV',   1::numeric,    2::integer, false),
      ('WI',   1::numeric,    2::integer, false),
      ('ID',   1::numeric,    2::integer, false),
      ('WY',   0::numeric,    0::integer, true),
      ('OK',   0::numeric,    0::integer, true),
      ('NE',   0::numeric,    0::integer, true)
  ),
  targets as (
    select
      i.state,
      v_month as month,
      round(i.target_hours)::integer as monthly_visits_target,
      greatest(0, round((i.target_hours / (31.0 / 7.0) / 6.0)::numeric)) as daily_target_slots,
      i.target_hours as monthly_hours_target,
      round((i.target_hours / (31.0 / 7.0))::numeric, 2) as raw_weekly_hours,
      round((i.target_hours / (31.0 / 7.0))::numeric, 2) as adjusted_weekly_hours,
      round((i.target_hours / (31.0 / 7.0) / 6.0)::numeric, 2) as daily_target_hours,
      i.target_hours as baseline_hours,
      i.target_hours as max_hours,
      i.target_slots,
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
    'august_2026_2250_state_targets_v2',
    1.0,
    1.0,
    v_run_id,
    v_computed_at,
    baseline_hours,
    max_hours,
    inactive,
    'Trailing Apr + May + projected Jun appointments allocated to a 2,250 provider-hour / 4,500-slot August target. June 2026 estimated; update when actuals close.'
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
