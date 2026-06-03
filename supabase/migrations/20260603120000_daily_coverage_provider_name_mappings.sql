-- Seed known provider-name aliases used by Homebase and Metabase daily
-- coverage cards. Values in profile_id are ClinOps providers.id.

with desired(homebase_name, provider_name) as (
  values
    ('Akosua Norgbey', 'Akosua'),
    ('Dorcas Omari', 'Dr. Dorcas Omari'),
    ('Margo Mulgrew', 'Margaret Mulgrew'),
    ('Ramon Trinidad', 'Ramon Trinidad III'),
    ('Rickeena Free', 'Rickeenna Free'),
    ('Van Tu', 'Van Tu'),
    ('Van Tu, CRNP', 'Van Tu')
),
resolved as (
  select
    d.homebase_name,
    p.id as profile_id
  from desired d
  join public.providers p
    on p.name = d.provider_name
)
insert into public.provider_name_mappings (homebase_name, profile_id)
select r.homebase_name, r.profile_id
from resolved r
where not exists (
  select 1
  from public.provider_name_mappings existing
  where lower(existing.homebase_name) = lower(r.homebase_name)
);
