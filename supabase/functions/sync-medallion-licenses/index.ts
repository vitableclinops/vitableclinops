/**
 * sync-medallion-licenses edge function
 *
 * Pulls active provider licenses from the Medallion API and stores them in
 * medallion_provider_licenses. The evaluator consumes these through
 * v_provider_state_eligibility alongside ClinOps manual licenses and
 * DirectShifts static licenses.
 *
 * Required secret:
 *   MEDALLION_API_KEY
 *
 * Optional secrets/env:
 *   MEDALLION_API_BASE_URL      default https://api.medallion.co
 *   MEDALLION_LICENSES_URL      overrides the full licenses endpoint URL
 *   MEDALLION_LICENSE_STATUSES  comma-separated, default active
 *   MEDALLION_ORGANIZATION_ID   optional enterprise org header
 *
 * Query params:
 *   ?dry_run=1          parse and match without writing
 *   ?inspect=1          return sample normalized rows
 *   ?allow_missing=1    return skipped instead of 500 when API key is absent
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SupabaseClient = ReturnType<typeof createClient>;
type JsonMap = Record<string, unknown>;

type ProviderRow = {
  id: string;
  name: string | null;
  email: string | null;
  npi: string | null;
  medallion_provider_id: string | null;
};

type NormalizedLicense = {
  medallion_license_key: string;
  provider_id: string | null;
  medallion_provider_id: string | null;
  provider_email: string | null;
  provider_name: string | null;
  state: string;
  status: string;
  license_number: string | null;
  license_type: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  source: 'medallion_api';
  raw_payload: JsonMap;
  synced_at: string;
  updated_at: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const inspect = url.searchParams.get('inspect') === '1';
  const allowMissing = url.searchParams.get('allow_missing') === '1';

  const apiKey = Deno.env.get('MEDALLION_API_KEY');
  if (!apiKey) {
    const body = {
      ok: allowMissing,
      skipped: true,
      reason: 'MEDALLION_API_KEY secret is not set',
    };
    return json(body, allowMissing ? 200 : 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const startedAt = Date.now();
  const runId = await openRun(supabase);
  const finishRun = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; rows_failed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!runId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      rows_failed: extras.rows_failed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', runId);
  };

  try {
    const providers = await loadProviders(supabase);
    const providerLookup = buildProviderLookup(providers);
    const statuses = (Deno.env.get('MEDALLION_LICENSE_STATUSES') ?? 'active')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const rawRows: JsonMap[] = [];
    const errors: string[] = [];
    for (const status of statuses) {
      try {
        rawRows.push(...await fetchMedallionLicenses(apiKey, status));
      } catch (err) {
        errors.push(`status=${status}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const syncedAt = new Date().toISOString();
    const normalized: NormalizedLicense[] = [];
    const skipped: Record<string, number> = {};
    const matchedByMedallionId: Array<{ providerId: string; medallionProviderId: string }> = [];

    for (const raw of rawRows) {
      const row = normalizeLicense(raw, providerLookup, syncedAt);
      if (!row.ok) {
        skipped[row.reason] = (skipped[row.reason] ?? 0) + 1;
        continue;
      }
      normalized.push(row.value);
      if (row.value.provider_id && row.value.medallion_provider_id) {
        matchedByMedallionId.push({
          providerId: row.value.provider_id,
          medallionProviderId: row.value.medallion_provider_id,
        });
      }
    }

    if (inspect) {
      await finishRun(errors.length ? 'partial' : 'success', {
        rows_processed: normalized.length,
        rows_failed: errors.length,
        details: { raw_rows: rawRows.length, skipped, sample: normalized.slice(0, 10) },
      });
      return json({
        ok: errors.length === 0,
        mode: 'inspect',
        raw_rows: rawRows.length,
        normalized_rows: normalized.length,
        skipped,
        errors,
        sample: normalized.slice(0, 10),
      });
    }

    let upserted = 0;
    if (!dryRun && normalized.length) {
      for (const chunk of chunked(normalized, 500)) {
        const { error } = await supabase
          .from('medallion_provider_licenses')
          .upsert(chunk, { onConflict: 'medallion_license_key' });
        if (error) throw new Error(`medallion_provider_licenses upsert failed: ${error.message}`);
        upserted += chunk.length;
      }
      await backfillProviderMedallionIds(supabase, providers, matchedByMedallionId);
    }

    await finishRun(errors.length ? 'partial' : 'success', {
      rows_processed: normalized.length,
      rows_failed: errors.length,
      error_message: errors.length ? errors.join('; ') : undefined,
      details: { raw_rows: rawRows.length, upserted, skipped, dry_run: dryRun },
    });

    return json({
      ok: errors.length === 0,
      raw_rows: rawRows.length,
      normalized_rows: normalized.length,
      upserted,
      skipped,
      errors,
      dry_run: dryRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun('error', { error_message: message });
    return json({ ok: false, error: message }, 500);
  }
});

async function openRun(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'sync-medallion-licenses', status: 'running' })
    .select('id')
    .single();
  if (error) {
    console.warn(`sync_runs insert failed: ${error.message}`);
    return null;
  }
  return (data?.id as string) ?? null;
}

async function fetchMedallionLicenses(apiKey: string, status: string): Promise<JsonMap[]> {
  const base = trimTrailingSlash(Deno.env.get('MEDALLION_API_BASE_URL') ?? 'https://api.medallion.co');
  const endpoint = Deno.env.get('MEDALLION_LICENSES_URL') ?? `${base}/api/v1/org/licenses/`;
  const organizationId = Deno.env.get('MEDALLION_ORGANIZATION_ID');
  const first = new URL(endpoint);
  first.searchParams.append('status', status);

  const rows: JsonMap[] = [];
  let nextUrl: string | null = first.toString();
  let pages = 0;

  while (nextUrl) {
    pages += 1;
    if (pages > 100) throw new Error('pagination exceeded 100 pages');

    const res = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
        ...(organizationId ? { 'X-Medallion-Organization-Id': organizationId } : {}),
      },
    });
    if (!res.ok) throw new Error(`Medallion ${res.status}: ${await res.text()}`);

    const body = await res.json();
    const pageRows = rowsFromBody(body);
    rows.push(...pageRows);
    nextUrl = nextFromBody(body, nextUrl);
  }

  return rows;
}

function rowsFromBody(body: unknown): JsonMap[] {
  if (Array.isArray(body)) return body.filter(isJsonMap);
  if (!isJsonMap(body)) return [];
  const candidates = [body.results, body.data, body.items];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter(isJsonMap);
  }
  return [];
}

function nextFromBody(body: unknown, currentUrl: string): string | null {
  if (!isJsonMap(body)) return null;
  const next = stringVal(body.next) ?? stringVal((body.links as JsonMap | undefined)?.next);
  if (!next) return null;
  try {
    return new URL(next, currentUrl).toString();
  } catch {
    return null;
  }
}

async function loadProviders(supabase: SupabaseClient): Promise<ProviderRow[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('id, name, email, npi, medallion_provider_id')
    .range(0, 49999);
  if (error) throw new Error(`Provider lookup failed: ${error.message}`);
  return (data ?? []) as ProviderRow[];
}

function buildProviderLookup(providers: ProviderRow[]) {
  const byMedallionId = new Map<string, ProviderRow>();
  const byEmail = new Map<string, ProviderRow>();
  const byName = new Map<string, ProviderRow>();
  const byNpi = new Map<string, ProviderRow>();
  for (const p of providers) {
    if (p.medallion_provider_id) byMedallionId.set(p.medallion_provider_id.trim(), p);
    if (p.email) byEmail.set(normEmail(p.email), p);
    if (p.name) byName.set(normName(p.name), p);
    if (p.npi) byNpi.set(normDigits(p.npi), p);
  }
  return { byMedallionId, byEmail, byName, byNpi };
}

function normalizeLicense(
  raw: JsonMap,
  lookup: ReturnType<typeof buildProviderLookup>,
  syncedAt: string,
): { ok: true; value: NormalizedLicense } | { ok: false; reason: string } {
  const providerObj = objectVal(raw, 'provider', 'provider_details', 'provider_detail');
  const medallionProviderId =
    stringVal(raw.provider__id) ??
    stringVal(raw.provider_id) ??
    stringVal(raw.provider_uuid) ??
    stringVal(providerObj?.id) ??
    stringVal(providerObj?.uuid) ??
    (typeof raw.provider === 'string' ? raw.provider : null);
  const providerEmail =
    stringVal(raw.provider_email) ??
    stringVal(raw.email) ??
    stringVal(providerObj?.email);
  const providerName =
    stringVal(raw.provider_name) ??
    stringVal(raw.provider_full_name) ??
    stringVal(raw.full_name) ??
    stringVal(raw.name) ??
    stringVal(providerObj?.full_name) ??
    stringVal(providerObj?.name);
  const npi = stringVal(raw.npi) ?? stringVal(providerObj?.npi);
  const stateRaw = stringVal(raw.state) ?? stringVal(raw.state_abbreviation) ?? stringVal(raw.license_state);
  const state = stateRaw ? toAbbreviation(stateRaw) : null;
  if (!state) return { ok: false, reason: 'missing_or_unknown_state' };

  const matched =
    (medallionProviderId && lookup.byMedallionId.get(medallionProviderId.trim())) ||
    (providerEmail && lookup.byEmail.get(normEmail(providerEmail))) ||
    (npi && lookup.byNpi.get(normDigits(npi))) ||
    (providerName && lookup.byName.get(normName(providerName))) ||
    null;

  const licenseId =
    stringVal(raw.id) ??
    stringVal(raw.uuid) ??
    stringVal(raw.license_id);
  const licenseNumber =
    stringVal(raw.license_number) ??
    stringVal(raw.number) ??
    stringVal(raw.license);
  const licenseType =
    stringVal(raw.certificate_type) ??
    stringVal(raw.license_type) ??
    stringVal(raw.type);
  const status = stringVal(raw.status)?.toLowerCase() ?? 'active';

  const providerKey =
    medallionProviderId ??
    matched?.id ??
    providerEmail?.toLowerCase() ??
    providerName?.toLowerCase() ??
    'unknown-provider';
  const licenseKey = [
    'medallion',
    licenseId ?? providerKey,
    state,
    licenseNumber ?? licenseType ?? 'license',
  ].map(v => String(v).trim().toLowerCase()).join('|');

  return {
    ok: true,
    value: {
      medallion_license_key: licenseKey,
      provider_id: matched?.id ?? null,
      medallion_provider_id: medallionProviderId,
      provider_email: providerEmail ? normEmail(providerEmail) : matched?.email ?? null,
      provider_name: providerName ?? matched?.name ?? null,
      state,
      status,
      license_number: licenseNumber,
      license_type: licenseType,
      issue_date: isoDate(raw.issue_date) ?? isoDate(raw.issued_date),
      expiration_date: isoDate(raw.expiration_date) ?? isoDate(raw.expires_at),
      source: 'medallion_api',
      raw_payload: raw,
      synced_at: syncedAt,
      updated_at: syncedAt,
    },
  };
}

async function backfillProviderMedallionIds(
  supabase: SupabaseClient,
  providers: ProviderRow[],
  matches: Array<{ providerId: string; medallionProviderId: string }>,
) {
  const existing = new Map(providers.map(p => [p.id, p.medallion_provider_id]));
  const unique = new Map<string, string>();
  for (const m of matches) {
    if (!m.medallionProviderId) continue;
    if (existing.get(m.providerId)) continue;
    unique.set(m.providerId, m.medallionProviderId);
  }
  for (const [providerId, medallionProviderId] of unique) {
    const { error } = await supabase
      .from('providers')
      .update({ medallion_provider_id: medallionProviderId })
      .eq('id', providerId)
      .is('medallion_provider_id', null);
    if (error) console.warn(`provider ${providerId} medallion id update failed: ${error.message}`);
  }
}

function objectVal(row: JsonMap, ...keys: string[]): JsonMap | null {
  for (const key of keys) {
    const value = row[key];
    if (isJsonMap(value)) return value;
  }
  return null;
}

function stringVal(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  return s ? s : null;
}

function isoDate(value: unknown): string | null {
  const s = stringVal(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isJsonMap(value: unknown): value is JsonMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normEmail(value: string) {
  return value.trim().toLowerCase();
}

function normName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normDigits(value: string) {
  return value.replace(/\D/g, '');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
