-- Where each provider is currently active (i.e., seeing patients in that state).
-- Source: Metabase provider x state matrix (1 = active, blank = not).
-- Distinct from provider_state_activation (Lovable's credentialing-flow table).

create table if not exists public.provider_state_active (
  provider_id   uuid not null references public.providers(id) on delete cascade,
  state         text not null,
  is_active     boolean not null default true,
  synced_at     timestamptz not null default now(),
  primary key (provider_id, state)
);

create index if not exists provider_state_active_state_idx
  on public.provider_state_active (state) where is_active = true;
