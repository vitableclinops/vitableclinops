import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { buildDryRun, type DryRun, type ExistingState, type ParsedWorkbook, type RowResult } from '@/lib/externalImport';

const db = supabase as any;

export async function loadExistingState(): Promise<ExistingState> {
  const [ag, pr, med, ep, el, ea, ad] = await Promise.all([
    db.from('agencies').select('id, name'),
    db.from('profiles').select('id, full_name, email, npi_number, employment_status, medallion_id').range(0, 4999),
    db.from('medallion_providers').select('profile_id, npi, email').range(0, 4999),
    db.from('external_providers').select('*').range(0, 9999),
    db.from('external_licenses').select('*').range(0, 9999),
    db.from('external_agreements').select('*').range(0, 9999),
    db.from('external_provider_addresses').select('*').range(0, 9999),
  ]);
  for (const r of [ag, pr, med, ep, el, ea, ad]) if (r.error) throw r.error;
  return { agencies: ag.data, profiles: pr.data, medallion: med.data, externalProviders: ep.data, externalLicenses: el.data, externalAgreements: ea.data, addresses: ad.data };
}

export async function runDryRun(parsed: ParsedWorkbook, fileName: string): Promise<DryRun> {
  const dry = buildDryRun(parsed, await loadExistingState());
  const { data: u } = await supabase.auth.getUser();
  await db.from('external_import_runs').insert({ file_name: fileName, dry_run: true, counts: dry.counts, diff: { headerIssues: dry.headerIssues, results: dry.results.map(({ patch, ...r }) => r) }, created_by: u.user?.id ?? null });
  return dry;
}

/**
 * Apply a dry run. The diff is recomputed against current data first so a
 * stale preview can't write anything. Only non-blocked add/update rows are
 * written, and only their non-blank changed fields.
 */
export async function applyImport(parsed: ParsedWorkbook, fileName: string, createProfiles: boolean) {
  const dry = buildDryRun(parsed, await loadExistingState());
  const { data: u } = await supabase.auth.getUser();
  const { data: run, error: runErr } = await db.from('external_import_runs')
    .insert({ file_name: fileName, dry_run: false, counts: dry.counts, diff: { headerIssues: dry.headerIssues }, created_by: u.user?.id ?? null })
    .select('id').single();
  if (runErr) throw runErr;
  const runId = run.id;
  const todo = (s: RowResult['sheet']) => dry.results.filter((r) => r.sheet === s && (r.action === 'add' || r.action === 'update') && r.agencyId);
  let written = 0, profilesCreated = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const r of todo('Providers')) {
    let profileId = r.profileLink?.profileId ?? null;
    const status = (r.patch.agency_reported_status as string) ?? null;
    if (!profileId && r.action === 'add' && createProfiles && r.profileLink?.via === 'new' && status && ['active', 'onboarding', 'termed'].includes(status)) {
      const p = r.patch as Record<string, any>;
      const { data, error } = await db.from('profiles').insert({
        email: p.email, first_name: p.first_name, last_name: p.last_name,
        full_name: [p.first_name, p.last_name].filter(Boolean).join(' '),
        preferred_name: p.preferred_name ?? null, npi_number: p.npi ?? null, profession: p.profession ?? null,
        credentials: p.credentials ?? null, employment_type: 'agency', agency_id: r.agencyId,
        employment_status: status === 'termed' ? 'termed' : 'active',
      }).select('id').single();
      if (error) { errors.push(`${r.label}: ${error.message}`); continue; }
      profileId = data.id; profilesCreated++;
    }
    const row = { ...r.patch, agency_id: r.agencyId, external_provider_id: r.key, last_import_run_id: runId, updated_at: now, ...(profileId ? { profile_id: profileId } : {}) };
    const { error } = await db.from('external_providers').upsert(row, { onConflict: 'agency_id,external_provider_id' });
    if (error) errors.push(`${r.label}: ${error.message}`); else written++;
  }
  for (const r of todo('Addresses')) {
    const [pid, type] = [r.key.slice(0, r.key.lastIndexOf(':')), r.key.slice(r.key.lastIndexOf(':') + 1)];
    const { error } = await db.from('external_provider_addresses').upsert({ ...r.patch, agency_id: r.agencyId, external_provider_id: pid, address_type: type, last_import_run_id: runId, updated_at: now }, { onConflict: 'agency_id,external_provider_id,address_type' });
    if (error) errors.push(`${r.label}: ${error.message}`); else written++;
  }
  for (const [sheet, table, key] of [['Licenses', 'external_licenses', 'external_license_id'], ['Agreements', 'external_agreements', 'external_agreement_id']] as const) {
    for (const r of todo(sheet)) {
      const { error } = await db.from(table).upsert({ ...r.patch, agency_id: r.agencyId, [key]: r.key, last_import_run_id: runId, updated_at: now }, { onConflict: `agency_id,${key}` });
      if (error) errors.push(`${r.label}: ${error.message}`); else written++;
    }
  }
  return { written, profilesCreated, errors, dry };
}

export interface ExternalDirectoryData {
  byProfile: Map<string, { agencyId: string; externalId: string; licenseInventory: string | null; agreementInventory: string | null; licenses: any[] }>;
  agreements: any[];
  providers: any[];
}

/** Imported agency providers, licenses and agreements for the directory views. */
export function useExternalDirectoryData(enabled: boolean) {
  return useQuery<ExternalDirectoryData>({
    queryKey: ['external-directory'],
    enabled,
    queryFn: async () => {
      const [p, l, a] = await Promise.all([
        db.from('external_providers').select('*').range(0, 9999),
        db.from('external_licenses').select('*').range(0, 9999),
        db.from('external_agreements').select('*').range(0, 9999),
      ]);
      for (const r of [p, l, a]) if (r.error) throw r.error;
      const byProfile: ExternalDirectoryData['byProfile'] = new Map();
      for (const ep of p.data) {
        if (!ep.profile_id) continue;
        byProfile.set(ep.profile_id, {
          agencyId: ep.agency_id, externalId: ep.external_provider_id,
          licenseInventory: ep.license_inventory_status, agreementInventory: ep.agreement_inventory_status,
          licenses: l.data.filter((x: any) => x.agency_id === ep.agency_id && x.external_provider_id === ep.external_provider_id),
        });
      }
      return { byProfile, agreements: a.data, providers: p.data };
    },
  });
}
