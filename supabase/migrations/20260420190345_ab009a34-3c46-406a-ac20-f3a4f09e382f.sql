-- Remove older duplicates, keeping the most recently imported row per (provider_name, window_start)
DELETE FROM public.provider_utilization a
USING public.provider_utilization b
WHERE a.provider_name = b.provider_name
  AND a.window_start = b.window_start
  AND a.imported_at < b.imported_at;

-- Tie-break any remaining same-imported_at duplicates by id
DELETE FROM public.provider_utilization a
USING public.provider_utilization b
WHERE a.provider_name = b.provider_name
  AND a.window_start = b.window_start
  AND a.id < b.id;

ALTER TABLE public.provider_utilization
  ADD CONSTRAINT provider_utilization_name_window_unique
  UNIQUE (provider_name, window_start);