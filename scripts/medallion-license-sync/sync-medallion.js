import { createClient } from '@supabase/supabase-js';

const TARGET_PROVIDER_NAMES = ['Genevieve Teetie', 'Rebecca Keuch'];
const MEDALLION_BASE_URL = 'https://api.medallion.co';
const PAGE_LIMIT = 200;
const DRY_RUN = process.argv.includes('--dry-run');

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const STATE_NAME_TO_CODE = new Map([
  ['alabama', 'AL'],
  ['alaska', 'AK'],
  ['arizona', 'AZ'],
  ['arkansas', 'AR'],
  ['california', 'CA'],
  ['colorado', 'CO'],
  ['connecticut', 'CT'],
  ['delaware', 'DE'],
  ['district of columbia', 'DC'],
  ['washington dc', 'DC'],
  ['washington d c', 'DC'],
  ['florida', 'FL'],
  ['georgia', 'GA'],
  ['hawaii', 'HI'],
  ['idaho', 'ID'],
  ['illinois', 'IL'],
  ['indiana', 'IN'],
  ['iowa', 'IA'],
  ['kansas', 'KS'],
  ['kentucky', 'KY'],
  ['louisiana', 'LA'],
  ['maine', 'ME'],
  ['maryland', 'MD'],
  ['massachusetts', 'MA'],
  ['michigan', 'MI'],
  ['minnesota', 'MN'],
  ['mississippi', 'MS'],
  ['missouri', 'MO'],
  ['montana', 'MT'],
  ['nebraska', 'NE'],
  ['nevada', 'NV'],
  ['new hampshire', 'NH'],
  ['new jersey', 'NJ'],
  ['new mexico', 'NM'],
  ['new york', 'NY'],
  ['north carolina', 'NC'],
  ['north dakota', 'ND'],
  ['ohio', 'OH'],
  ['oklahoma', 'OK'],
  ['oregon', 'OR'],
  ['pennsylvania', 'PA'],
  ['rhode island', 'RI'],
  ['south carolina', 'SC'],
  ['south dakota', 'SD'],
  ['tennessee', 'TN'],
  ['texas', 'TX'],
  ['utah', 'UT'],
  ['vermont', 'VT'],
  ['virginia', 'VA'],
  ['washington', 'WA'],
  ['west virginia', 'WV'],
  ['wisconsin', 'WI'],
  ['wyoming', 'WY'],
]);

const STATUS_MAP = new Map([
  ['active', 'active'],
  ['approved', 'active'],
  ['complete', 'active'],
  ['completed', 'active'],
  ['current', 'active'],
  ['good standing', 'active'],
  ['issued', 'active'],
  ['verified', 'active'],
  ['not started', 'not_started'],
  ['not_started', 'not_started'],
  ['not requested', 'not_started'],
  ['pending', 'in_progress'],
  ['pending renewal', 'in_progress'],
  ['pending_renewal', 'in_progress'],
  ['in progress', 'in_progress'],
  ['in_progress', 'in_progress'],
  ['processing', 'in_progress'],
  ['requested', 'in_progress'],
  ['submitted', 'submitted'],
  ['application submitted', 'submitted'],
  ['application_submitted', 'submitted'],
  ['expired', 'expired'],
  ['inactive', 'expired'],
  ['lapsed', 'expired'],
  ['revoked', 'expired'],
  ['superceded', 'expired'],
  ['superseded', 'expired'],
]);

