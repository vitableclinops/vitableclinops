-- Add pod_lead to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pod_lead';