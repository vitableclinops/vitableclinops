/**
 * same-next-day-coverage-alert
 *
 * Server-side replacement for the daily availability report. Pulls same-day
 * and next-day coverage inputs, merges activation candidates, stores a
 * dashboard-readable run, and posts a Slack parent message plus DRI handoff
 * thread reply.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DASHBOARD_URL = 'https://vitableclinops.lovable.app/admin/ops';
const JOTFORM_FORM_ID = '252224341308043';
const JOTFORM_LIMIT = 300;
const CHICAGO_TIME_ZONE = 'America/Chicago';
const SOP_URL_SECRET_NAMES = ['SAME_NEXT_DAY_COVERAGE_SOP_URL', 'COVERAGE_SOP_URL'];

const CARD_SLOTS = 2431;
const CARD_MONTHLY_VISITS = 3011;
const CARD_SLA = 2931;
const CARD_MEMBER_POPULATION = Number(
  Deno.env.get('METABASE_MEMBER_POPULATION_CARD_ID')
  ?? Deno.env.get('METABASE_BASELINE_CARD_ID')
  ?? '2974',
);
const FALLBACK_MEMBER_POPULATION_CARD = 2957;
const MEMBER_POPULATION_SEARCH_TERMS = [
  'Weekly demand forecast active members by state',
  'active members by state',
  'member population by state',
  'members by state',
];
const SLOTS_PER_PROVIDER_HOUR = 2;
const AD_HOC_WEEKLY_VISIT_THRESHOLD = 7;
const PHYSICIAN_ONLY_STATES = new Set(['IN', 'GA', 'AL', 'MS', 'MO', 'TN', 'SC', 'LA']);
const PHYSICIAN_PROFESSIONS = new Set(['md', 'do', 'physician']);
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_UPDATE_API_URL = 'https://slack.com/api/chat.update';
const METABASE_MAX_ATTEMPTS = 3;
const METABASE_RETRY_BASE_DELAY_MS = 2_000;
const RETRYABLE_METABASE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const SUPABASE_READ_MAX_ATTEMPTS = 3;
const SUPABASE_READ_RETRY_BASE_DELAY_MS = 1_500;

const AD_HOC_OWNER_BY_STATE: Record<string, string> = {
  AL: 'Kate',
  CA: 'Kate',
  GA: 'Kate',
  IN: 'Kate',
  LA: 'Kate',
  MO: 'Kate',
  MS: 'Kate',
  SC: 'Kate',
  TN: 'Kate',
  OH: 'Genevieve',
  TX: 'Genevieve',
  DE: 'Rebecca',
  MI: 'Rebecca',
  NJ: 'Rebecca',
  PA: 'Rebecca',
};

const PERMANENT_EXCLUDED_NAMES = [
  'Tiffany Hunt',
  'Leah Bush',
  'Michelle Diederich',
  'Margo Mulgrew',
  'Esha Shah',
  'Li (Liana) Grebich',
  'Liana Grebich',
  'Li Grebich',
  'Mishelle Lockerby',
  'Jamie Fuentes',
  'Jen Yost',
  'Richard Rash',
  'Matthew Vazquez',
];

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

type DataSource = 'daily' | 'five_week_avg' | 'mixed';
type AlertStatus = 'critical' | 'low' | 'ok';
type StaffingMode = 'proactive' | 'ad_hoc';
type Row = Record<string, unknown>;

type ActivationCandidate = {
  provider_name: string;
  profession: string | null;
  utilization_pct: number | null;
  readiness_status: string | null;
  ehr_activation_status: string | null;
};

type ContactPreferenceStatus = 'yes' | 'no' | 'unknown';

type ContactPreference = {
  submission_id: string;
  name: string;
  email: string | null;
  status: ContactPreferenceStatus;
};

type OptInProvider = {
  name: string;
  email: string | null;
  profession: string | null;
  states: string[];
  relevant_states: string[];
};

type NonOptedInProvider = {
  name: string;
  email: string | null;
  profession: string | null;
  opt_in_status: 'no' | 'not_found' | 'unknown';
  opt_in_confirmation: string;
  eligibility_status: string | null;
  metabase_active: boolean | null;
  license_sources: string[];
};

type AlertState = {
  state: string;
  member_population: number | null;
  monthly_visits: number;
  weekly_visits: number;
  daily_demand: number;
  today_slots: number;
  tomorrow_slots: number;
  target: number;
  target_hours: number;
  ratio: number;
  today_ratio: number;
  tomorrow_ratio: number;
  today_status: AlertStatus;
  tomorrow_status: AlertStatus;
  coverage_status: AlertStatus;
  status: AlertStatus;
  staffing_mode: StaffingMode;
  ad_hoc_owner: string;
  sla_pct: number | null;
  opt_in_providers: Array<{ name: string; email: string | null; profession: string | null }>;
  non_opted_in_providers: NonOptedInProvider[];
  candidates: ActivationCandidate[];
};

type AlertResult = {
  dataSource: DataSource;
  criticalStates: AlertState[];
  lowStates: AlertState[];
  okStates: AlertState[];
  optInProviders: OptInProvider[];
  outreachEmailSubject: string;
  outreachEmailBody: string;
  warning: string | null;
  providerLookupWarning: string | null;
};

type SlackPostResult = {
  parentTs: string;
  threadTs: string | null;
  channelId: string;
};

type SlackUpdateRequest = {
  action?: string;
  row_id?: string;
  channel_id?: string;
  parent_ts?: string;
  thread_ts?: string;
};

type SlackOAuthCredentials = {
  access_token: string | null;
  refresh_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  expires_at: string | null;
};

type SlackOAuthReadyCredentials = {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  expires_at: string | null;
};

type JotformAnswer = {
  answer?: unknown;
  prettyFormat?: string;
  text?: string;
  name?: string;
};

type JotformSubmission = {
  id: string;
  answers: Record<string, JotformAnswer>;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const today = getChicagoDate();
  const tomorrow = addDays(today, 1);
  const requestBody = await readJsonBody<SlackUpdateRequest>(req);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    requireEnv('SUPABASE_URL');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    requireEnv('METABASE_USERNAME');
    requireEnv('METABASE_PASSWORD');
    requireEnv('JOTFORM_API_KEY');

    if (requestBody.action === 'update_slack_messages') {
      const updateResult = await updatePostedSlackAlert(
        supabase,
        supabaseUrl,
        serviceRoleKey,
        today,
        tomorrow,
        requestBody,
      );
      return json(updateResult);
    }

    const result = await buildAlertResult(supabaseUrl, serviceRoleKey, today, tomorrow);

    const { data: inserted, error: insertError } = await supabase
      .from('coverage_alerts')
      .insert({
        target_today: today,
        target_tomorrow: tomorrow,
        data_source: result.dataSource,
        critical_states: result.criticalStates,
        low_states: result.lowStates,
        ok_states: result.okStates,
        opt_in_providers: result.optInProviders,
        outreach_email_subject: result.outreachEmailSubject,
        outreach_email_body: result.outreachEmailBody,
        error: result.warning,
      })
      .select('id')
      .single();

    if (insertError) {
      result.warning = appendWarning(
        result.warning,
        `coverage_alerts insert failed: ${compactErrorMessage(insertError)}`,
      );
      console.warn('coverage_alerts insert failed; continuing to Slack post:', compactErrorMessage(insertError));
    }

    const rowId = (inserted?.id as string | undefined) ?? null;

    try {
      const slack = await postSlackAlert(supabase, result, today);
      if (rowId) {
        const { error: updateError } = await supabase
          .from('coverage_alerts')
          .update({
            slack_posted: true,
            slack_parent_ts: slack.parentTs,
            slack_thread_ts: slack.threadTs,
            slack_channel_id: slack.channelId,
          })
          .eq('id', rowId);
        if (updateError) {
          throw new Error(`Slack posted, but slack_posted update failed: ${compactErrorMessage(updateError)}`);
        }
      }
      return json({
        ok: true,
        row_id: rowId,
        slack_posted: true,
        slack_parent_ts: slack.parentTs,
        slack_thread_ts: slack.threadTs,
        slack_channel_id: slack.channelId,
        critical_count: result.criticalStates.length,
        low_count: result.lowStates.length,
        opt_in_provider_count: result.optInProviders.length,
        warning: result.warning,
      });
    } catch (slackError) {
      const message = errorMessage(slackError);
      if (rowId) {
        await supabase.from('coverage_alerts').update({ error: message }).eq('id', rowId);
      }
      return json({ ok: false, row_id: rowId, slack_posted: false, error: message }, 502);
    }
  } catch (err) {
    const message = errorMessage(err);
    let rowId: string | null = null;

    try {
      const { data } = await supabase
        .from('coverage_alerts')
        .insert({
          target_today: today,
          target_tomorrow: tomorrow,
          critical_states: [],
          low_states: [],
          ok_states: [],
          opt_in_providers: [],
          error: message,
        })
        .select('id')
        .single();
      rowId = (data?.id as string) ?? null;
    } catch {
      // If the table write itself is unavailable, the HTTP response still
      // surfaces the failure in the HTTP response.
    }

    return json({ ok: false, row_id: rowId, error: message }, 500);
  }
});

async function buildAlertResult(
  supabaseUrl: string,
  serviceRoleKey: string,
  today: string,
  tomorrow: string,
): Promise<AlertResult> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const warnings: string[] = [];
  const [metabaseToken, activation, contactPreferences] = await Promise.all([
    getMetabaseToken(),
    fetchActivationCandidates(supabaseUrl, serviceRoleKey),
    fetchJotformContactPreferences(today),
  ]);
  const [slotRows, monthlyRows, slaRows, memberPopulationResult] = await Promise.all([
    fetchMetabaseCard(CARD_SLOTS, metabaseToken),
    fetchMetabaseCard(CARD_MONTHLY_VISITS, metabaseToken),
    fetchMetabaseCard(CARD_SLA, metabaseToken),
    fetchMemberPopulationMap(metabaseToken),
  ]);

  const slots = buildSlotMap(slotRows, today, tomorrow);
  const monthlyVisits = buildMonthlyVisitMap(monthlyRows);
  const sla = buildSlaMap(slaRows);
  const memberPopulation = memberPopulationResult.members;
  const providerProfessionResult = await loadProviderProfessionByName(supabase);
  if (providerProfessionResult.warning) warnings.push(providerProfessionResult.warning);
  const providerProfessionByName = providerProfessionResult.professions;
  const activationByState = buildActivationMap(activation.deficitStates, providerProfessionByName);
  const optIns = contactPreferences
    .filter((preference) => preference.status === 'yes')
    .map(({ name, email }) => ({ name, email, profession: null, states: [], relevant_states: [] }));

  const metabaseFlaggedStates = new Set<string>();
  const allStates = new Set<string>([
    ...slots.keys(),
    ...monthlyVisits.keys(),
    ...sla.keys(),
    ...activationByState.keys(),
  ]);

  const states = [...allStates].sort().map((state) => {
    const visitCount = Math.max(monthlyVisits.get(state) ?? 0, 0);
    const dailyDemand = visitCount / 20;
    const weeklyVisits = dailyDemand * 5;
    const target = dailyDemand * 1.5;
    const targetHours = target / SLOTS_PER_PROVIDER_HOUR;
    const staffingMode = shouldUseAdHocRouting(weeklyVisits) ? 'ad_hoc' : 'proactive';
    const stateSlots = slots.get(state) ?? { today: 0, tomorrow: 0 };
    const todayRatio = safeRatio(stateSlots.today, target);
    const tomorrowRatio = safeRatio(stateSlots.tomorrow, target);
    const todayStatus = statusForCoverage(stateSlots.today, target);
    const tomorrowStatus = statusForCoverage(stateSlots.tomorrow, target);
    const coverageStatus = worstStatus(todayStatus, tomorrowStatus);
    const status = staffingMode === 'ad_hoc' ? 'ok' : coverageStatus;

    if (staffingMode === 'proactive' && (status === 'critical' || status === 'low')) {
      metabaseFlaggedStates.add(state);
    }

    return {
      state,
      member_population: memberPopulation.get(state) ?? null,
      monthly_visits: round(visitCount, 2),
      weekly_visits: round(weeklyVisits, 2),
      daily_demand: round(dailyDemand, 2),
      today_slots: round(stateSlots.today),
      tomorrow_slots: round(stateSlots.tomorrow),
      target: round(target),
      target_hours: round(targetHours),
      ratio: round(Math.min(todayRatio, tomorrowRatio), 4),
      today_ratio: round(todayRatio, 4),
      tomorrow_ratio: round(tomorrowRatio, 4),
      today_status: todayStatus,
      tomorrow_status: tomorrowStatus,
      coverage_status: coverageStatus,
      status,
      staffing_mode: staffingMode,
      ad_hoc_owner: adHocOwnerForState(state),
      sla_pct: sla.get(state) ?? null,
      opt_in_providers: [],
      non_opted_in_providers: [],
      candidates: activationByState.get(state) ?? [],
    } satisfies AlertState;
  });

  const proactiveStates = new Set(states
    .filter((state) => state.staffing_mode === 'proactive')
    .map((state) => state.state));
  const activationFlaggedStates = new Set([...activationByState.keys()]
    .filter((state) => proactiveStates.has(state)));
  const shouldUseActivationUnion = activationFlaggedStates.size > 0;
  const flaggedStates = new Set([
    ...metabaseFlaggedStates,
    ...(shouldUseActivationUnion ? activationFlaggedStates : []),
  ]);
  let relevantOptIns: OptInProvider[] = [];
  let providerLookupWarning: string | null = null;
  try {
    relevantOptIns = await enrichOptInsWithLicensedStates(supabase, optIns, flaggedStates);
  } catch (err) {
    providerLookupWarning = `Opted-in provider lookup unavailable: ${compactErrorMessage(err)}`;
    warnings.push(providerLookupWarning);
  }
  const optInsByState = buildOptInsByState(relevantOptIns);
  let nonOptedInByState = new Map<string, NonOptedInProvider[]>();
  try {
    nonOptedInByState = await fetchNonOptedInEligibleProviders(
      supabase,
      contactPreferences,
      flaggedStates,
    );
  } catch (err) {
    warnings.push(`Confirm-only provider lookup unavailable: ${compactErrorMessage(err)}`);
  }

  const expandedStates = states.map((state) => {
    const withOptIns = {
      ...state,
      opt_in_providers: optInsByState.get(state.state) ?? [],
      non_opted_in_providers: nonOptedInByState.get(state.state) ?? [],
    };
    if (!flaggedStates.has(state.state)) return withOptIns;
    if (withOptIns.status !== 'ok') return withOptIns;
    if (withOptIns.staffing_mode !== 'proactive') return withOptIns;

    return {
      ...withOptIns,
      status: 'low' as const,
      today_status: state.today_status,
      tomorrow_status: state.tomorrow_status,
    };
  });

  const sorted = expandedStates.sort((a, b) =>
    severityRank(a.status) - severityRank(b.status)
    || a.ratio - b.ratio
    || a.state.localeCompare(b.state)
  );

  const criticalStates = sorted.filter((s) => s.status === 'critical');
  const lowStates = sorted.filter((s) => s.status === 'low');
  const okStates = sorted.filter((s) => s.status === 'ok');

  const outreach = buildOutreachCopy(criticalStates, lowStates, today, tomorrow);
  warnings.push(...[
    activation.warning ? `Activation candidate fallback: ${compactErrorMessage(activation.warning)}` : null,
    memberPopulationResult.warning ? `Member population fallback: ${compactErrorMessage(memberPopulationResult.warning)}` : null,
  ].filter((warning): warning is string => Boolean(warning)));
  const warning = warnings.length ? warnings.join(' | ') : null;

  return {
    dataSource: activation.dataSource,
    criticalStates,
    lowStates,
    okStates,
    optInProviders: relevantOptIns,
    outreachEmailSubject: outreach.subject,
    outreachEmailBody: outreach.body,
    warning,
    providerLookupWarning,
  };
}

async function getMetabaseToken(): Promise<string> {
  const username = requireEnv('METABASE_USERNAME');
  const password = requireEnv('METABASE_PASSWORD');
  const res = await fetchMetabaseWithRetry(
    'Metabase auth',
    `${getMetabaseBaseUrl()}/api/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
  );

  if (!res.ok) {
    throw new Error(`Metabase auth failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json() as { id?: string };
  if (!body.id) throw new Error('Metabase auth failed: missing session id');
  return body.id;
}

async function fetchMetabaseCard(cardId: number, metabaseToken: string): Promise<Row[]> {
  const res = await fetchMetabaseWithRetry(
    `Metabase card ${cardId}`,
    `${getMetabaseBaseUrl()}/api/card/${cardId}/query/json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metabase-Session': metabaseToken,
      },
      body: JSON.stringify({}),
    },
  );

  if (!res.ok) {
    throw new Error(`Metabase card ${cardId} failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  if (Array.isArray(body)) return body as Row[];
  if (body?.data && Array.isArray(body.data.rows) && Array.isArray(body.data.cols)) {
    const cols = body.data.cols.map((c: { name?: string }) => c.name ?? '');
    return body.data.rows.map((row: unknown[]) =>
      Object.fromEntries(row.map((value, index) => [cols[index], value]))
    );
  }

  throw new Error(`Unexpected Metabase response shape for card ${cardId}`);
}

async function fetchMemberPopulationMap(
  metabaseToken: string,
): Promise<{ members: Map<string, number>; warning: string | null }> {
  const errors: string[] = [];
  const tried = new Set<number>();

  const tryCard = async (cardId: number): Promise<Map<string, number> | null> => {
    if (!Number.isFinite(cardId) || cardId <= 0 || tried.has(cardId)) return null;
    tried.add(cardId);

    try {
      const rows = await fetchMetabaseCard(cardId, metabaseToken);
      const members = buildMemberPopulationMap(rows);
      if (members.size === 0) {
        errors.push(`card ${cardId}: no state/member population rows parsed`);
        return null;
      }
      return members;
    } catch (err) {
      errors.push(`card ${cardId}: ${compactErrorMessage(err)}`);
      return null;
    }
  };

  for (const cardId of [CARD_MEMBER_POPULATION, FALLBACK_MEMBER_POPULATION_CARD]) {
    const members = await tryCard(cardId);
    if (members) return { members, warning: null };
  }

  for (const term of MEMBER_POPULATION_SEARCH_TERMS) {
    try {
      const cardIds = await searchMetabaseCardIds(term, metabaseToken);
      for (const cardId of cardIds) {
        const members = await tryCard(cardId);
        if (members) return { members, warning: null };
      }
    } catch (err) {
      errors.push(`search "${term}": ${compactErrorMessage(err)}`);
    }
  }

  return {
    members: new Map<string, number>(),
    warning: errors.slice(0, 6).join(' | ') || 'No member population card found',
  };
}

async function searchMetabaseCardIds(query: string, metabaseToken: string): Promise<number[]> {
  const url = `${getMetabaseBaseUrl()}/api/search?q=${encodeURIComponent(query)}&models=card`;
  const res = await fetchMetabaseWithRetry(
    `Metabase search "${query}"`,
    url,
    { headers: { 'X-Metabase-Session': metabaseToken } },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  const body = await res.json();
  const candidates = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return candidates
    .map((candidate: Record<string, unknown>) => Number(candidate.id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
}

async function fetchMetabaseWithRetry(
  label: string,
  input: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= METABASE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(input, init);
      const shouldRetry =
        !res.ok
        && RETRYABLE_METABASE_STATUSES.has(res.status)
        && attempt < METABASE_MAX_ATTEMPTS;

      if (!shouldRetry) return res;

      await res.text().catch(() => '');
    } catch (err) {
      lastError = err;
      if (attempt >= METABASE_MAX_ATTEMPTS) {
        throw new Error(`${label} request failed after ${attempt} attempts: ${errorMessage(err)}`);
      }
    }

    await sleep(METABASE_RETRY_BASE_DELAY_MS * attempt);
  }

  throw new Error(`${label} request failed: ${errorMessage(lastError)}`);
}

async function runSupabaseRead<T>(
  label: string,
  queryFactory: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SUPABASE_READ_MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await queryFactory();
    if (!error) return data as T;

    lastError = error;
    if (!isRetryableSupabaseReadError(error) || attempt >= SUPABASE_READ_MAX_ATTEMPTS) {
      throw new Error(`${label} failed: ${compactErrorMessage(error)}`);
    }

    await sleep(SUPABASE_READ_RETRY_BASE_DELAY_MS * attempt);
  }

  throw new Error(`${label} failed: ${compactErrorMessage(lastError)}`);
}

function isRetryableSupabaseReadError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes('522')
    || message.includes('connection timed out')
    || message.includes('timeout')
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('resource limit');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMetabaseBaseUrl(): string {
  return (Deno.env.get('METABASE_BASE_URL') ?? Deno.env.get('METABASE_URL') ?? 'https://metabase.vitablehealth.com')
    .replace(/\/+$/, '');
}

async function fetchActivationCandidates(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{
  dataSource: DataSource;
  deficitStates: Array<{ state: string; candidates: ActivationCandidate[] }>;
  warning: string | null;
}> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/suggest-activation-candidates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ utilization_threshold: 70, limit: 5, persist: false }),
    });

    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    const dataSource = normalizeDataSource(body?.data_source);
    const deficitStates = Array.isArray(body?.deficit_states)
      ? body.deficit_states.map((row: Record<string, unknown>) => ({
        state: normalizeState(row.state) ?? '',
        candidates: normalizeCandidates(row.candidates),
      })).filter((row: { state: string }) => row.state)
      : [];

    return { dataSource, deficitStates, warning: null };
  } catch (err) {
    return { dataSource: 'daily', deficitStates: [], warning: compactErrorMessage(err) };
  }
}

async function fetchJotformContactPreferences(today: string): Promise<ContactPreference[]> {
  const apiKey = requireEnv('JOTFORM_API_KEY');
  const currentMonthName = new Date(`${today}T12:00:00Z`).toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  const url =
    `https://api.jotform.com/form/${JOTFORM_FORM_ID}/submissions`
    + `?apiKey=${encodeURIComponent(apiKey)}&limit=${JOTFORM_LIMIT}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jotform opt-in fetch failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const submissions: JotformSubmission[] = Array.isArray(body?.content) ? body.content : [];
  const byProvider = new Map<string, ContactPreference>();

  for (const submission of submissions) {
    const answers = submission.answers ?? {};
    const name = answerToString(answers.q46).trim();
    const email = answerToString(answers.q5).trim() || null;
    const shiftTypes = answerToStringArray(answers.q10);
    const month = answerToString(answers.q49);
    const contacted = answerToString(answers.q35);

    if (!name) continue;
    if (!month.toLowerCase().includes(currentMonthName.toLowerCase())) continue;
    if (/test|maddi/i.test(name)) continue;
    if (isPermanentlyExcluded(name)) continue;
    if (isMentalHealthOnly(shiftTypes)) continue;

    const key = contactPreferenceKey(name, email);
    if (!key) continue;

    const existing = byProvider.get(key);
    if (!existing || compareSubmissionIds(submission.id, existing.submission_id) > 0) {
      byProvider.set(key, {
        submission_id: submission.id,
        name,
        email,
        status: normalizeContactPreferenceStatus(contacted),
      });
    }
  }

  return [...byProvider.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function enrichOptInsWithLicensedStates(
  supabase: { from: (table: string) => any },
  optIns: OptInProvider[],
  flaggedStates: Set<string>,
): Promise<OptInProvider[]> {
  if (optIns.length === 0 || flaggedStates.size === 0) return [];

  const providers = await runSupabaseRead<Array<Record<string, unknown>>>(
    'Provider match',
    () => supabase
      .from('providers')
      .select('id, name, email, profession, active, scheduling_outreach_exempt')
      .eq('active', true),
  );

  const eligibleProviders = providers
    .filter((provider: Record<string, unknown>) => provider.scheduling_outreach_exempt !== true);

  const providersByEmail = new Map<string, Record<string, unknown>>();
  const providerCandidates = eligibleProviders.map((provider: Record<string, unknown>) => {
    const email = String(provider.email ?? '').trim().toLowerCase();
    if (email) providersByEmail.set(email, provider);
    return {
      provider,
      canonical: canonicalName(String(provider.name ?? '')),
    };
  }).filter((entry: { canonical: string }) => entry.canonical);

  const matched = optIns.map((optIn) => {
    const email = optIn.email?.trim().toLowerCase() ?? '';
    const provider = email && providersByEmail.has(email)
      ? providersByEmail.get(email)!
      : findBestProviderNameMatch(optIn.name, providerCandidates);
    return { optIn, provider };
  });

  const providerIds = [...new Set(
    matched
      .map((entry) => entry.provider?.id)
      .filter((id): id is string => typeof id === 'string' && !!id),
  )];
  if (providerIds.length === 0) return [];

  const licenses = await runSupabaseRead<Array<Record<string, unknown>>>(
    'Provider license match',
    () => supabase
      .from('provider_licenses')
      .select('provider_id, state, status')
      .in('provider_id', providerIds)
      .eq('status', 'active'),
  );

  const statesByProvider = new Map<string, string[]>();
  for (const row of (licenses ?? []) as Array<Record<string, unknown>>) {
    const providerId = String(row.provider_id ?? '');
    const state = normalizeState(row.state);
    if (!providerId || !state) continue;
    const states = statesByProvider.get(providerId) ?? [];
    if (!states.includes(state)) states.push(state);
    statesByProvider.set(providerId, states);
  }

  return matched
    .map(({ optIn, provider }) => {
      const providerId = typeof provider?.id === 'string' ? provider.id : '';
      const profession = nullableString(provider?.profession);
      const states = (statesByProvider.get(providerId) ?? []).sort();
      const relevantStates = states.filter((state) =>
        flaggedStates.has(state) && canPracticeInAlertState(profession, state)
      );
      return {
        ...optIn,
        profession,
        states,
        relevant_states: relevantStates,
      };
    })
    .filter((provider) => provider.relevant_states.length > 0);
}

async function loadProviderProfessionByName(
  supabase: { from: (table: string) => any },
): Promise<{ professions: Map<string, string | null>; warning: string | null }> {
  let data: Array<Record<string, unknown>>;
  try {
    data = await runSupabaseRead<Array<Record<string, unknown>>>(
      'Provider profession fetch',
      () => supabase
        .from('providers')
        .select('name, profession')
        .eq('active', true),
    );
  } catch (err) {
    return {
      professions: new Map(),
      warning: `Provider profession lookup unavailable: ${compactErrorMessage(err)}`,
    };
  }

  const byName = new Map<string, string | null>();
  for (const provider of data) {
    const name = canonicalName(String(provider.name ?? ''));
    if (!name) continue;
    byName.set(name, nullableString(provider.profession));
  }
  return { professions: byName, warning: null };
}

async function fetchNonOptedInEligibleProviders(
  supabase: { from: (table: string) => any },
  contactPreferences: ContactPreference[],
  flaggedStates: Set<string>,
): Promise<Map<string, NonOptedInProvider[]>> {
  const states = [...flaggedStates].sort();
  const byState = new Map<string, NonOptedInProvider[]>();
  if (states.length === 0) return byState;

  const preferenceIndex = buildContactPreferenceIndex(contactPreferences);
  const eligibilityRows = await runSupabaseRead<Array<Record<string, unknown>>>(
    'Provider eligibility fetch',
    () => supabase
      .from('v_provider_state_eligibility')
      .select([
        'provider_id',
        'provider_name',
        'provider_email',
        'profession',
        'state',
        'license_sources',
        'metabase_active',
        'allocation_eligible',
        'eligibility_status',
      ].join(','))
      .in('state', states)
      .eq('provider_active', true)
      .eq('allocation_eligible', true),
  );

  const providerIds = [...new Set(
    eligibilityRows
      .map((row) => String(row.provider_id ?? ''))
      .filter(Boolean),
  )];

  const exemptProviderIds = new Set<string>();
  if (providerIds.length > 0) {
    const providerRows = await runSupabaseRead<Array<Record<string, unknown>>>(
      'Provider exemption fetch',
      () => supabase
        .from('providers')
        .select('id, scheduling_outreach_exempt')
        .in('id', providerIds),
    );
    for (const provider of providerRows) {
      if (provider.scheduling_outreach_exempt === true) {
        exemptProviderIds.add(String(provider.id ?? ''));
      }
    }
  }

  const seen = new Set<string>();
  for (const row of eligibilityRows) {
    const providerId = String(row.provider_id ?? '');
    const state = normalizeState(row.state);
    const name = String(row.provider_name ?? '').trim();
    const email = nullableString(row.provider_email);
    const profession = nullableString(row.profession);

    if (!providerId || !state || !name) continue;
    if (seen.has(`${providerId}:${state}`)) continue;
    if (exemptProviderIds.has(providerId)) continue;
    if (/test|maddi/i.test(name)) continue;
    if (isPermanentlyExcluded(name)) continue;
    if (!canPracticeInAlertState(profession, state)) continue;

    const preference = lookupContactPreference(preferenceIndex, name, email);
    if (preference?.status === 'yes') continue;

    const provider = {
      name,
      email,
      profession,
      opt_in_status: nonOptedInStatus(preference),
      opt_in_confirmation: nonOptedInConfirmation(preference),
      eligibility_status: nullableString(row.eligibility_status),
      metabase_active: typeof row.metabase_active === 'boolean' ? row.metabase_active : null,
      license_sources: unknownToStringArray(row.license_sources),
    } satisfies NonOptedInProvider;

    seen.add(`${providerId}:${state}`);
    const providers = byState.get(state) ?? [];
    providers.push(provider);
    byState.set(state, providers);
  }

  for (const [state, providers] of byState.entries()) {
    byState.set(state, providers.sort((a, b) =>
      nonOptedInStatusRank(a.opt_in_status) - nonOptedInStatusRank(b.opt_in_status)
      || a.name.localeCompare(b.name)
    ));
  }

  return byState;
}

function findBestProviderNameMatch(
  optInName: string,
  candidates: Array<{ provider: Record<string, unknown>; canonical: string }>,
): Record<string, unknown> | null {
  const target = canonicalName(optInName);
  if (!target) return null;

  let best: { provider: Record<string, unknown>; score: number } | null = null;
  for (const candidate of candidates) {
    const score = nameSimilarity(target, candidate.canonical);
    if (!best || score > best.score) best = { provider: candidate.provider, score };
  }

  return best && best.score >= 0.82 ? best.provider : null;
}

function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return (2 * overlap) / (left.size + right.size);
}

function buildOptInsByState(optIns: OptInProvider[]) {
  const byState = new Map<string, Array<{ name: string; email: string | null; profession: string | null }>>();
  for (const provider of optIns) {
    for (const state of provider.relevant_states) {
      const stateProviders = byState.get(state) ?? [];
      stateProviders.push({ name: provider.name, email: provider.email, profession: provider.profession });
      byState.set(state, stateProviders);
    }
  }

  for (const [state, providers] of byState.entries()) {
    byState.set(state, providers.sort((a, b) => a.name.localeCompare(b.name)));
  }

  return byState;
}

function buildSlotMap(rows: Row[], today: string, tomorrow: string) {
  const slots = new Map<string, { today: number; tomorrow: number }>();

  for (const row of rows) {
    const state = normalizeState(getString(row, ['state', 'state_abbreviation', 'State']));
    const date = toDateKey(getValue(row, ['date_actual: Day', 'date_actual', 'Day', 'date']));
    const value = getNumber(row, [
      'Sum of same_next_day_available_slots',
      'same_next_day_available_slots',
      'available_slots',
      'slots',
    ]);

    if (!state || !date || value === null) continue;
    if (date !== today && date !== tomorrow) continue;
    if (!slots.has(state)) slots.set(state, { today: 0, tomorrow: 0 });
    const entry = slots.get(state)!;
    if (date === today) entry.today += value;
    if (date === tomorrow) entry.tomorrow += value;
  }

  return slots;
}

function buildMonthlyVisitMap(rows: Row[]) {
  const visits = new Map<string, number>();

  for (const row of rows) {
    const state = normalizeState(getString(row, ['state', 'state_abbreviation', 'State']));
    const value = getNumber(row, [
      'monthly_visits',
      'completed_visits',
      'Completed Visits',
      'visits',
      'Visits',
      'count',
      'Count',
    ]) ?? firstNumericValue(row);
    if (!state || value === null) continue;
    visits.set(state, Math.max(value, visits.get(state) ?? 0));
  }

  return visits;
}

function buildSlaMap(rows: Row[]) {
  const sla = new Map<string, number>();

  for (const row of rows) {
    const state = normalizeState(getString(row, ['state', 'state_abbreviation', 'State']));
    const value = getNumber(row, [
      'sla_pct',
      'SLA Attainment Rate',
      'Average of SLA Attainment Rate',
      'SD/ND SLA Attainment % MTD',
      'Average of SD/ND SLA Attainment Rate',
    ]) ?? firstNumericValue(row);
    if (!state || value === null) continue;
    sla.set(state, normalizePct(value));
  }

  return sla;
}

function buildMemberPopulationMap(rows: Row[]) {
  const members = new Map<string, number>();

  for (const row of rows) {
    const state = normalizeState(getString(row, [
      'state',
      'State',
      'service_state',
      'Appointment State',
      'appointment_state',
      'Active State',
      'active_state',
    ]));
    const value = getNumber(row, [
      'member_population',
      'Member Population',
      'population',
      'Population',
      'Active Members Count',
      'active_members_count',
      'Active Members Count by Active State - Appointment State → Distinct values of Member ID',
      'Active Members',
      'active_members',
      'members',
      'Distinct values of Member ID',
    ]);

    if (!state || value === null) continue;
    members.set(state, Math.max(Math.round(value), members.get(state) ?? 0));
  }

  return members;
}

function buildActivationMap(
  deficitStates: Array<{ state: string; candidates: ActivationCandidate[] }>,
  providerProfessionByName: Map<string, string | null>,
) {
  const byState = new Map<string, ActivationCandidate[]>();

  for (const row of deficitStates) {
    const candidates = row.candidates
      .filter((candidate) => !isPermanentlyExcluded(candidate.provider_name))
      .map((candidate) => ({
        ...candidate,
        profession: candidate.profession ?? providerProfessionByName.get(canonicalName(candidate.provider_name)) ?? null,
      }))
      .filter((candidate) => canPracticeInAlertState(candidate.profession, row.state))
      .slice(0, 5);
    byState.set(row.state, candidates);
  }

  return byState;
}

function normalizeCandidates(value: unknown): ActivationCandidate[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((candidate): ActivationCandidate => {
      const row = candidate as Record<string, unknown>;
      return {
        provider_name: String(row.provider_name ?? row.name ?? '').trim(),
        profession: nullableString(row.profession),
        utilization_pct: toNumber(row.utilization_pct),
        readiness_status: nullableString(row.readiness_status),
        ehr_activation_status: nullableString(row.ehr_activation_status),
      };
    })
    .filter((candidate) => candidate.provider_name && !isPermanentlyExcluded(candidate.provider_name));
}

function buildOutreachCopy(
  criticalStates: AlertState[],
  lowStates: AlertState[],
  today: string,
  tomorrow: string,
) {
  const highestNeed = [...criticalStates, ...lowStates]
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 5);

  if (highestNeed.length === 0) {
    return {
      subject: 'No Proactive Outreach Needed - Today & Tomorrow',
      body: [
        'Hi team,',
        '',
        'No proactive same-day / next-day provider outreach is needed based on current demand.',
        'If Member Support requests a visit in a low-volume state, route ad hoc coverage through the owner listed in the Slack handoff.',
        '',
        'Thank you,',
        'Provider Support Team, Vitable Health',
      ].join('\n'),
    };
  }

  const subjectStates = criticalStates.length > 0 ? criticalStates : highestNeed;
  const subjectLabel = subjectStates.length > 3
    ? 'Multiple States'
    : subjectStates.map((s) => s.state).join(', ') || 'Multiple States';
  const todayLabel = formatHumanDate(today, true);
  const tomorrowLabel = formatHumanDate(tomorrow, true);
  const stateLabel = highestNeed.map((s) => s.state).join(', ') || 'priority states';

  return {
    subject: `Additional Availability Needed - ${subjectLabel} - Today & Tomorrow`,
    body: [
      'Hi team,',
      '',
      `We are contacting opted-in providers who are already licensed in ${stateLabel} for additional same-day / next-day appointment availability.`,
      `If you can add time for today (${todayLabel}) or tomorrow (${tomorrowLabel}), please reply to this email/message with the date, time window, timezone, and state(s) you can cover if known.`,
      '',
      'Provider state activation changes are a last resort only after opted-in outreach cannot close the gap.',
      '',
      'Thank you,',
      'Provider Support Team, Vitable Health',
    ].join('\n'),
  };
}

async function postSlackAlert(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
  result: AlertResult,
  today: string,
): Promise<SlackPostResult> {
  const channelId = requireEnv('SLACK_CHANNEL_ID');
  const parentText = buildSlackParentText(result, today);
  const parent = await postSlackMessage(supabase, { channel: channelId, text: parentText });
  const threadText = buildSlackThreadText(result, today);
  const thread = await postSlackMessage(supabase, { channel: channelId, text: threadText, thread_ts: parent.ts });

  return {
    parentTs: parent.ts,
    threadTs: thread.ts,
    channelId,
  };
}

async function updatePostedSlackAlert(
  supabase: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  today: string,
  tomorrow: string,
  requestBody: SlackUpdateRequest,
) {
  const rowId = nullableString(requestBody.row_id);
  let channelId = nullableString(requestBody.channel_id);
  let parentTs = nullableString(requestBody.parent_ts);
  let threadTs = nullableString(requestBody.thread_ts);

  if (rowId) {
    const { data, error } = await supabase
      .from('coverage_alerts')
      .select('slack_parent_ts, slack_thread_ts, slack_channel_id')
      .eq('id', rowId)
      .single();
    if (error) throw new Error(`coverage_alerts lookup failed: ${error.message}`);

    const row = data as Record<string, unknown>;
    channelId = channelId ?? nullableString(row.slack_channel_id);
    parentTs = parentTs ?? nullableString(row.slack_parent_ts);
    threadTs = threadTs ?? nullableString(row.slack_thread_ts);
  }

  channelId = channelId ?? requireEnv('SLACK_CHANNEL_ID');
  if (!parentTs) throw new Error('parent_ts or row_id with slack_parent_ts is required');

  const result = await buildAlertResult(supabaseUrl, serviceRoleKey, today, tomorrow);
  const parent = await updateSlackMessage(supabase, {
    channel: channelId,
    ts: parentTs,
    text: buildSlackParentText(result, today),
  });
  const thread = threadTs
    ? await updateSlackMessage(supabase, {
      channel: channelId,
      ts: threadTs,
      text: buildSlackThreadText(result, today),
    })
    : null;

  return {
    ok: true,
    row_id: rowId,
    slack_updated: true,
    slack_parent_ts: parent.ts,
    slack_thread_ts: thread?.ts ?? null,
    slack_channel_id: channelId,
    critical_count: result.criticalStates.length,
    low_count: result.lowStates.length,
    opt_in_provider_count: result.optInProviders.length,
    warning: result.warning,
  };
}

function buildSlackParentText(result: AlertResult, today: string) {
  const headerDate = formatHumanDate(today, false);
  const actionStates = getActionStates(result);
  const adHocStates = getAdHocStates(result);

  const lines = [
    `*Same/Next-Day Coverage - ${headerDate}*`,
    '',
    `*Today's status*`,
  ];

  if (actionStates.length === 0) {
    lines.push(':white_check_mark: No proactive provider outreach needed today.');
    lines.push(':white_check_mark: No proactive staffing needed today.');
    if (adHocStates.length > 0) {
      lines.push(':warning: Only act if Member Support/MSS requests a visit in a state listed in the thread.');
    } else {
      lines.push(':white_check_mark: No action needed unless bookings change.');
    }
  } else {
    const icon = result.criticalStates.length > 0 ? ':rotating_light:' : ':warning:';
    lines.push(`${icon} Action needed: proactive provider outreach for ${formatStateList(actionStates)}.`);
    lines.push('Use the thread for provider emails, draft copy, and state routing.');
    if (adHocStates.length > 0) {
      lines.push(':warning: For ad hoc states, only act if Member Support/MSS requests a visit.');
    }
  }

  return lines.join('\n');
}

function buildSlackThreadText(result: AlertResult, today: string) {
  const headerDate = formatHumanDate(today, false);
  const todayLabel = formatHumanDate(today, true);
  const tomorrow = addDays(today, 1);
  const tomorrowLabel = formatHumanDate(tomorrow, true);
  const actionStates = getActionStates(result);
  const routingStates = getRoutingStates(result);
  const contacts = collectContactProviders(actionStates);
  const contactEmails = contacts
    .map((provider) => provider.email)
    .filter((email): email is string => Boolean(email));
  const missingEmailProviders = contacts.filter((provider) => !provider.email);
  const stateList = actionStates.map((state) => state.state).join(', ') || 'priority states';

  const lines = [
    `*Same/Next-Day Coverage Details - ${headerDate}*`,
    '',
    '*Links*',
    `- ${formatDashboardLink()}`,
    `- ${formatSopLink()}`,
    '',
    `*Today's status*`,
  ];

  if (actionStates.length === 0) {
    lines.push(':white_check_mark: No proactive provider outreach needed today.');
    lines.push(':white_check_mark: No outreach email needs to be sent.');
  } else {
    const icon = result.criticalStates.length > 0 ? ':rotating_light:' : ':warning:';
    lines.push(`${icon} Proactive provider outreach is needed for ${formatStateList(actionStates)}.`);
    lines.push(':warning: Use the email list and draft below.');
  }

  lines.push('');
  lines.push('*When to act*');
  if (actionStates.length > 0) {
    lines.push('- Send proactive outreach now for states marked "yes" below.');
    lines.push('- Do not contact non-opted-in providers unless ClinOps approves it.');
  } else {
    lines.push('- Do not send provider outreach now.');
    lines.push('- Act only if Member Support/MSS requests a visit.');
  }

  lines.push('');
  lines.push('*Step-by-step action path*');
  if (actionStates.length === 0) {
    lines.push('1. Do not send an outreach email today.');
    lines.push('2. If Member Support/MSS requests a visit, check the state below.');
    lines.push('3. Ask the listed owner first.');
    lines.push('4. If the owner cannot cover, ask Kate.');
    lines.push('5. If Kate cannot cover, escalate to ClinOps.');
  } else {
    lines.push('1. Copy the email list below.');
    lines.push('2. Send one message using the draft below.');
    lines.push('3. Track provider replies from email or message replies.');
    lines.push('4. Update the scheduling dashboard after each confirmed addition.');
    lines.push('5. Escalate before contacting non-opted-in providers or changing activation.');
    lines.push('');
    lines.push('*Emails to contact*');
    if (result.providerLookupWarning) {
      lines.push('Provider email lookup is temporarily unavailable. Escalate to ClinOps before sending outreach.');
    } else {
      lines.push(contactEmails.length > 0
        ? contactEmails.join(', ')
        : 'No opted-in providers found. Escalate to ClinOps lead before contacting non-opted-in providers.');
    }

    if (missingEmailProviders.length > 0) {
      lines.push('');
      lines.push('*Opted-in providers missing email*');
      lines.push(missingEmailProviders.map((provider) =>
        `${escapeSlack(provider.name)} (${provider.states.join(', ')})`
      ).join('; '));
    }

    lines.push('');
    lines.push('*Bulk draft message*');
    lines.push('```');
    lines.push('Subject: Additional availability needed today/tomorrow');
    lines.push('');
    lines.push('Hi team,');
    lines.push('');
    lines.push(`We have same-day / next-day appointment availability needs in ${stateList}.`);
    lines.push(`If you can add appointment availability for today (${todayLabel}) or tomorrow (${tomorrowLabel}), reply to this email/message with:`);
    lines.push('- date');
    lines.push('- start and end time');
    lines.push('- timezone');
    lines.push('- state(s) you can cover, if known');
    lines.push('');
    lines.push('Thank you,');
    lines.push('Provider Support Team, Vitable Health');
    lines.push('```');
  }

  lines.push('');
  lines.push('*State-specific routing*');
  if (routingStates.length === 0) {
    lines.push('- No state-specific routing needed right now.');
  } else {
    lines.push(...routingStates.slice(0, 12).map(formatStateRoutingLine));
    if (routingStates.length > 12) {
      lines.push(`- ${routingStates.length - 12} more state(s) are in the dashboard.`);
    }
  }

  const confirmOnlyLines = actionStates
    .filter((state) => state.non_opted_in_providers.length > 0)
    .slice(0, 12)
    .map(formatConfirmOnlyLine);
  if (confirmOnlyLines.length > 0) {
    lines.push('');
    lines.push('*Confirm-only provider pool*');
    lines.push('Do not contact these providers without ClinOps approval.');
    lines.push(...confirmOnlyLines);
  }

  return lines.join('\n');
}

function appendWarning(existing: string | null, warning: string | null) {
  if (!warning) return existing;
  return existing ? `${existing} | ${warning}` : warning;
}

function getActionStates(result: AlertResult) {
  return [...result.criticalStates, ...result.lowStates]
    .sort((a, b) => severityRank(a.status) - severityRank(b.status) || a.ratio - b.ratio);
}

function getAdHocStates(result: AlertResult) {
  return [...result.criticalStates, ...result.lowStates, ...result.okStates]
    .filter((state) => state.staffing_mode === 'ad_hoc' && state.coverage_status !== 'ok')
    .sort((a, b) =>
      b.weekly_visits - a.weekly_visits
      || (b.member_population ?? -1) - (a.member_population ?? -1)
      || a.state.localeCompare(b.state)
    );
}

function getRoutingStates(result: AlertResult) {
  const byState = new Map<string, AlertState>();
  for (const state of [...getActionStates(result), ...getAdHocStates(result)]) {
    byState.set(state.state, state);
  }
  return [...byState.values()]
    .sort((a, b) =>
      severityRank(a.status) - severityRank(b.status)
      || b.weekly_visits - a.weekly_visits
      || a.state.localeCompare(b.state)
    );
}

function formatStateRoutingLine(state: AlertState) {
  const physicianLabel = PHYSICIAN_ONLY_STATES.has(state.state) ? ' - physician-only' : '';
  const stateLabel = escapeSlack(`${state.state}${physicianLabel}`);
  const slotLabel = `${state.today_slots} slots today / ${state.tomorrow_slots} tomorrow`;
  const memberLabel = formatMemberPopulationForSlack(state.member_population);

  if (state.staffing_mode === 'ad_hoc') {
    return `- *${stateLabel}* - ask ${escapeSlack(state.ad_hoc_owner)} first. `
      + `Proactive outreach: no. Action: only act if Member Support/MSS requests a visit. `
      + `${memberLabel}, ${slotLabel}.`;
  }

  const contactCount = state.opt_in_providers.filter((provider) => provider.email).length;
  const askFirst = contactCount > 0 ? 'opted-in provider list in the thread' : 'ClinOps lead';
  const action = contactCount > 0
    ? 'contact opted-in providers now'
    : 'escalate before contacting non-opted-in providers';
  return `- *${stateLabel}* - ask ${askFirst} first. `
    + `Proactive outreach: yes. Action: ${action}. `
    + `${memberLabel}, ${slotLabel}.`;
}

function collectContactProviders(states: AlertState[]) {
  const byKey = new Map<string, { name: string; email: string | null; states: string[] }>();

  for (const state of states) {
    for (const provider of state.opt_in_providers) {
      const key = provider.email?.toLowerCase() || canonicalName(provider.name);
      if (!key) continue;
      const existing = byKey.get(key) ?? { name: provider.name, email: provider.email, states: [] };
      if (!existing.states.includes(state.state)) existing.states.push(state.state);
      byKey.set(key, existing);
    }
  }

  return [...byKey.values()]
    .map((provider) => ({ ...provider, states: provider.states.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatConfirmOnlyLine(state: AlertState) {
  const providers = state.non_opted_in_providers.slice(0, 5).map((provider) =>
    provider.email ? `${escapeSlack(provider.name)} &lt;${escapeSlack(provider.email)}&gt;` : escapeSlack(provider.name)
  );
  const suffix = state.non_opted_in_providers.length > 5
    ? `; +${state.non_opted_in_providers.length - 5} more`
    : '';
  return `- *${escapeSlack(`${state.state}${physicianOnlyNote(state.state)}`)}* - ${providers.join('; ')}${suffix}`;
}

async function postSlackMessage(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
  payload: { channel: string; text: string; thread_ts?: string },
) {
  const token = await getSlackAccessToken(supabase);
  const res = await fetch(SLACK_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
      ...payload,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true || !body?.ts) {
    throw new Error(`Slack API error: ${res.status} ${JSON.stringify(body)}`);
  }

  return { ts: String(body.ts) };
}

async function updateSlackMessage(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
  payload: { channel: string; ts: string; text: string },
) {
  const token = await getSlackAccessToken(supabase);
  const res = await fetch(SLACK_UPDATE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      as_user: true,
      blocks: [],
      attachments: [],
      ...payload,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true || !body?.ts) {
    throw new Error(`Slack update error: ${res.status} ${JSON.stringify(body)}`);
  }

  return { ts: String(body.ts) };
}

async function getSlackAccessToken(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
) {
  const staticToken = Deno.env.get('SLACK_BOT_TOKEN')?.trim();
  if (staticToken) return staticToken;

  const vaultCredentials = await getSlackVaultCredentials(supabase);
  if (hasSlackVaultCredentials(vaultCredentials)) {
    const expiresAt = new Date(vaultCredentials.expires_at ?? 0).getTime();
    const refreshWindowMs = 10 * 60 * 1000;
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > refreshWindowMs) {
      return vaultCredentials.access_token;
    }
    return await refreshSlackAccessToken(supabase, vaultCredentials);
  }

  throw new Error('Slack token missing: configure SLACK_BOT_TOKEN or Slack OAuth credentials in Supabase Vault');
}

async function getSlackVaultCredentials(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
): Promise<SlackOAuthCredentials | null> {
  const { data, error } = await supabase.rpc('get_slack_oauth_credentials');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    access_token: nullableString(row.access_token),
    refresh_token: nullableString(row.refresh_token),
    client_id: nullableString(row.client_id),
    client_secret: nullableString(row.client_secret),
    expires_at: nullableString(row.expires_at),
  };
}

function hasSlackVaultCredentials(
  credentials: SlackOAuthCredentials | null,
): credentials is SlackOAuthReadyCredentials {
  return Boolean(
    credentials?.access_token
      && credentials.refresh_token
      && credentials.client_id
      && credentials.client_secret,
  );
}

async function refreshSlackAccessToken(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => any },
  credentials: SlackOAuthReadyCredentials,
) {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
  });
  const basicAuth = btoa(`${credentials.client_id}:${credentials.client_secret}`);

  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true || !body?.access_token) {
    throw new Error(`Slack token refresh failed: ${res.status} ${JSON.stringify(body)}`);
  }

  const expiresIn = Number(body.expires_in ?? 43200);
  const expiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();
  const refreshToken = String(body.refresh_token ?? credentials.refresh_token);
  const accessToken = String(body.access_token);

  const { error } = await supabase.rpc('update_slack_oauth_credentials', {
    new_access_token: accessToken,
    new_refresh_token: refreshToken,
    new_expires_at: expiresAt,
  });
  if (error) {
    throw new Error(`Slack token refresh succeeded, but Vault update failed: ${error.message}`);
  }

  return accessToken;
}

function answerToString(answer: JotformAnswer | undefined): string {
  if (!answer) return '';
  const value = answer.answer ?? answer.prettyFormat ?? '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v) => answerUnknownToString(v)).filter(Boolean).join(', ');
  if (typeof value === 'object' && value !== null) return answerUnknownToString(value);
  return '';
}

function answerToStringArray(answer: JotformAnswer | undefined): string[] {
  if (!answer) return [];
  const value = answer.answer ?? answer.prettyFormat ?? '';
  if (Array.isArray(value)) return value.map((v) => answerUnknownToString(v)).filter(Boolean);
  return answerToString(answer)
    .split(/[,;\n|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function answerUnknownToString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v) => answerUnknownToString(v)).filter(Boolean).join(' ');
  if (typeof value === 'object' && value !== null) {
    const row = value as Record<string, unknown>;
    const nameParts = [row.first, row.middle, row.last].map((v) => String(v ?? '').trim()).filter(Boolean);
    if (nameParts.length) return nameParts.join(' ');
    return Object.values(row).map((v) => answerUnknownToString(v)).filter(Boolean).join(' ');
  }
  return '';
}

function isMentalHealthOnly(shiftTypes: string[]) {
  const normalized = shiftTypes.map((s) => canonicalName(s)).filter(Boolean);
  return normalized.length > 0 && normalized.every((s) => s === 'mental health');
}

function compareSubmissionIds(a: string, b: string) {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left > right ? 1 : left < right ? -1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}

type ContactPreferenceIndex = {
  byEmail: Map<string, ContactPreference>;
  byName: Map<string, ContactPreference>;
};

function buildContactPreferenceIndex(preferences: ContactPreference[]): ContactPreferenceIndex {
  const byEmail = new Map<string, ContactPreference>();
  const byName = new Map<string, ContactPreference>();

  for (const preference of preferences) {
    const email = preference.email?.trim().toLowerCase();
    const name = canonicalName(preference.name);
    if (email) byEmail.set(email, preference);
    if (name) byName.set(name, preference);
  }

  return { byEmail, byName };
}

function lookupContactPreference(
  index: ContactPreferenceIndex,
  name: string,
  email: string | null,
): ContactPreference | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail && index.byEmail.has(normalizedEmail)) {
    return index.byEmail.get(normalizedEmail)!;
  }

  const normalizedName = canonicalName(name);
  return normalizedName ? index.byName.get(normalizedName) ?? null : null;
}

function contactPreferenceKey(name: string, email: string | null) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) return `email:${normalizedEmail}`;
  const normalizedName = canonicalName(name);
  return normalizedName ? `name:${normalizedName}` : '';
}

function normalizeContactPreferenceStatus(value: string): ContactPreferenceStatus {
  const normalized = canonicalName(value);
  if (!normalized) return 'unknown';
  if (/\b(no|n)\b/.test(normalized) || normalized.includes('opt out') || normalized.includes('do not')) {
    return 'no';
  }
  if (/\b(yes|y)\b/.test(normalized) || normalized.includes('opt in')) {
    return 'yes';
  }
  return 'unknown';
}

function nonOptedInStatus(preference: ContactPreference | null): NonOptedInProvider['opt_in_status'] {
  if (!preference) return 'not_found';
  return preference.status === 'no' ? 'no' : 'unknown';
}

function nonOptedInConfirmation(preference: ContactPreference | null) {
  if (!preference) return 'No current-month Jotform opt-in found';
  if (preference.status === 'no') return 'Jotform current-month response: No';
  return 'Jotform current-month response is not Yes';
}

function nonOptedInStatusRank(status: NonOptedInProvider['opt_in_status']) {
  if (status === 'no') return 0;
  if (status === 'unknown') return 1;
  return 2;
}

function unknownToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,;\n|]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function canPracticeInAlertState(profession: string | null, state: string) {
  if (!PHYSICIAN_ONLY_STATES.has(state)) return true;
  return isPhysicianProfession(profession);
}

function isPhysicianProfession(profession: string | null) {
  return PHYSICIAN_PROFESSIONS.has(String(profession ?? '').trim().toLowerCase());
}

function physicianOnlyNote(state: string) {
  return PHYSICIAN_ONLY_STATES.has(state) ? ' physician-only' : '';
}

function shouldUseAdHocRouting(weeklyVisits: number) {
  return weeklyVisits < AD_HOC_WEEKLY_VISIT_THRESHOLD;
}

function adHocOwnerForState(state: string) {
  return AD_HOC_OWNER_BY_STATE[state] ?? 'Shanta';
}

function statusForCoverage(availableSlots: number, targetSlots: number): AlertStatus {
  if (!Number.isFinite(targetSlots) || targetSlots <= 0) return 'ok';
  const ratio = availableSlots / targetSlots;
  if (ratio < 1) return 'critical';
  if (ratio < 2) return 'low';
  return 'ok';
}

function worstStatus(a: AlertStatus, b: AlertStatus): AlertStatus {
  return severityRank(a) <= severityRank(b) ? a : b;
}

function severityRank(status: AlertStatus) {
  if (status === 'critical') return 0;
  if (status === 'low') return 1;
  return 2;
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function normalizeDataSource(value: unknown): DataSource {
  return value === 'five_week_avg' || value === 'mixed' || value === 'daily' ? value : 'daily';
}

function normalizeState(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return STATE_NAMES[raw.toLowerCase()] ?? null;
}

function getValue(row: Row, aliases: string[]): unknown {
  const key = findKey(row, aliases);
  return key ? row[key] : undefined;
}

function getString(row: Row, aliases: string[]): string {
  const value = getValue(row, aliases);
  return value == null ? '' : String(value);
}

function getNumber(row: Row, aliases: string[]): number | null {
  const value = getValue(row, aliases);
  return toNumber(value);
}

function findKey(row: Row, aliases: string[]): string | null {
  const keys = Object.keys(row);
  const normalizedKeys = keys.map((key) => ({ key, normalized: normalizeKey(key) }));

  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    const exact = normalizedKeys.find((entry) => entry.normalized === normalizedAlias);
    if (exact) return exact.key;

    const aliasParts = normalizedAlias.split(' ').filter(Boolean);
    const contains = normalizedKeys.find((entry) =>
      aliasParts.length > 0 && aliasParts.every((part) => entry.normalized.includes(part))
    );
    if (contains) return contains.key;
  }

  return null;
}

function firstNumericValue(row: Row): number | null {
  for (const [key, value] of Object.entries(row)) {
    if (normalizeKey(key).includes('state') || normalizeKey(key).includes('date')) continue;
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[%,$\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function normalizePct(value: number) {
  return value > 0 && value <= 1 ? round(value * 100, 2) : round(value, 2);
}

function toDateKey(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getChicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatHumanDate(date: string, includeWeekday: boolean) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    ...(includeWeekday ? { weekday: 'long' as const } : {}),
    month: 'short',
    day: 'numeric',
  });
}

function canonicalName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isPermanentlyExcluded(name: string) {
  const normalized = canonicalName(name);
  if (!normalized) return false;
  return PERMANENT_EXCLUDED_NAMES.some((excluded) => {
    const ex = canonicalName(excluded);
    return normalized === ex || normalized.includes(ex) || ex.includes(normalized);
  });
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function formatStateList(states: AlertState[]) {
  return states.map((state) => state.state).join(', ') || 'none';
}

function formatDashboardLink() {
  return slackLink(DASHBOARD_URL, 'Open ClinOps dashboard');
}

function formatSopLink() {
  const sopUrl = getSopUrl();
  if (sopUrl) return slackLink(sopUrl, 'Same-Day / Next-Day Coverage SOP');
  return 'SOP link is not configured yet. Ask ClinOps lead for the Same-Day / Next-Day Coverage SOP.';
}

function getSopUrl() {
  for (const name of SOP_URL_SECRET_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return '';
}

function slackLink(url: string, label: string) {
  return `<${escapeSlack(url)}|${escapeSlack(label)}>`;
}

function formatMemberPopulationForSlack(memberPopulation: number | null) {
  return memberPopulation === null ? 'member count unavailable' : `${memberPopulation.toLocaleString('en-US')} members`;
}

function formatRatio(ratio: number) {
  return round(ratio, 2).toFixed(2);
}

function formatMemberPopulation(memberPopulation: number | null) {
  return memberPopulation === null ? 'members n/a' : `${memberPopulation.toLocaleString('en-US')} members`;
}

function formatVisits(visits: number) {
  return formatNumber(visits);
}

function formatSlots(slots: number) {
  return formatNumber(slots);
}

function formatHours(hours: number) {
  return formatNumber(hours);
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10) return round(value, 1).toLocaleString('en-US');
  if (Math.abs(value) >= 1) return round(value, 1).toLocaleString('en-US');
  return round(value, 2).toLocaleString('en-US');
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function escapeSlack(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} secret is required`);
  return value;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const row = err as Record<string, unknown>;
    const direct = nullableString(row.message)
      ?? nullableString(row.error)
      ?? nullableString(row.details)
      ?? nullableString(row.hint);
    if (direct) return direct;
    try {
      return JSON.stringify(row);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function compactErrorMessage(err: unknown) {
  const message = errorMessage(err).replace(/\s+/g, ' ').trim();
  if (!message) return 'Unknown error';
  if (message.includes('Error code 522') || /connection timed out/i.test(message)) {
    return 'Supabase API returned Cloudflare 522 connection timeout';
  }
  if (message.length > 240) return `${message.slice(0, 237)}...`;
  return message;
}

async function readJsonBody<T extends Record<string, unknown>>(req: Request): Promise<T> {
  if (req.method === 'GET' || req.method === 'HEAD') return {} as T;
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return {} as T;
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as T : {} as T;
  } catch {
    return {} as T;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
