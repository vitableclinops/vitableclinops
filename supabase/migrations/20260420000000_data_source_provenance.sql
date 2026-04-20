-- ─────────────────────────────────────────────────────────────────────────────
-- Data-source provenance for utilization tables
--
-- Why: `provider_utilization` and `utilization_daily` can be populated by
-- either the daily `sync-metabase` edge function OR by manual CSV upload via
-- `import-provider-utilization` / `import-utilization-daily`. Until now both
-- paths wrote indistinguishable rows, so a stale manual upload could silently
-- override the scheduled sync — and the Utilization page had no way to tell
-- ops "this data was last synced X hours ago."
--
-- This migration adds a `source` tag and a `synced_at` timestamp so the two
-- paths can coexist transparently and the UI can surface freshness.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.provider_utilization
  add column if not exists source text
    check (source in ('metabase_sync', 'csv_manual'))
    default 'csv_manual',
  add column if not exists synced_at timestamptz;

alter table public.utilization_daily
  add column if not exists source text
    check (source in ('metabase_sync', 'csv_manual'))
    default 'csv_manual',
  add column if not exists synced_at timestamptz;

-- Backfill: existing rows predate the tag. Assume manual CSV and mirror
-- imported_at into synced_at so "last synced" queries work retroactively.
update public.provider_utilization
   set source    = coalesce(source, 'csv_manual'),
       synced_at = coalesce(synced_at, imported_at)
 where source is null or synced_at is null;

update public.utilization_daily
   set source    = coalesce(source, 'csv_manual'),
       synced_at = coalesce(synced_at, imported_at)
 where source is null or synced_at is null;

create index if not exists idx_provider_utilization_synced_at
  on public.provider_utilization(synced_at desc);

create index if not exists idx_utilization_daily_synced_at
  on public.utilization_daily(synced_at desc);
