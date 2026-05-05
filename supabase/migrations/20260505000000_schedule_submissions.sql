-- schedule_submissions
-- Captures provider scheduling requests pulled from Jotform form 252224341308043.
-- The sync-jotform-submissions edge function ingests raw submissions; the
-- evaluate-schedule-submissions edge function fills the recommendation columns
-- by joining against demand_forecast and current coverage.

create table if not exists public.schedule_submissions (
  id uuid primary key default gen_random_uuid(),

  -- Source identity (idempotency key)
  jotform_submission_id text not null unique,
  jotform_form_id text not null,
  submitted_at timestamptz not null,

  -- Provider matching
  provider_profile_id uuid references public.profiles(id) on delete set null,
  provider_name_raw text,
  provider_email_raw text,
  match_confidence text check (
    match_confidence in ('email','manual','name_exact','name_fuzzy','unmatched')
  ),

  -- Parsed schedule fields
  week_start date,
  requested_hours_total numeric,
  requested_states text[] default '{}',
  requested_shifts jsonb,

  -- Always preserve the original payload for re-parsing
  raw_payload jsonb not null,

  -- Recommendation (filled by evaluate-schedule-submissions)
  recommendation_status text not null default 'pending'
    check (recommendation_status in ('pending','approve','partial','decline','overridden')),
  recommended_hours numeric,
  recommended_states text[],
  recommendation_notes text,
  evaluated_at timestamptz,

  -- Manual override
  override_status text check (override_status in ('approve','partial','decline')),
  override_hours numeric,
  override_by uuid references auth.users(id) on delete set null,
  override_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_submissions_week_idx
  on public.schedule_submissions (week_start);
create index if not exists schedule_submissions_provider_idx
  on public.schedule_submissions (provider_profile_id);
create index if not exists schedule_submissions_status_idx
  on public.schedule_submissions (recommendation_status);
create index if not exists schedule_submissions_submitted_idx
  on public.schedule_submissions (submitted_at desc);

-- updated_at trigger
create or replace function public.tg_schedule_submissions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schedule_submissions_updated_at on public.schedule_submissions;
create trigger schedule_submissions_updated_at
  before update on public.schedule_submissions
  for each row execute function public.tg_schedule_submissions_updated_at();

-- RLS
alter table public.schedule_submissions enable row level security;

create policy "Admins and pod leads can read schedule submissions"
  on public.schedule_submissions for select
  to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or has_role(auth.uid(), 'pod_lead'::app_role)
  );

create policy "Admins can manage schedule submissions"
  on public.schedule_submissions for all
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Providers can read their own submissions"
  on public.schedule_submissions for select
  to authenticated
  using (provider_profile_id = auth.uid());
