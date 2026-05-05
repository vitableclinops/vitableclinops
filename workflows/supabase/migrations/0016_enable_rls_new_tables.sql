-- Lock all new tables to service_role only. The workflow jobs use the
-- service_role key (server-side); the Lovable frontend reads Supabase
-- separately and doesn't touch these workflow tables yet.
-- Same posture as 0005_enable_rls.sql.

alter table public.shifts                    enable row level security;
alter table public.provider_state_active     enable row level security;
alter table public.utilization_summary       enable row level security;
alter table public.sla_daily                 enable row level security;
alter table public.demand_forecast           enable row level security;
alter table public.state_demand_targets      enable row level security;
alter table public.coverage_gaps_daily       enable row level security;
alter table public.provider_pay_rates        enable row level security;
alter table public.schedule_submissions      enable row level security;
alter table public.recommendations_daily     enable row level security;
alter table public.recommendations_monthly   enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'shifts','provider_state_active','utilization_summary','sla_daily',
    'demand_forecast','state_demand_targets','coverage_gaps_daily',
    'provider_pay_rates','schedule_submissions',
    'recommendations_daily','recommendations_monthly'
  ])
  loop
    execute format('drop policy if exists "no anon access" on public.%I', t);
    execute format(
      'create policy "no anon access" on public.%I for all to anon, authenticated using (false) with check (false)',
      t
    );
  end loop;
end $$;
