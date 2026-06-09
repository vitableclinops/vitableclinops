drop view if exists public.v_monthly_demand;

alter table if exists public.demand_forecast
  alter column projected_visits type numeric(12,6)
  using projected_visits::numeric(12,6);

create view public.v_monthly_demand as
select
  state,
  date_trunc('month', date)::date as month,
  sum(projected_visits)::numeric as total_visits
from public.demand_forecast
where is_baseline = true
group by state, date_trunc('month', date)::date;

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
  target_rows as (
    select
      state,
      round(((adjusted_monthly_hours + enhanced_monthly_hours) / 2.0)::numeric, 2) as monthly_hours_target
    from midpoint_inputs
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
  )
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
  cross join month_weight w;

  update public.state_demand_targets
  set
    forecast_run_id = v_run_id,
    computed_at = v_computed_at
  where month = v_month
    and methodology_version = 'july_2026_midpoint_targets_v1';
end $$;
