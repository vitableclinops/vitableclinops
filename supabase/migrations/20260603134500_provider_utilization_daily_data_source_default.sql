-- Preserve the existing provider_utilization_daily data_source contract.
-- The source-specific label lives in the newer `source` column.

alter table public.provider_utilization_daily
  alter column data_source set default 'daily';
