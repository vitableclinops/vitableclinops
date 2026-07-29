alter table public.sla_daily
  drop constraint if exists sla_daily_daily_target_check,
  add constraint sla_daily_daily_target_check check (daily_target >= 2);

alter table public.state_demand_targets
  drop constraint if exists state_demand_targets_daily_target_slots_check,
  add constraint state_demand_targets_daily_target_slots_check check (daily_target_slots >= 2);
