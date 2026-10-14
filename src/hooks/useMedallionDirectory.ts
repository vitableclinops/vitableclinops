import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type MedallionEntity = 'providers' | 'licenses' | 'agreements';
export const MEDALLION_ENTITIES: MedallionEntity[] = ['providers', 'licenses', 'agreements'];
/** Data older than this (or never refreshed) is shown as stale. Daily job + 2h grace. */
export const MEDALLION_STALE_HOURS = 26;

export interface MedallionProviderRow {
  medallion_id: string;
  profile_id: string | null;
  match_method: string;
  match_notes: string | null;
  full_name: string | null;
  email: string | null;
  npi: string | null;
  medallion_employment_status: string | null;
  medallion_employment_type: string | null;
  primary_specialty: string | null;
  secondary_specialty: string | null;
  primary_taxonomy: string | null;
  secondary_taxonomy: string | null;
  languages: string[] | null;
  detail_state: string;
  conflicts: Array<{ field: string; local: string | null; medallion: string | null; note?: string }>;
  last_returned_at: string | null;
}

export interface MedallionLicenseRow {
  medallion_license_id: string;
  profile_id: string | null;
  state: string;
  status: string | null;
  license_number: string | null;
  certificate_type: string | null;
  expiration_date: string | null;
  verified: boolean | null;
  rx_authority: string | null;
}

export interface MedallionAgreementRow {
  medallion_agreement_id: string;
  profile_id: string | null;
  supervisor_name: string | null;
  supervisor_npi: string | null;
  supervisor_profession: string | null;
  state: string | null;
  source_status: string | null;
  agreement_type: string | null;
  start_date: string | null;
  end_date: string | null;
  document_title: string | null;
  local_agreement_id: string | null;
  local_match_notes: string | null;
}

export interface MedallionSyncRun {
  id: string;
  entity: MedallionEntity;
  scope: string;
  mode: string;
  trigger_source: string;
  status: 'running' | 'success' | 'partial' | 'error';
  started_at: string;
  finished_at: string | null;
  rows_returned: number;
  rows_written: number;
  rows_failed: number;
  error_message: string | null;
  details: Record<string, any>;
}

export interface EntityHealth {
  entity: MedallionEntity;
  lastRun: MedallionSyncRun | null;
  lastSuccess: MedallionSyncRun | null;
  stale: boolean;
}

/**
 * Health is computed from timestamps, not from the job reporting on itself,
 * so a job that never starts still shows as stale.
 */
export function computeEntityHealth(runs: MedallionSyncRun[], now = Date.now()): EntityHealth[] {
  return MEDALLION_ENTITIES.map((entity) => {
    const full = runs.filter((r) => r.entity === entity && r.mode === 'apply' && r.scope === 'full');
    const lastRun = full[0] ?? null;
    const lastSuccess = full.find((r) => r.status === 'success') ?? null;
    const ref = lastSuccess?.finished_at ?? lastSuccess?.started_at;
    const stale = !ref || now - new Date(ref).getTime() > MEDALLION_STALE_HOURS * 3600_000;
    return { entity, lastRun, lastSuccess, stale };
  });
}

export function useMedallionDirectoryData(enabled: boolean) {
  return useQuery({
    queryKey: ['medallion_directory'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [prov, lic, ag, runs] = await Promise.all([
        supabase.from('medallion_providers').select('*').range(0, 4999),
        supabase.from('medallion_licenses').select('medallion_license_id, profile_id, state, status, license_number, certificate_type, expiration_date, verified, rx_authority').range(0, 9999),
        supabase.from('medallion_collab_agreements').select('*').range(0, 4999),
        supabase.from('medallion_sync_runs').select('*').order('started_at', { ascending: false }).limit(200),
      ]);
      for (const r of [prov, lic, ag, runs]) if (r.error) throw r.error;
      const providers = (prov.data ?? []) as unknown as MedallionProviderRow[];
      const licenses = (lic.data ?? []) as unknown as MedallionLicenseRow[];
      const agreements = (ag.data ?? []) as unknown as MedallionAgreementRow[];
      const byProfile = new Map<string, MedallionProviderRow>();
      providers.forEach((p) => p.profile_id && byProfile.set(p.profile_id, p));
      const licensesByProfile = new Map<string, MedallionLicenseRow[]>();
      licenses.forEach((l) => {
        if (!l.profile_id) return;
        licensesByProfile.set(l.profile_id, [...(licensesByProfile.get(l.profile_id) ?? []), l]);
      });
      const agreementsByProfile = new Map<string, MedallionAgreementRow[]>();
      agreements.forEach((a) => {
        if (!a.profile_id) return;
        agreementsByProfile.set(a.profile_id, [...(agreementsByProfile.get(a.profile_id) ?? []), a]);
      });
      return {
        providers, licenses, agreements, byProfile, licensesByProfile, agreementsByProfile,
        runs: (runs.data ?? []) as unknown as MedallionSyncRun[],
      };
    },
  });
}

/** Licensed states from Medallion = states with an active license. */
export function activeLicensedStates(rows: MedallionLicenseRow[] | undefined): string[] {
  return [...new Set((rows ?? []).filter((l) => l.status === 'active').map((l) => l.state))].sort();
}

export function useRunMedallionSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { mode: 'dry_run' | 'apply'; scope: 'full' | 'provider'; profile_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('sync-medallion-directory', { body: args });
      if (error) {
        let msg = error.message;
        try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return data as Record<string, any>;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['medallion_directory'] }),
  });
}
