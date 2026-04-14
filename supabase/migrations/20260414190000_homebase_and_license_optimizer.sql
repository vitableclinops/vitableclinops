-- Homebase API integration + License Optimizer tables
-- Branch: claude/homebase-api-integration

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. homebase_locations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.homebase_locations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_uuid text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  address_1     text,
  address_2     text,
  city          text,
  state         text,        -- 2-letter abbreviation
  zip           text,
  time_zone     text,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.homebase_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage homebase_locations" ON public.homebase_locations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view homebase_locations" ON public.homebase_locations
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_homebase_locations_updated_at
  BEFORE UPDATE ON public.homebase_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. homebase_employees
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.homebase_employees (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_id        bigint      NOT NULL UNIQUE,  -- integer id from Homebase API
  location_homebase_uuid text    REFERENCES public.homebase_locations(homebase_uuid) ON DELETE SET NULL,
  email              text,
  first_name         text,
  last_name          text,
  normalized_name    text,       -- canonical key: "lastname firstname" lowercased, no credentials
  profile_id         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_confidence   text        DEFAULT 'unmatched',  -- 'email' | 'name_exact' | 'name_fuzzy' | 'manual' | 'unmatched'
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_homebase_employees_profile   ON public.homebase_employees(profile_id);
CREATE INDEX idx_homebase_employees_email     ON public.homebase_employees(email);
CREATE INDEX idx_homebase_employees_norm_name ON public.homebase_employees(normalized_name);

ALTER TABLE public.homebase_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage homebase_employees" ON public.homebase_employees
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view homebase_employees" ON public.homebase_employees
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_homebase_employees_updated_at
  BEFORE UPDATE ON public.homebase_employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. homebase_shifts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.homebase_shifts (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_id            bigint      NOT NULL UNIQUE,
  homebase_user_id       bigint,     -- user_id from Homebase shift payload
  homebase_employee_id   uuid        REFERENCES public.homebase_employees(id) ON DELETE SET NULL,
  location_homebase_uuid text        REFERENCES public.homebase_locations(homebase_uuid) ON DELETE SET NULL,
  role                   text,
  department             text,
  start_at               timestamptz,
  end_at                 timestamptz,
  scheduled_hours        numeric(6,2),  -- from labor.scheduled_hours
  published              boolean     DEFAULT false,
  scheduled              boolean     DEFAULT true,
  synced_at              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_homebase_shifts_employee   ON public.homebase_shifts(homebase_employee_id);
CREATE INDEX idx_homebase_shifts_start_at   ON public.homebase_shifts(start_at);
CREATE INDEX idx_homebase_shifts_location   ON public.homebase_shifts(location_homebase_uuid);
CREATE INDEX idx_homebase_shifts_user_id    ON public.homebase_shifts(homebase_user_id);

ALTER TABLE public.homebase_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage homebase_shifts" ON public.homebase_shifts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view homebase_shifts" ON public.homebase_shifts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_homebase_shifts_updated_at
  BEFORE UPDATE ON public.homebase_shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. homebase_sync_runs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.homebase_sync_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  status              text        NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  error               text,
  locations_synced    integer     DEFAULT 0,
  employees_synced    integer     DEFAULT 0,
  shifts_synced       integer     DEFAULT 0,
  employees_matched   integer     DEFAULT 0,
  employees_unmatched integer     DEFAULT 0,
  unmatched_sample    jsonb       DEFAULT '[]'::jsonb,  -- [{homebase_id, name}]
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.homebase_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage homebase_sync_runs" ON public.homebase_sync_runs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. provider_name_mappings  (manual override for fuzzy-match misses)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.provider_name_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_name  text NOT NULL UNIQUE,  -- raw name exactly as it appears in Homebase
  profile_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_name_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage provider_name_mappings" ON public.provider_name_mappings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_provider_name_mappings_updated_at
  BEFORE UPDATE ON public.provider_name_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. state_leftover_slots  (CSV: state | date | available same/next-day slots)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.state_leftover_slots (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation  text    NOT NULL,
  slot_date           date    NOT NULL,
  unfilled_slots      integer NOT NULL,
  window_type         text    NOT NULL DEFAULT 'historical',  -- 'historical' | 'forecast'
  imported_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, slot_date, window_type)
);

CREATE INDEX idx_state_leftover_slots_state ON public.state_leftover_slots(state_abbreviation);
CREATE INDEX idx_state_leftover_slots_date  ON public.state_leftover_slots(slot_date);

ALTER TABLE public.state_leftover_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage state_leftover_slots" ON public.state_leftover_slots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view state_leftover_slots" ON public.state_leftover_slots
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. state_sla_attainment  (CSV: State | SLA Attainment Rate)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.state_sla_attainment (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation  text    NOT NULL,
  window_label        text    NOT NULL,  -- 'feb2026_current' | 'past_2_weeks'
  window_start        date,
  window_end          date,
  sla_pct             numeric(5,2) NOT NULL,  -- 0–100
  imported_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, window_label)
);