async function main() {
  const env = requireEnv([
    'MEDALLION_API_KEY',
    'MEDALLION_ORG_ID',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const summary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    unmapped_statuses: [],
    dry_run: DRY_RUN,
    provider_mappings: [],
    medallion: {
      fetched_licenses: 0,
      imported_licenses: 0,
      duplicate_licenses_collapsed: 0,
      skipped_by_reason: {},
    },
    compact: {
      inserted: 0,
      updated: 0,
      skipped_no_compact_home_state: 0,
      skipped_direct_exists: 0,
    },
  };

  const providers = await loadTargetProviders(supabase);
  const medallionProviders = await fetchAllMedallionProviders(env);
  const providerContext = mapProviders(providers, medallionProviders, summary);

  if (!DRY_RUN) {
    await saveMedallionProviderIds(supabase, providerContext, summary);
  }

  const rawLicenses = await fetchAllMedallionLicenses(env);
  summary.medallion.fetched_licenses = rawLicenses.length;

  const normalized = [];
  const unmappedStatuses = new Set();

  for (const raw of rawLicenses) {
    const result = normalizeLicense(raw, providerContext, unmappedStatuses);
    if (!result.ok) {
      increment(summary.medallion.skipped_by_reason, result.reason);
      summary.skipped += 1;
      continue;
    }
    normalized.push(result.row);
  }

  const deduped = dedupeLicenses(normalized);
  summary.medallion.duplicate_licenses_collapsed = normalized.length - deduped.length;
  summary.medallion.imported_licenses = deduped.length;
  summary.skipped += summary.medallion.duplicate_licenses_collapsed;
  summary.unmapped_statuses = [...unmappedStatuses].sort();

  const existingBeforeDirect = await loadExistingLicenseKeys(supabase, providers.map(p => p.id));
  const directCounts = countRowsByExistingKeys(deduped, existingBeforeDirect);
  summary.inserted += directCounts.inserted;
  summary.updated += directCounts.updated;

  if (!DRY_RUN && deduped.length > 0) {
    await upsertLicenseRows(supabase, deduped);
  }

  const compactCounts = await upsertCompactRnRows(supabase, providers, deduped, DRY_RUN);
  summary.inserted += compactCounts.inserted;
  summary.updated += compactCounts.updated;
  summary.compact = compactCounts;

  console.log(JSON.stringify(summary, null, 2));
}

function requireEnv(names) {
  const env = {};
  const missing = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!value) missing.push(name);
    env[name] = value;
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  return env;
}

async function loadTargetProviders(supabase) {
  const { data, error } = await supabase
    .from('providers')
    .select('id, name, home_state, medallion_provider_id')
    .range(0, 9999);

  if (error) {
    throw new Error(`Failed to load providers from Supabase: ${error.message}`);
  }

  const byName = new Map((data ?? []).map(row => [normalizeName(row.name), row]));
  const providers = [];
  const missing = [];

  for (const name of TARGET_PROVIDER_NAMES) {
    const provider = byName.get(normalizeName(name));
    if (provider) providers.push(provider);
    else missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(`Missing seeded provider rows in Supabase: ${missing.join(', ')}`);
  }

  return providers;
}

async function fetchAllMedallionProviders(env) {
  const firstUrl = new URL('/api/v1/org/providers/', MEDALLION_BASE_URL);
  firstUrl.searchParams.set('limit', String(PAGE_LIMIT));
  return fetchPaginated(firstUrl, env, 'providers');
}

async function fetchAllMedallionLicenses(env) {
  const firstUrl = new URL('/api/v1/org/licenses', MEDALLION_BASE_URL);
  firstUrl.searchParams.set('limit', String(PAGE_LIMIT));
  return fetchPaginated(firstUrl, env, 'licenses');
}

