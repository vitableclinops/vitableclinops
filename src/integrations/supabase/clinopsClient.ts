import { createClient } from '@supabase/supabase-js';
import type { ClinOpsDatabase } from './clinopsTypes';

// Second Supabase project — bbquooftytwprllipcsb — holds the scheduling pipeline
// data (schedule_submissions, demand_forecast, state_demand_targets, etc.).
// Read-only from the UI; writes happen via edge functions.
const CLINOPS_URL = import.meta.env.VITE_CLINOPS_SUPABASE_URL as string | undefined;
const CLINOPS_KEY = import.meta.env.VITE_CLINOPS_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!CLINOPS_URL || !CLINOPS_KEY) {
  // Surface the misconfig at module load so blank pages are easier to diagnose.
  // eslint-disable-next-line no-console
  console.warn(
    '[clinopsClient] VITE_CLINOPS_SUPABASE_URL or VITE_CLINOPS_SUPABASE_PUBLISHABLE_KEY is missing — scheduling pages will not load.',
  );
}

export const clinopsSupabase = createClient<ClinOpsDatabase>(
  CLINOPS_URL ?? 'http://localhost:54321',
  CLINOPS_KEY ?? 'placeholder',
  {
    auth: {
      // No auth on this client — the scheduling pipeline tables are read via
      // the publishable anon key with row-level policies. Don't share storage
      // with the primary client.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
