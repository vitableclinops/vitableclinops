create or replace function public.set_provider_scheduling_exception(
  p_provider_id uuid,
  p_scheduling_outreach_exempt boolean,
  p_scheduling_outreach_exemption_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.providers
  set
    scheduling_outreach_exempt = coalesce(p_scheduling_outreach_exempt, false),
    scheduling_outreach_exemption_reason = case
      when coalesce(p_scheduling_outreach_exempt, false)
        then nullif(btrim(p_scheduling_outreach_exemption_reason), '')
      else null
    end,
    updated_at = now()
  where id = p_provider_id;

  if not found then
    raise exception 'Provider % not found', p_provider_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_provider_scheduling_exception(uuid, boolean, text) from public;
grant execute on function public.set_provider_scheduling_exception(uuid, boolean, text) to anon, authenticated;