async function fetchPaginated(firstUrl, env, label) {
  const rows = [];
  let nextUrl = firstUrl.toString();
  let pages = 0;

  while (nextUrl) {
    pages += 1;
    if (pages > 500) {
      throw new Error(`Stopped ${label} pagination after 500 pages`);
    }

    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': env.MEDALLION_API_KEY,
        'x-medallion-organization-id': env.MEDALLION_ORG_ID,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Medallion ${label} request failed: ${response.status} ${body}`);
    }

    const body = await response.json();
    rows.push(...rowsFromBody(body));
    nextUrl = nextFromBody(body, nextUrl);
  }

  return rows;
}

function rowsFromBody(body) {
  if (Array.isArray(body)) return body.filter(isPlainObject);
  if (!isPlainObject(body)) return [];

  for (const key of ['results', 'data', 'items']) {
    if (Array.isArray(body[key])) return body[key].filter(isPlainObject);
  }

  return [];
}

function nextFromBody(body, currentUrl) {
  if (!isPlainObject(body)) return null;
  const next = firstString(body.next, body.links?.next);
  if (!next) return null;
  return new URL(next, currentUrl).toString();
}

function mapProviders(supabaseProviders, medallionProviders, summary) {
  const medallionById = new Map();
  const medallionIdsByTargetName = new Map(TARGET_PROVIDER_NAMES.map(name => [normalizeName(name), []]));

  for (const provider of medallionProviders) {
    const id = firstString(provider.id, provider.uuid, provider.provider_id);
    const name = providerName(provider);
    if (!id || !name) continue;

    medallionById.set(id, provider);
    for (const targetName of TARGET_PROVIDER_NAMES) {
      if (nameMatchesTarget(name, targetName)) {
        medallionIdsByTargetName.get(normalizeName(targetName)).push(id);
      }
    }
  }

  const bySupabaseId = new Map();
  const byMedallionId = new Map();
  const byNormalizedName = new Map();

  for (const provider of supabaseProviders) {
    const targetName = TARGET_PROVIDER_NAMES.find(name => normalizeName(name) === normalizeName(provider.name));
    const medallionMatches = targetName ? medallionIdsByTargetName.get(normalizeName(targetName)) ?? [] : [];
    const uniqueMatches = [...new Set(medallionMatches)];
    const mappedMedallionId = uniqueMatches.length === 1 ? uniqueMatches[0] : null;
    const effectiveMedallionId = mappedMedallionId ?? provider.medallion_provider_id ?? null;

    const mapped = {
      ...provider,
      target_name: targetName ?? provider.name,
      medallion_provider_id_from_api: mappedMedallionId,
      effective_medallion_provider_id: effectiveMedallionId,
      medallion_mapping_status:
        uniqueMatches.length === 1 ? 'matched' :
        uniqueMatches.length > 1 ? 'ambiguous' :
        provider.medallion_provider_id ? 'using_existing_supabase_value' : 'not_found',
    };

    bySupabaseId.set(provider.id, mapped);
    byNormalizedName.set(normalizeName(provider.name), mapped);
    if (effectiveMedallionId) byMedallionId.set(effectiveMedallionId, mapped);

    summary.provider_mappings.push({
      provider_name: provider.name,
      supabase_provider_id: provider.id,
      existing_medallion_provider_id: provider.medallion_provider_id,
      medallion_provider_id_from_api: mappedMedallionId,
      status: mapped.medallion_mapping_status,
    });
  }

  return {
    bySupabaseId,
    byMedallionId,
    byNormalizedName,
    medallionById,
  };
}

async function saveMedallionProviderIds(supabase, providerContext, summary) {
  for (const mapping of summary.provider_mappings) {
    const nextId = mapping.medallion_provider_id_from_api;
    if (!nextId || mapping.existing_medallion_provider_id === nextId) continue;

    const { error } = await supabase
      .from('providers')
      .update({ medallion_provider_id: nextId })
      .eq('id', mapping.supabase_provider_id);

    if (error) {
      throw new Error(`Failed to update providers.medallion_provider_id for ${mapping.provider_name}: ${error.message}`);
    }

    const provider = providerContext.bySupabaseId.get(mapping.supabase_provider_id);
    provider.effective_medallion_provider_id = nextId;
    providerContext.byMedallionId.set(nextId, provider);
    mapping.saved_to_supabase = true;
  }
}

function normalizeLicense(raw, providerContext, unmappedStatuses) {
  const medallionProviderId = medallionProviderIdFromLicense(raw);
  const medallionProvider = medallionProviderId ? providerContext.medallionById.get(medallionProviderId) : null;
  const rawProviderName = providerName(raw.provider_detail) ??
    providerName(raw.provider_details) ??
    providerName(raw.provider) ??
    firstString(raw.provider_name, raw.provider_full_name, raw.full_name);

  const provider = (medallionProviderId && providerContext.byMedallionId.get(medallionProviderId)) ??
    (rawProviderName && providerByName(providerContext, rawProviderName)) ??
    (medallionProvider && providerByName(providerContext, providerName(medallionProvider))) ??
    null;

  if (!provider) return { ok: false, reason: 'provider_not_targeted' };

  const stateCode = toStateCode(firstString(raw.state, raw.state_abbreviation, raw.license_state, raw.licensing_info?.state));
  if (!stateCode) return { ok: false, reason: 'missing_or_non_us_state' };

  const licenseType = toLicenseType(firstString(raw.certificate_type, raw.license_type, raw.type, raw.kind));
  if (!licenseType) return { ok: false, reason: 'non_rn_np_license_type' };

  const rawStatus = firstString(raw.status, raw.license_status, raw.verification?.status);
  const status = mapStatus(rawStatus, unmappedStatuses);
  const licenseId = firstString(raw.id, raw.uuid, raw.license_id);

  return {
    ok: true,
    row: {
      provider_id: provider.id,
      state_code: stateCode,
      license_type: licenseType,
      status,
      license_number: firstString(raw.license_number, raw.number),
      expiration_date: isoDate(raw.expiration_date, raw.expiry_date, raw.expires_at),
      source: 'medallion',
      medallion_license_id: licenseId,
      last_synced_at: new Date().toISOString(),
      notes: null,
      _sort: {
        status,
        expiration_date: isoDate(raw.expiration_date, raw.expiry_date, raw.expires_at),
        medallion_license_id: licenseId,
      },
    },
  };
}

function medallionProviderIdFromLicense(raw) {
  if (typeof raw.provider === 'string') return raw.provider.trim() || null;
  return firstString(
    raw.provider__id,
    raw.provider_id,
    raw.provider_uuid,
    raw.provider?.id,
    raw.provider?.uuid,
    raw.provider_detail?.id,
    raw.provider_details?.id,
  );
}

function providerName(provider) {
  if (!isPlainObject(provider)) return null;
  const direct = firstString(provider.full_name, provider.name, provider.display_name, provider.legal_name);
  if (direct) return direct;

  const parts = [
    firstString(provider.first_name),
    firstString(provider.middle_name),
    firstString(provider.last_name),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function providerByName(providerContext, rawName) {
  const exact = providerContext.byNormalizedName.get(normalizeName(rawName));
  if (exact) return exact;

  for (const provider of providerContext.bySupabaseId.values()) {
    if (nameMatchesTarget(rawName, provider.target_name)) return provider;
  }

  return null;
}

function mapStatus(rawStatus, unmappedStatuses) {
  const normalized = normalizeStatus(rawStatus);
  if (!normalized) {
    unmappedStatuses.add('(missing)');
    return 'in_progress';
  }

  const mapped = STATUS_MAP.get(normalized);
  if (mapped) return mapped;

  unmappedStatuses.add(rawStatus);
  return 'in_progress';
}

function normalizeStatus(value) {
  const status = firstString(value);
  return status ? status.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

function toLicenseType(value) {
  const raw = firstString(value);
  if (!raw) return null;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  if (normalized === 'RN' || normalized === 'REGISTERED NURSE') return 'RN';
  if (['NP', 'APN', 'APRN', 'ARNP', 'CNP', 'NURSE PRACTITIONER'].includes(normalized)) {
    return 'NP';
  }

  return null;
}

function dedupeLicenses(rows) {
  const bestByKey = new Map();

  for (const row of rows) {
    const key = licenseKey(row);
    const current = bestByKey.get(key);
    if (!current || licenseSortScore(row) > licenseSortScore(current)) {
      bestByKey.set(key, row);
    }
  }

  return [...bestByKey.values()].map(({ _sort, ...row }) => row);
}

function licenseSortScore(row) {
  const statusWeight = {
    active: 500,
    submitted: 400,
    in_progress: 300,
    not_started: 200,
    expired: 100,
  }[row._sort.status] ?? 0;

  const expiration = row._sort.expiration_date ? Date.parse(row._sort.expiration_date) : 0;
  const idWeight = row._sort.medallion_license_id ? 1 : 0;
  return statusWeight * 10_000_000_000_000 + expiration + idWeight;
}

async function loadExistingLicenseKeys(supabase, providerIds) {
  const rows = await fetchSupabasePages(supabase, query => query
    .from('provider_licenses')
    .select('provider_id, state_code, license_type, source')
    .in('provider_id', providerIds));

  return new Set(rows.map(licenseKey));
}

function countRowsByExistingKeys(rows, existingKeys) {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    if (existingKeys.has(licenseKey(row))) updated += 1;
    else inserted += 1;
  }

  return { inserted, updated };
}

async function upsertLicenseRows(supabase, rows) {
  for (const chunk of chunked(rows, 500)) {
    const { error } = await supabase
      .from('provider_licenses')
      .upsert(chunk, { onConflict: 'provider_id,state_code,license_type' });

    if (error) {
      throw new Error(`Failed to upsert provider_licenses: ${error.message}`);
    }
  }
}

async function upsertCompactRnRows(supabase, providers, directRowsFromThisRun, dryRun) {
  const compactStates = await fetchSupabasePages(supabase, query => query
    .from('states')
    .select('code')
    .eq('is_nurse_compact', true));
  const compactStateCodes = new Set(compactStates.map(row => row.code));
  const now = new Date().toISOString();

  const existingRows = await fetchSupabasePages(supabase, query => query
    .from('provider_licenses')
    .select('provider_id, state_code, license_type, source')
    .in('provider_id', providers.map(p => p.id))
    .eq('license_type', 'RN'));

  const existingKeys = new Set(existingRows.map(licenseKey));
  const directKeys = new Set(
    existingRows
      .filter(row => row.source !== 'multistate_compact')
      .map(licenseKey),
  );
  for (const row of directRowsFromThisRun.filter(row => row.license_type === 'RN')) {
    directKeys.add(licenseKey(row));
  }

  const rows = [];
  const counts = {
    inserted: 0,
    updated: 0,
    skipped_no_compact_home_state: 0,
    skipped_direct_exists: 0,
  };

  for (const provider of providers) {
    const homeState = toStateCode(provider.home_state);
    if (!homeState || !compactStateCodes.has(homeState)) {
      counts.skipped_no_compact_home_state += compactStateCodes.size;
      continue;
    }

    for (const stateCode of compactStateCodes) {
      const row = {
        provider_id: provider.id,
        state_code: stateCode,
        license_type: 'RN',
        status: 'active',
        license_number: null,
        expiration_date: null,
        source: 'multistate_compact',
        medallion_license_id: null,
        last_synced_at: now,
        notes: `RN compact coverage via ${homeState}`,
      };

      const key = licenseKey(row);
      if (directKeys.has(key)) {
        counts.skipped_direct_exists += 1;
        continue;
      }

      if (existingKeys.has(key)) counts.updated += 1;
      else counts.inserted += 1;
      rows.push(row);
    }
  }

  if (!dryRun && rows.length > 0) {
    await upsertLicenseRows(supabase, rows);
  }

  return counts;
}

async function fetchSupabasePages(supabase, buildQuery) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(supabase).range(from, to);

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function licenseKey(row) {
  return `${row.provider_id}|${row.state_code}|${row.license_type}`;
}

function toStateCode(value) {
  const raw = firstString(value);
  if (!raw) return null;

  const upper = raw.trim().toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;

  const normalized = normalizeName(raw);
  return STATE_NAME_TO_CODE.get(normalized) ?? null;
}

function nameMatchesTarget(candidateName, targetName) {
  const candidate = normalizeName(candidateName);
  const target = normalizeName(targetName);
  if (candidate === target) return true;

  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  return target.split(' ').every(token => candidateTokens.has(token));
}

function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return null;
}

function isoDate(...values) {
  for (const value of values) {
    const text = firstString(value);
    if (!text) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

function chunked(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
