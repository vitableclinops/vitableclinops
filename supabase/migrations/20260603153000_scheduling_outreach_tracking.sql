create extension if not exists pgcrypto;

alter table if exists public.providers
  add column if not exists scheduling_outreach_exempt boolean not null default false,
  add column if not exists scheduling_outreach_exemption_reason text;

update public.providers
set
  scheduling_outreach_exempt = true,
  scheduling_outreach_exemption_reason = coalesce(
    nullif(scheduling_outreach_exemption_reason, ''),
    'Admin-only provider; not expected to submit monthly scheduling availability.'
  )
where lower(name) in ('kate baron', 'seth dinowitz');

create table if not exists public.provider_outreach_log (
  id              uuid primary key default gen_random_uuid(),
  provider_id     uuid references public.providers(id) on delete set null,
  provider_name   text not null,
  provider_email  text,
  target_month    date not null,
  outreach_type   text not null default 'missing_availability',
  status          text not null default 'sent' check (status in ('sent', 'drafted', 'bounced', 'skipped')),
  channel         text not null default 'email',
  subject         text,
  body            text,
  batch_id        uuid,
  sent_at         timestamptz not null default now(),
  sent_by         uuid,
  sent_by_label   text,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists provider_outreach_log_month_idx
  on public.provider_outreach_log (target_month, outreach_type, sent_at desc);
create index if not exists provider_outreach_log_provider_idx
  on public.provider_outreach_log (provider_id, target_month, sent_at desc);
create index if not exists providers_scheduling_outreach_exempt_idx
  on public.providers (scheduling_outreach_exempt)
  where scheduling_outreach_exempt = true;

alter table public.provider_outreach_log enable row level security;

drop policy if exists "provider_outreach_log ui read" on public.provider_outreach_log;
create policy "provider_outreach_log ui read" on public.provider_outreach_log
  for select to anon, authenticated using (true);

drop policy if exists "provider_outreach_log ui write" on public.provider_outreach_log;
create policy "provider_outreach_log ui write" on public.provider_outreach_log
  for all to anon, authenticated using (true) with check (true);
