-- Jotform monthly availability submissions. Written by the availability-sync
-- job (Jotform -> Notion -> here), then decided on by the M1 scheduling
-- pass.

create table if not exists public.schedule_submissions (
  id                       uuid primary key default gen_random_uuid(),
  jotform_submission_id    text not null unique,
  provider_id              uuid references public.providers(id) on delete set null,
  provider_name            text not null,
  target_month             date not null,
  raw_answers              jsonb not null,
  parsed_shifts            jsonb,
  submitted_at             timestamptz not null,
  decision_status          text not null default 'pending'
    check (decision_status in ('pending','accepted','partial','declined')),
  accepted_hours           numeric(6,2) check (accepted_hours is null or accepted_hours >= 0),
  declined_hours           numeric(6,2) check (declined_hours is null or declined_hours >= 0),
  decision_notes           text,
  decided_at               timestamptz,
  decision_run_id          uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists schedule_submissions_target_month_idx
  on public.schedule_submissions (target_month);
create index if not exists schedule_submissions_status_idx
  on public.schedule_submissions (decision_status, target_month);
create index if not exists schedule_submissions_provider_idx
  on public.schedule_submissions (provider_id);

drop trigger if exists schedule_submissions_updated_at on public.schedule_submissions;
create trigger schedule_submissions_updated_at
  before update on public.schedule_submissions
  for each row execute function public.set_updated_at();
