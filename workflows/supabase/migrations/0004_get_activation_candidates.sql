-- Replaces the Lovable edge function. Given deficit states, returns up to N
-- ranked activation candidates per state: licensed, not yet activated, with
-- low utilization, filtered to the requested shift types.
--
-- Ranking (within each state):
--   1. Lowest current utilization (NULL → treated as 0, i.e. highest priority)
--   2. Readiness ('ready' before 'training' before 'paused')
--   3. Provider name (alphabetical, for stable ordering)

drop function if exists public.get_activation_candidates(text[], numeric, integer, text[]);

create or replace function public.get_activation_candidates(
  deficit_states     text[],
  util_threshold     numeric default 70,
  candidate_limit    integer default 5,
  shift_type_filter  text[] default array['NP Telemedicine','MD Telemedicine']
)
returns table (
  state                  text,
  provider_id            uuid,
  provider_name          text,
  email                  text,
  utilization_pct        numeric,
  data_source            text,
  readiness_status       text,
  ehr_activation_status  text,
  score                  numeric
)
language sql
stable
as $$
  with latest_util as (
    select distinct on (provider_id)
      provider_id,
      utilization_pct,
      data_source
    from public.provider_utilization_daily
    order by provider_id, date desc,
             case data_source when 'daily' then 1 else 2 end
  ),
  ranked as (
    select
      pl.state::text,
      p.id as provider_id,
      p.name as provider_name,
      p.email,
      lu.utilization_pct,
      lu.data_source,
      p.readiness_status,
      p.ehr_activation_status,
      (util_threshold - coalesce(lu.utilization_pct, 0))::numeric as score,
      row_number() over (
        partition by pl.state
        order by coalesce(lu.utilization_pct, 0) asc,
                 case p.readiness_status
                   when 'ready' then 1
                   when 'training' then 2
                   else 3
                 end,
                 p.name asc
      ) as rn
    from public.provider_licenses pl
    join public.providers p on p.id = pl.provider_id
    left join latest_util lu on lu.provider_id = p.id
    where pl.state = any(deficit_states)
      and pl.status = 'active'
      and p.active = true
      and p.ehr_activation_status <> 'active'
      and p.shift_types && shift_type_filter
      and (lu.utilization_pct is null or lu.utilization_pct <= util_threshold)
  )
  select
    state, provider_id, provider_name, email,
    utilization_pct, data_source, readiness_status,
    ehr_activation_status, score
  from ranked
  where rn <= candidate_limit
  order by state, rn;
$$;

comment on function public.get_activation_candidates is
  'Ranked activation candidates per deficit state. Defaults to telemedicine shift types (NP/MD).';
