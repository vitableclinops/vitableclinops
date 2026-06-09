create or replace function public.upsert_provider_pay_rate(
  p_provider_id uuid,
  p_hourly_rate numeric,
  p_effective_from date default current_date,
  p_role text default null,
  p_source text default 'manual_workbench'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_from date := coalesce(p_effective_from, current_date);
  v_role text := nullif(btrim(p_role), '');
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual_workbench');
begin
  if p_provider_id is null then
    raise exception 'Provider is required' using errcode = '22023';
  end if;

  if p_hourly_rate is null or p_hourly_rate < 0 then
    raise exception 'Hourly rate must be zero or greater' using errcode = '22023';
  end if;

  if not exists (select 1 from public.providers where id = p_provider_id) then
    raise exception 'Provider % not found', p_provider_id using errcode = 'P0002';
  end if;

  update public.provider_pay_rates
  set
    hourly_rate = round(p_hourly_rate, 2),
    effective_from = v_effective_from,
    effective_to = null,
    source = v_source
  where provider_id = p_provider_id
    and coalesce(role, '') = coalesce(v_role, '')
    and effective_to is null;

  if not found then
    insert into public.provider_pay_rates (
      provider_id,
      hourly_rate,
      role,
      effective_from,
      effective_to,
      source
    )
    values (
      p_provider_id,
      round(p_hourly_rate, 2),
      v_role,
      v_effective_from,
      null,
      v_source
    );
  end if;
end;
$$;

revoke all on function public.upsert_provider_pay_rate(uuid, numeric, date, text, text) from public;
grant execute on function public.upsert_provider_pay_rate(uuid, numeric, date, text, text) to anon, authenticated;
