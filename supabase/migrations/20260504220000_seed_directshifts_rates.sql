-- Seed pay rates for DirectShifts contractor providers who are NOT in Homebase
-- and therefore can't be picked up by sync-homebase-rates.
-- Source: rates provided by Maddi (ClinOps), 2026-05-04.
-- Idempotent: skips any (provider_id, role) where an open rate already exists.

INSERT INTO provider_pay_rates (provider_id, hourly_rate, role, effective_from, effective_to, source)
SELECT v.provider_id, v.hourly_rate, v.role, CURRENT_DATE, NULL, 'directshifts_manual'
FROM (VALUES
  -- NPs
  ('1edab01b-2eff-44e2-8364-fc03fe4c4ffb'::uuid,  85.00, 'NP Telemedicine'),  -- Akosua Norgbey
  ('8611321d-b455-45c5-a973-b8684b546366'::uuid,  95.00, 'NP Telemedicine'),  -- Brittney Afram
  ('5a84013d-abf7-4453-9f40-b4a90a14de8f'::uuid,  90.00, 'NP Telemedicine'),  -- Stephanie Lumsden
  ('14769c24-8d01-4470-ae4b-cd81c30f2c5b'::uuid,  80.00, 'NP Telemedicine'),  -- Abby Grant
  ('8ad548b6-1d81-4c68-b7ce-6fad4de469a9'::uuid,  80.00, 'NP Telemedicine'),  -- Nycole Cox
  ('15e0c4ab-fec3-4809-8c46-005970b93174'::uuid,  80.00, 'NP Telemedicine'),  -- Stacy Lynn (a.k.a. Stacy Shelton — confirm)
  ('897b2d54-efdf-465c-b8bd-4f6128b729ff'::uuid,  95.00, 'NP Telemedicine'),  -- Cassondra Hawkins
  ('0a14cdd6-dd6e-4f91-bd3b-06257da0767d'::uuid,  95.00, 'NP Telemedicine'),  -- Jarrod Nero
  -- Physicians
  ('6a89cba1-4f50-47be-bb7e-158900db8972'::uuid, 140.00, 'MD Telemedicine'),  -- Dr. Nana-Aishatu Adamu
  ('52246140-2679-4c37-ade1-f72e1e4e12c1'::uuid, 140.00, 'MD Telemedicine'),  -- Dr. Samuel Elias-Ausi
  ('05235038-8c1b-47d5-baca-6d0d29036680'::uuid, 150.00, 'MD Telemedicine')   -- Dr. Dorcas Omari
) AS v(provider_id, hourly_rate, role)
WHERE NOT EXISTS (
  SELECT 1
  FROM provider_pay_rates r
  WHERE r.provider_id = v.provider_id
    AND r.role        = v.role
    AND r.effective_to IS NULL
);
