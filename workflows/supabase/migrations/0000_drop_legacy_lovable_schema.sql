-- One-time reset. Drops the empty Lovable-style scaffolding that was in the
-- bbquooftytwprllipcsb project before workflows took it over (provider_id text,
-- denormalized state-coverage tables). Must run before 0001 if the project
-- has those tables; safe no-op otherwise.

drop table if exists public.provider_state_service_coverage cascade;
drop table if exists public.provider_contacts cascade;
drop table if exists public.provider_licensure cascade;
drop table if exists public.provider_state_activation cascade;
drop table if exists public.provider_services cascade;
drop table if exists public.providers cascade;
