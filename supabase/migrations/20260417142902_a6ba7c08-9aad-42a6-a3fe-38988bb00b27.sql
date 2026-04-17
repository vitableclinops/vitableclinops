ALTER TABLE public.state_sla_attainment 
  ADD COLUMN IF NOT EXISTS imported_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS window_start date,
  ADD COLUMN IF NOT EXISTS window_end date;

ALTER TABLE public.demand_forecast 
  ADD COLUMN IF NOT EXISTS imported_at timestamptz NOT NULL DEFAULT now();