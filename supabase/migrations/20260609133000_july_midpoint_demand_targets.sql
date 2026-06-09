create extension if not exists pgcrypto;

-- July 2026 scheduling now uses the midpoint between the adjusted and enhanced
-- demand scenarios as the final monthly target. Keep the scenario inputs here
-- so the stored targets can be audited back to the leadership request.
do $$
declare
  v_month date := date '2026-07-01';
  v_run_id uuid := gen_random_uuid();
  v_computed_at timestamptz := now();
begin
  update public.demand_forecast
  set is_baseline = false
  where is_baseline = true
    and date >= v_month
    and date < (v_month + interval '1 month')::date;

  with midpoint_inputs(state, cohort, adjusted_monthly_hours, enhanced_monthly_hours) as (
    values
      ('AK', '021', 14.6::numeric, 18.5::numeric),
      ('AL', 'MD-Only', 12.2::numeric, 15.4::numeric),
      ('AR', '021', 9.8::numeric, 12.3::numeric),
      ('AZ', '021', 19.5::numeric, 24.6::numeric),
      ('CA', '021', 34.2::numeric, 43.1::numeric),
      ('CO', '021', 36.6::numeric, 46.2::numeric),
      ('CT', '021', 19.5::numeric, 24.6::numeric),
      ('DC', 'DMV', 2.4::numeric, 3.1::numeric),
      ('DE', 'DE', 146.4::numeric, 184.6::numeric),
      ('FL', 'Growth', 129.3::numeric, 163.1::numeric),
      ('GA', 'MD-Only', 48.8::numeric, 61.5::numeric),
      ('IA', '021', 0.0::numeric, 0.0::numeric),
      ('IL', '021', 46.4::numeric, 58.5::numeric),
      ('IN', 'MD-Only', 65.9::numeric, 83.1::numeric),
      ('KS', '021', 7.3::numeric, 9.2::numeric),
      ('KY', '021', 17.1::numeric, 21.5::numeric),
      ('LA', '021', 7.3::numeric, 9.2::numeric),
      ('MA', '021', 12.2::numeric, 15.4::numeric),
      ('MD', 'DMV', 56.1::numeric, 70.8::numeric),
      ('ME', '021', 7.3::numeric, 9.2::numeric),
      ('MI', '021', 36.6::numeric, 46.2::numeric),
      ('MN', '021', 17.1::numeric, 21.5::numeric),
      ('MO', 'MD-Only', 14.6::numeric, 18.5::numeric),
      ('MS', 'MD-Only', 7.3::numeric, 9.2::numeric),
      ('NC', '021', 41.5::numeric, 52.3::numeric),
      ('NE', '021', 0.0::numeric, 0.0::numeric),
      ('NH', '021', 19.5::numeric, 24.6::numeric),
      ('NJ', 'Core', 175.7::numeric, 221.6::numeric),
      ('NM', '021', 14.6::numeric, 18.5::numeric),
      ('NV', '021', 2.4::numeric, 3.1::numeric),
      ('NY', '021', 7.3::numeric, 9.2::numeric),
      ('OH', 'Growth', 107.4::numeric, 135.4::numeric),
      ('OK', '021', 4.9::numeric, 6.2::numeric),
      ('OR', '021', 12.2::numeric, 15.4::numeric),
      ('PA', 'Core', 751.6::numeric, 947.8::numeric),
      ('RI', '021', 12.2::numeric, 15.4::numeric),
      ('SC', 'MD-Only', 7.3::numeric, 9.2::numeric),
      ('TN', 'MD-Only', 14.6::numeric, 18.5::numeric),
      ('TX', 'Growth', 185.5::numeric, 233.9::numeric),
      ('UT', '021', 9.8::numeric, 12.3::numeric),
      ('VA', 'DMV', 87.8::numeric, 110.8::numeric),
      ('VT', '021', 0.0::numeric, 0.0::numeric),
      ('WA', '021', 83.0::numeric, 104.6::numeric),
      ('WI', '021', 4.9::numeric, 6.2::numeric),
      ('WV', '021', 2.4::numeric, 3.1::numeric),
      ('WY', '021', 2.4::numeric, 3.1::numeric)
  ),
  midpoint_targets as (
    select
      state,
      cohort,
      adjusted_monthly_hours,
      enhanced_monthly_hours,
      round(((adjusted_monthly_hours + enhanced_monthly_hours) / 2.0)::numeric, 2) as midpoint_monthly_hours,
      (extract(day from (date_trunc('month', v_month)::date + interval '1 month - 1 day'))::numeric / 7.0) as month_weeks
    from midpoint_inputs
  ),
  existing_targets as (
    select state, active_members
    from public.state_demand_targets
    where month = v_month
  ),
  target_rows as (
    select
      m.state,
      v_month as month,
      round(m.midpoint_monthly_hours)::integer as monthly_visits_target,
      m.midpoint_monthly_hours as monthly_hours_target,
      greatest(5, round((m.midpoint_monthly_hours / m.month_weeks / 6.0)::numeric)) as daily_target_slots,
      round((m.adjusted_monthly_hours / m.month_weeks / 0.95)::numeric, 2) as raw_weekly_hours,
      round((m.midpoint_monthly_hours / m.month_weeks)::numeric, 2) as adjusted_weekly_hours,
      round((m.midpoint_monthly_hours / m.month_weeks / 6.0)::numeric, 2) as daily_target_hours,
      e.active_members,
      'july_2026_midpoint_targets_v1' as methodology_version,
      0.95::numeric as seasonal_multiplier,
      1.0::numeric as growth_multiplier,
      v_run_id as forecast_run_id,
      v_computed_at as computed_at
    from midpoint_targets m
    left join existing_targets e using (state)
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
    from target_rows t
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
    computed_at
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
    active_members,
    methodology_version,
    seasonal_multiplier,
    growth_multiplier,
    forecast_run_id,
    computed_at
  from target_rows
  on conflict (state, month) do update
  set
    monthly_visits_target = excluded.monthly_visits_target,
    daily_target_slots = excluded.daily_target_slots,
    monthly_hours_target = excluded.monthly_hours_target,
    raw_weekly_hours = excluded.raw_weekly_hours,
    adjusted_weekly_hours = excluded.adjusted_weekly_hours,
    daily_target_hours = excluded.daily_target_hours,
    active_members = coalesce(public.state_demand_targets.active_members, excluded.active_members),
    methodology_version = excluded.methodology_version,
    seasonal_multiplier = excluded.seasonal_multiplier,
    growth_multiplier = excluded.growth_multiplier,
    forecast_run_id = excluded.forecast_run_id,
    computed_at = excluded.computed_at;
end $$;