CREATE INDEX idx_state_sla_state ON public.state_sla_attainment(state_abbreviation);

ALTER TABLE public.state_sla_attainment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage state_sla_attainment" ON public.state_sla_attainment
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view state_sla_attainment" ON public.state_sla_attainment
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. provider_utilization  (CSV: Provider | Total Timeslots | Avg Utilization)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.provider_utilization (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name         text    NOT NULL,         -- raw name from CSV
  profile_id            uuid    REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_confidence      text    DEFAULT 'unmatched',
  window_start          date,
  window_end            date,
  total_timeslots       integer NOT NULL,
  avg_utilization_pct   numeric(5,2) NOT NULL,    -- 0–100
  imported_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_utilization_profile ON public.provider_utilization(profile_id);

ALTER TABLE public.provider_utilization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage provider_utilization" ON public.provider_utilization
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view provider_utilization" ON public.provider_utilization
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. utilization_daily  (CSV: Period | %)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.utilization_daily (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  util_date     date    NOT NULL UNIQUE,
  overall_pct   numeric(5,2) NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_utilization_daily_date ON public.utilization_daily(util_date);

ALTER TABLE public.utilization_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage utilization_daily" ON public.utilization_daily
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view utilization_daily" ON public.utilization_daily
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. state_activation  (which states are currently "on" for operations)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.state_activation (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation  text    NOT NULL UNIQUE,
  is_active           boolean NOT NULL DEFAULT false,
  effective_date      date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.state_activation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage state_activation" ON public.state_activation
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view state_activation" ON public.state_activation
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_state_activation_updated_at
  BEFORE UPDATE ON public.state_activation
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. license_optimization_snapshots  (computed daily by edge function)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.license_optimization_snapshots (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date           date        NOT NULL,
  profile_id              uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  state_abbreviation      text        NOT NULL,
  provider_hours_total    numeric(8,2),  -- Homebase scheduled hours that day
  active_license_count    integer,       -- |active_licensed_states ∩ active_states|
  allocated_hours         numeric(8,2),  -- provider_hours_total / active_license_count
  unfilled_slots          integer,       -- from state_leftover_slots for that date
  sla_pct                 numeric(5,2),  -- from state_sla_attainment (short window)
  estimated_demand_hours  numeric(8,2),  -- derived demand estimate in hours
  coverage_ratio          numeric(6,3),  -- supply / demand
  quadrant                text,          -- 'SURPLUS' | 'DEFICIT' | 'BALANCED' | 'ANOMALY'
  wasted_flag             boolean        DEFAULT false,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, profile_id, state_abbreviation)
);

CREATE INDEX idx_los_date         ON public.license_optimization_snapshots(snapshot_date);
CREATE INDEX idx_los_profile      ON public.license_optimization_snapshots(profile_id);
CREATE INDEX idx_los_state        ON public.license_optimization_snapshots(state_abbreviation);
CREATE INDEX idx_los_quadrant     ON public.license_optimization_snapshots(quadrant);
CREATE INDEX idx_los_wasted       ON public.license_optimization_snapshots(wasted_flag) WHERE wasted_flag = true;

ALTER TABLE public.license_optimization_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage license_optimization_snapshots" ON public.license_optimization_snapshots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view license_optimization_snapshots" ON public.license_optimization_snapshots
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));
