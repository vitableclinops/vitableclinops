ALTER TABLE public.state_leftover_slots
  ADD COLUMN IF NOT EXISTS imported_at timestamptz NOT NULL DEFAULT now();