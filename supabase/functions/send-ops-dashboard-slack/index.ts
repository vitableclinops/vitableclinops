import { createClient } from 'npm:@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const OPS_CHANNEL_ID = 'C08A03ET7C3'; // #appointment-availability-update
const DASHBOARD_URL = 'https://vitableclinops.lovable.app/admin/ops';

// A daily routing run computed within this window is considered fresh enough
// to post without recomputing. The morning compute job runs before the Slack
// window, so the digest normally just reads its output.
const FRESH_MS = 18 * 60 * 60 * 1000;

type Status = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

type StateRow = {
  state: string;
  demand_hours: number | null;
  demand_source: string | null;
  booked_locked_hours: number;
  confirmed_assigned_hours: number;
  confirmed_coverage_hours: number;
  tentative_upside_hours: number;
  coverage_ratio: number | null;
  gap_hours: number;
  status: Status;
};
type AssignmentRow = {
  name: string;
  profession: string | null;
  scheduled_hours: number;
  booked_locked_hours: number;
  assignments: { state: string; hours: number }[];
  unassigned_free_hours: number;
};
type MoveRow = { name: string; state: string; hours: number };
type AddRow = {
  state: string; name: string; profession: string | null; source: string;
  available_hours: number | null; tentative: boolean; utilization_pct: number | null;
};
type DateResult = {
  date: string;
  state_coverage: StateRow[];
  provider_assignments: AssignmentRow[];
  moves: MoveRow[];
  adds: AddRow[];
  warnings: { type: string; detail: string }[];
};
type AccessProviderRow = {
  name: string;
  bookedSlots: number;
  availableSlots: number;
  totalSlots: number;
  utilizationPct: number;
};
type AccessSnapshot = {
  date: string;
  bookedSlots: number;
  availableSlots: number;
  totalSlots: number;
  utilizationPct: number;
  providerCount: number;
  syncedAt: string | null;
  providers: AccessProviderRow[];
};
type StateAccessRow = {
  state: string;
  bookedSlots: number | null;
  availableSlots: number | null;
  totalSlots: number | null;
  utilizationPct: number | null;
};
type StateAccessSnapshot = {
  date: string;
  source: string;
  syncedAt: string | null;
  rows: StateAccessRow[];
};

function getChicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function statusEmoji(s: Status): string {
  switch (s) {
    case 'ok': return '🟢';
    case 'low': return '🟡';
    case 'critical': return '🟠';
    case 'zero': return '🔴';
    case 'no_data': return '⚪';
  }
}
const STATUS_ORDER: Record<Status, number> = { zero: 0, critical: 1, low: 2, ok: 3, no_data: 4 };
const fmtH = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}h`;
const fmtSlots = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtPct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const isDryRun = body?.dry_run === true;
    const recompute = body?.recompute === true;
    const overrideDate = typeof body?.date === 'string' ? (body.date as string) : null;

    const today = overrideDate ?? getChicagoDate();
    const dates = overrideDate ? [overrideDate] : [today, addDays(today, 1)];

    if (!isDryRun) {
      if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
      if (!SLACK_API_KEY) throw new Error('SLACK_API_KEY is not configured');
    }

    // ── Source the daily routing data ────────────────────────────────────────
    let results: DateResult[];
    let demandSource = 'unknown';
    let bookedSource = 'unknown';
    let generatedAt: string | null = null;

    let freshRun: { id: string; generated_at: string; coverage_dates: string[]; demand_source: string | null; booked_source: string | null } | null = null;
    if (!recompute) {
      const { data: runs } = await supabase
        .from('daily_coverage_routing_runs')
        .select('id, generated_at, coverage_dates, demand_source, booked_source')
        .eq('dry_run', false)
        .order('generated_at', { ascending: false })
        .limit(1);
      const run = runs?.[0];
      if (run && (Date.now() - new Date(run.generated_at).getTime()) < FRESH_MS &&
          Array.isArray(run.coverage_dates) && run.coverage_dates.includes(today)) {
        freshRun = run;
      }
    }

    if (freshRun) {
      results = await loadRunResults(supabase, freshRun.id, dates);
      demandSource = freshRun.demand_source ?? 'unknown';
      bookedSource = freshRun.booked_source ?? 'unknown';
      generatedAt = freshRun.generated_at;
    } else {
      // Recompute (or no fresh run). Persist unless this is a dry run.
      const inv = await supabase.functions.invoke('compute-daily-coverage-routing', {
        body: { dates, run_label: 'slack', dry_run: isDryRun },
      });
      if (inv.error) throw new Error(`routing recompute failed: ${inv.error.message ?? inv.error}`);
      const data = inv.data as { results: DateResult[]; demand_source: string; booked_source: string };
      results = data.results ?? [];
      demandSource = data.demand_source ?? 'unknown';
      bookedSource = data.booked_source ?? 'unknown';
      generatedAt = new Date().toISOString();
    }

    const todayResult = results.find((r) => r.date === today) ?? { date: today, state_coverage: [], provider_assignments: [], moves: [], adds: [], warnings: [] };
    const tomorrowResult = results.find((r) => r.date !== today) ?? null;
    const rows = todayResult.state_coverage;
    const [accessSnapshot, tomorrowAccessSnapshot, stateAccessToday] = await Promise.all([
      loadAccessSnapshot(supabase, today),
      tomorrowResult ? loadAccessSnapshot(supabase, tomorrowResult.date) : Promise.resolve(null),
      loadStateAccessSnapshot(supabase, today),
    ]);

    const counts = {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      low: rows.filter((r) => r.status === 'low').length,
      critical: rows.filter((r) => r.status === 'critical').length,
      zero: rows.filter((r) => r.status === 'zero').length,
      noData: rows.filter((r) => r.status === 'no_data').length,
    };

    const attention = rows
      .filter((r) => r.status === 'zero' || r.status === 'critical' || r.status === 'low')
      .sort((a, b) => {
        const o = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (o !== 0) return o;
        return (a.coverage_ratio ?? 9) - (b.coverage_ratio ?? 9) || b.gap_hours - a.gap_hours;
      });
    const noData = rows.filter((r) => r.status === 'no_data');

    const headerDate = new Date(today + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const accessText = buildAccessSummaryText(accessSnapshot);
    const stateText = buildStateAccessText(stateAccessToday, rows, attention, noData, accessSnapshot === null);
    const providerText = buildProviderWatchlistText(accessSnapshot);
    const sourceNote = accessSnapshot
      ? `_Unique slot headline: Daily Provider Utilization (card 3295)${accessSnapshot.syncedAt ? ` · synced ${timeAgo(accessSnapshot.syncedAt)}` : ''}. State rows are used for breadth/cushion only, not summed into network totals._`
      : `_Unique provider-slot data for ${today} is not loaded yet. Routing fallback: demand ${demandSource} · booked ${bookedSource}${generatedAt ? ` · computed ${timeAgo(generatedAt)}` : ''}._`;

    const messageBlocks: unknown[] = [
      { type: 'header', text: { type: 'plain_text', text: `📊 Same/Next-Day Access — ${headerDate}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: accessText } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: sourceNote }] },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: stateText } },
    ];
    if (providerText) messageBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: providerText } });
    messageBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${DASHBOARD_URL}|Open Ops Dashboard →> · 🧵 provider detail in thread` }] });

    const fallbackText = accessSnapshot
      ? `Same/Next-Day Access — ${headerDate}: ${fmtSlots(accessSnapshot.bookedSlots)} booked, ${fmtSlots(accessSnapshot.availableSlots)} available, ${fmtSlots(accessSnapshot.totalSlots)} total unique slots`
      : `Same/Next-Day Access — ${headerDate}: unique slot data not loaded yet`;

    if (isDryRun) {
      return new Response(
        JSON.stringify({
          success: true, dry_run: true, date: today, demand_source: demandSource, booked_source: bookedSource,
          counts, attention_count: attention.length, access_snapshot: accessSnapshot, state_access: stateAccessToday,
          blocks: messageBlocks, text: fallbackText,
          thread: buildThreadBlocks(todayResult, tomorrowResult, accessSnapshot, tomorrowAccessSnapshot, stateAccessToday),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const postFn = (payload: Record<string, unknown>) =>
      fetch(`${GATEWAY_URL}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': SLACK_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'Ops Coverage Bot 📊', icon_emoji: ':bar_chart:', unfurl_links: false, ...payload }),
      });

    const response = await postFn({ channel: OPS_CHANNEL_ID, text: fallbackText, blocks: messageBlocks });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Slack API error: ${JSON.stringify(data)}`);

    // ── Threaded detail ──────────────────────────────────────────────────────
    const replyTs: string[] = [];
    try {
      const threadGroups = buildThreadBlocks(todayResult, tomorrowResult, accessSnapshot, tomorrowAccessSnapshot, stateAccessToday);
      for (const group of threadGroups) {
        const reply = await postFn({ channel: OPS_CHANNEL_ID, thread_ts: data.ts, text: group.text, blocks: group.blocks });
        const r = await reply.json();
        if (r.ok) replyTs.push(r.ts);
        else console.warn('Thread reply failed:', r);
      }
    } catch (e) {
      console.warn('Threaded replies failed (main post sent):', e);
    }

    return new Response(
      JSON.stringify({ success: true, date: today, counts, attention_count: attention.length, message_ts: data.ts, reply_ts: replyTs }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error in send-ops-dashboard-slack:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

// ── Access snapshots ─────────────────────────────────────────────────────────
async function loadAccessSnapshot(
  supabase: ReturnType<typeof createClient>,
  date: string,
): Promise<AccessSnapshot | null> {
  const { data, error } = await supabase
    .from('provider_utilization_daily')
    .select('provider_name, util_date, booked_timeslots, total_timeslots, utilization_pct, synced_at, imported_at')
    .eq('util_date', date)
    .range(0, 49999);
  if (error) {
    console.warn('provider_utilization_daily load failed:', error.message);
    return null;
  }

  const providers: AccessProviderRow[] = [];
  const syncedCandidates: string[] = [];
  for (const row of data ?? []) {
    const total = numOrNull(row.total_timeslots);
    if (total === null || total <= 0) continue;
    const utilizationPct = numOrNull(row.utilization_pct);
    let booked = numOrNull(row.booked_timeslots);
    if (booked === null && utilizationPct !== null) booked = Math.round(total * (utilizationPct / 100));
    booked = Math.max(0, Math.min(total, booked ?? 0));
    const available = Math.max(0, total - booked);
    providers.push({
      name: String(row.provider_name ?? 'Unknown'),
      bookedSlots: booked,
      availableSlots: available,
      totalSlots: total,
      utilizationPct: total > 0 ? (booked / total) * 100 : utilizationPct ?? 0,
    });
    const synced = String(row.synced_at ?? row.imported_at ?? '');
    if (synced) syncedCandidates.push(synced);
  }

  const totalSlots = providers.reduce((sum, row) => sum + row.totalSlots, 0);
  if (providers.length === 0 || totalSlots <= 0) return null;
  const bookedSlots = providers.reduce((sum, row) => sum + row.bookedSlots, 0);
  const availableSlots = providers.reduce((sum, row) => sum + row.availableSlots, 0);
  syncedCandidates.sort();
  return {
    date,
    bookedSlots,
    availableSlots,
    totalSlots,
    utilizationPct: (bookedSlots / totalSlots) * 100,
    providerCount: providers.length,
    syncedAt: syncedCandidates.length ? syncedCandidates[syncedCandidates.length - 1] : null,
    providers,
  };
}

async function loadStateAccessSnapshot(
  supabase: ReturnType<typeof createClient>,
  date: string,
): Promise<StateAccessSnapshot | null> {
  const { data: parsedRows, error: parsedError } = await supabase
    .from('state_access_slots_daily')
    .select('access_date, state, booked_slots, available_slots, total_slots, synced_at, source')
    .eq('access_date', date)
    .range(0, 49999);
  if (parsedError) {
    console.warn('state_access_slots_daily load failed:', parsedError.message);
  } else if ((parsedRows ?? []).length > 0) {
    const rows = (parsedRows ?? [])
      .map((row): StateAccessRow | null => {
        const state = toAbbreviation(String(row.state ?? ''));
        if (!state) return null;
        const booked = numOrNull(row.booked_slots);
        const available = numOrNull(row.available_slots);
        const total = numOrNull(row.total_slots) ?? (booked !== null && available !== null ? booked + available : null);
        return {
          state,
          bookedSlots: booked,
          availableSlots: available,
          totalSlots: total,
          utilizationPct: total && total > 0 && booked !== null ? (booked / total) * 100 : null,
        };
      })
      .filter((row): row is StateAccessRow => row !== null);
    const synced = (parsedRows ?? []).map((row) => String(row.synced_at ?? '')).filter(Boolean).sort();
    return { date, source: 'state_access_slots_daily', syncedAt: synced[synced.length - 1] ?? null, rows };
  }

  const { data: exports, error: exportError } = await supabase
    .from('metabase_raw_exports')
    .select('rows, pulled_at, pulled_date')
    .eq('report_key', 'telemedicine_availability')
    .order('pulled_at', { ascending: false })
    .limit(5);
  if (exportError) {
    console.warn('metabase_raw_exports state access load failed:', exportError.message);
  }
  for (const exp of exports ?? []) {
    const rows = parseStateAccessRows(exp.rows, date);
    if (rows.length > 0) {
      return { date, source: 'rpt_telemedicine_availability_by_state_per_day', syncedAt: String(exp.pulled_at ?? ''), rows };
    }
  }

  const { data, error } = await supabase
    .from('telemedicine_availability')
    .select('state_abbreviation, report_date, available_count, availability_pct, imported_at')
    .eq('report_date', date)
    .range(0, 49999);
  if (error) {
    console.warn('telemedicine_availability load failed:', error.message);
    return null;
  }
  const rows = (data ?? [])
    .map((row): StateAccessRow | null => {
      const state = toAbbreviation(String(row.state_abbreviation ?? ''));
      if (!state) return null;
      return {
        state,
        bookedSlots: null,
        availableSlots: numOrNull(row.available_count),
        totalSlots: null,
        utilizationPct: null,
      };
    })
    .filter((row): row is StateAccessRow => row !== null);
  if (rows.length === 0) return null;
  const synced = (data ?? []).map((row) => String(row.imported_at ?? '')).filter(Boolean).sort();
  return { date, source: 'telemedicine_availability', syncedAt: synced[synced.length - 1] ?? null, rows };
}

function buildAccessSummaryText(snapshot: AccessSnapshot | null): string {
  if (!snapshot) {
    return [
      '*Same/next-day access*',
      'Unique provider-slot data has not loaded yet for this date.',
      'Use the state/provider detail below as a temporary routing fallback, but do not sum state rows as the network total.',
    ].join('\n');
  }

  const availablePct = snapshot.totalSlots > 0 ? (snapshot.availableSlots / snapshot.totalSlots) * 100 : 0;
  const posture = availablePct >= 25
    ? "We're in good shape for same/next-day access."
    : snapshot.availableSlots > 0
    ? 'Access is tighter than usual, but there are still appointment slots open.'
    : 'No open same/next-day appointment slots are showing in the unique-slot view.';
  return [
    `*${posture}*`,
    '*Unique appointment capacity*',
    `${fmtSlots(snapshot.bookedSlots)} booked · ${fmtSlots(snapshot.availableSlots)} still available · ${fmtSlots(snapshot.totalSlots)} total slots`,
    `${fmtPct(snapshot.utilizationPct)} booked · ${fmtPct(availablePct)} available`,
  ].join('\n');
}

function buildStateAccessText(
  snapshot: StateAccessSnapshot | null,
  routingRows: StateRow[],
  attention: StateRow[],
  noData: StateRow[],
  useRoutingFallback: boolean,
): string {
  if (snapshot && snapshot.rows.length > 0) {
    const rows = applyBookedVisitsByState(snapshot.rows, routingRows)
      .filter((row) => row.availableSlots !== null || row.bookedSlots !== null)
      .sort((a, b) =>
        (a.availableSlots ?? Number.MAX_SAFE_INTEGER) - (b.availableSlots ?? Number.MAX_SAFE_INTEGER) ||
        (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1) ||
        a.state.localeCompare(b.state),
      );
    const totalStates = rows.length;
    const openStates = rows.filter((row) => (row.availableSlots ?? 0) > 0).length;
    const zeroStates = rows.filter((row) => row.availableSlots === 0).map((row) => row.state);
    const lowestAvailability = rows
      .filter((row) => row.availableSlots !== null)
      .slice(0, 8)
      .map(formatStateAccessRow);
    const highestUtilization = [...rows]
      .filter((row) => row.bookedSlots !== null && row.availableSlots !== null && (row.totalSlots ?? 0) > 0)
      .sort((a, b) =>
        (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1) ||
        (a.availableSlots ?? Number.MAX_SAFE_INTEGER) - (b.availableSlots ?? Number.MAX_SAFE_INTEGER) ||
        a.state.localeCompare(b.state),
      )
      .slice(0, 5)
      .map(formatStateAccessRow);
    return [
      '*State access by state*',
      `${openStates}/${totalStates} states have availability · ${zeroStates.length} at zero availability`,
      lowestAvailability.length ? `Lowest availability: ${lowestAvailability.join(' · ')}` : 'No low-cushion states in the state availability view.',
      highestUtilization.length ? `Highest utilization: ${highestUtilization.join(' · ')}` : '',
      '_Full by-state table is in the thread. State rows are directional and non-additive._',
      zeroStates.length ? `Zero availability: ${zeroStates.join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }

  if (!useRoutingFallback) {
    return [
      '*State access*',
      'State-level availability data is not loaded in the durable snapshot yet.',
      'Use the unique appointment capacity above for the overall read; state rows should stay watchlist-only.',
    ].join('\n');
  }

  const trackedStates = routingRows.filter((row) => row.status !== 'no_data').length;
  const watchStates = attention.slice(0, 10).map((row) => row.state);
  return [
    '*State access*',
    `${trackedStates}/${routingRows.length} active states have routing data${noData.length ? ` · ${noData.length} missing demand data` : ''}.`,
    watchStates.length ? `Routing watchlist: ${watchStates.join(', ')}` : 'No routing watchlist states today.',
  ].join('\n');
}

function buildProviderWatchlistText(snapshot: AccessSnapshot | null): string | null {
  if (!snapshot) return null;
  const providers = [...snapshot.providers].sort((a, b) =>
    a.availableSlots - b.availableSlots ||
    b.utilizationPct - a.utilizationPct ||
    b.totalSlots - a.totalSlots ||
    a.name.localeCompare(b.name),
  );
  const full = providers.filter((row) => row.availableSlots === 0).slice(0, 8);
  const nearlyFull = providers
    .filter((row) => row.availableSlots > 0 && row.utilizationPct >= 80)
    .slice(0, 6);

  const lines = ['*Provider utilization watchlist*'];
  lines.push(full.length
    ? `Fully booked today: ${full.map((row) => row.name).join(', ')}`
    : 'No providers are fully booked in the unique-slot view.');
  if (nearlyFull.length > 0) {
    lines.push(`Nearly full: ${nearlyFull.map((row) => `${row.name} ${fmtPct(row.utilizationPct)}`).join(' · ')}`);
  }
  return lines.join('\n');
}

function formatStateAccessRow(row: StateAccessRow): string {
  const booked = row.bookedSlots !== null ? fmtSlots(row.bookedSlots) : '—';
  const available = row.availableSlots !== null ? fmtSlots(row.availableSlots) : '—';
  const parts = [`${row.state}: ${booked} booked / ${available} avail`];
  if (row.utilizationPct !== null) parts.push(`${fmtPct(row.utilizationPct)} used`);
  return parts.join(' / ');
}

function applyBookedVisitsByState(stateRows: StateAccessRow[], routingRows: StateRow[]): StateAccessRow[] {
  const bookedByState = new Map<string, number>();
  for (const row of routingRows) {
    if (row.booked_locked_hours > 0) bookedByState.set(row.state, Math.round(row.booked_locked_hours * 2));
  }
  return stateRows.map((row) => {
    const booked = bookedByState.has(row.state) ? bookedByState.get(row.state)! : row.bookedSlots;
    const total = booked !== null && row.availableSlots !== null ? booked + row.availableSlots : row.totalSlots;
    return {
      ...row,
      bookedSlots: booked,
      totalSlots: total,
      utilizationPct: total && total > 0 && booked !== null ? (booked / total) * 100 : row.utilizationPct,
    };
  });
}

function parseStateAccessRows(rawRows: unknown, date: string): StateAccessRow[] {
  if (!Array.isArray(rawRows)) return [];
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
  const rows: StateAccessRow[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const rowDate = parseDateValue(colValue(row, 'Date', 'date', 'Day', 'day', 'report_date', 'date_actual', 'date_actual: Day'));
    if (rowDate && rowDate !== date) continue;
    const state = toAbbreviation(colValue(row, 'state', 'State', 'Appointment State', 'appointment_state', 'service_state'));
    if (!state) continue;
    const booked = numOrNull(colValue(
      row,
      `${weekday} Booked`, 'Booked', 'booked', 'booked_slots', 'Booked Slots', 'appointments', 'Appointments',
      'appointment_count', 'Appointment Count',
    ));
    const available = numOrNull(colValue(
      row,
      `${weekday} Remaining`, 'Remaining', 'remaining', 'available', 'Available', 'available_slots',
      'Available Slots', 'same_next_day_available_slots', 'Sum of same_next_day_available_slots',
    ));
    const total = booked !== null && available !== null ? booked + available : numOrNull(colValue(row, 'Total', 'total', 'total_slots', 'Total Slots'));
    const utilization = total && total > 0 && booked !== null
      ? (booked / total) * 100
      : pctOrNull(colValue(row, 'Utilization', 'utilization', 'utilization_pct', 'Booking Rate', 'booking_rate'));
    if (booked === null && available === null && total === null && utilization === null) continue;
    rows.push({ state, bookedSlots: booked, availableSlots: available, totalSlots: total, utilizationPct: utilization });
  }
  return rows;
}

function colValue(row: Record<string, unknown>, ...candidates: string[]): string {
  const normalize = (s: string) =>
    s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const key = Object.keys(row).find((k) => normalize(k) === target);
    if (key) return String(row[key] ?? '').trim();
  }
  return '';
}

function numOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pctOrNull(raw: unknown): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  return String(raw).includes('%') || n > 1 ? n : n * 100;
}

function parseDateValue(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// ── Thread builders ───────────────────────────────────────────────────────────
function buildThreadBlocks(
  today: DateResult,
  tomorrow: DateResult | null,
  accessSnapshot: AccessSnapshot | null,
  tomorrowAccessSnapshot: AccessSnapshot | null,
  stateAccessSnapshot: StateAccessSnapshot | null,
): { text: string; blocks: unknown[] }[] {
  const groups: { text: string; blocks: unknown[] }[] = [];

  // Reply 1: who's confirmed working today + their routed states.
  const working = today.provider_assignments
    .filter((a) => a.scheduled_hours > 0)
    .sort((a, b) => b.scheduled_hours - a.scheduled_hours || a.name.localeCompare(b.name));
  if (working.length > 0) {
    const lines = ['*🩺 Confirmed providers scheduled today*', ''];
    for (const a of working.slice(0, 30)) {
      const parts: string[] = [`${fmtH(a.scheduled_hours)} scheduled`];
      if (a.booked_locked_hours > 0) parts.push(`${fmtH(a.booked_locked_hours)} booked`);
      if (a.assignments.length > 0) parts.push(`→ ${a.assignments.map((x) => `${x.state} ${fmtH(x.hours)}`).join(', ')}`);
      if (a.unassigned_free_hours > 0) parts.push(`${fmtH(a.unassigned_free_hours)} free`);
      lines.push(`• *${a.name}* — ${parts.join(' · ')}`);
    }
    if (working.length > 30) lines.push(`_…and ${working.length - 30} more._`);
    groups.push({ text: 'Confirmed providers scheduled today', blocks: [section(lines.join('\n'))] });
  }

  const providerWatchlist = buildProviderWatchlistText(accessSnapshot);
  if (providerWatchlist) {
    groups.push({ text: 'Provider utilization watchlist', blocks: [section(providerWatchlist)] });
  }

  const stateTable = buildStateAccessThreadText(stateAccessSnapshot, today.state_coverage);
  if (stateTable) {
    groups.push({ text: 'State access by state', blocks: [section(stateTable)] });
  }

  // Reply 2: gaps + recommended moves + tentative upside.
  const gapStates = today.state_coverage
    .filter((r) => (r.status === 'zero' || r.status === 'critical' || r.status === 'low') && r.demand_hours !== null)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.gap_hours - a.gap_hours);
  if (!accessSnapshot && gapStates.length > 0) {
    const movesByState = new Map<string, MoveRow[]>();
    for (const m of today.moves) {
      if (!movesByState.has(m.state)) movesByState.set(m.state, []);
      movesByState.get(m.state)!.push(m);
    }
    const lines = ['*🛠 Remaining gaps, routed moves & tentative upside*', ''];
    for (const r of gapStates.slice(0, 15)) {
      lines.push(`${statusEmoji(r.status)} *${r.state}* — gap ${fmtH(r.gap_hours)} (confirmed ${fmtH(r.confirmed_coverage_hours)} of ${fmtH(r.demand_hours as number)})`);
      const mv = movesByState.get(r.state) ?? [];
      if (mv.length > 0) {
        lines.push(`   ✅ Routed: ${mv.slice(0, 4).map((m) => `${m.name} ${fmtH(m.hours)}`).join(', ')}`);
      }
      if (r.tentative_upside_hours > 0) {
        lines.push(`   🟡 Tentative upside if activated: +${fmtH(r.tentative_upside_hours)}`);
      }
    }
    if (gapStates.length > 15) lines.push(`_…and ${gapStates.length - 15} more._`);
    groups.push({ text: 'Remaining gaps and moves', blocks: [section(lines.join('\n'))] });
  }

  // Reply 3: recommended adds / outreach for residual gaps.
  if (!accessSnapshot && today.adds.length > 0) {
    const addsByState = new Map<string, AddRow[]>();
    for (const a of today.adds) {
      if (!addsByState.has(a.state)) addsByState.set(a.state, []);
      addsByState.get(a.state)!.push(a);
    }
    const lines = ['*📞 Recommended add-hours / outreach*', ''];
    for (const [state, adds] of [...addsByState.entries()].sort()) {
      lines.push(`*${state}*`);
      for (const a of adds.slice(0, 4)) {
        const ctx: string[] = [];
        if (a.source === 'tentative_scheduled') ctx.push('scheduled but not EHR-live here');
        else if (a.source === 'jotform_availability') ctx.push('available per Jotform');
        else if (a.source === 'low_utilization') ctx.push('low utilization');
        if (a.available_hours != null) ctx.push(`${fmtH(a.available_hours)} avail`);
        if (a.utilization_pct != null) ctx.push(`${Math.round(a.utilization_pct)}% util`);
        if (a.tentative) ctx.push('needs activation');
        lines.push(`   → ${a.name}${ctx.length ? ` (${ctx.join(', ')})` : ''}`);
      }
    }
    lines.push('', '_Suggestions only — review and contact via your usual channel._');
    groups.push({ text: 'Recommended outreach', blocks: [section(lines.join('\n'))] });
  }

  // Optional: tomorrow preview.
  if (tomorrow) {
    const lines = [`*🔮 Tomorrow (${tomorrow.date}) preview*`];
    if (tomorrowAccessSnapshot) {
      const availablePct = tomorrowAccessSnapshot.totalSlots > 0
        ? (tomorrowAccessSnapshot.availableSlots / tomorrowAccessSnapshot.totalSlots) * 100
        : 0;
      lines.push(`${fmtSlots(tomorrowAccessSnapshot.bookedSlots)} booked · ${fmtSlots(tomorrowAccessSnapshot.availableSlots)} available · ${fmtSlots(tomorrowAccessSnapshot.totalSlots)} total unique slots`);
      lines.push(`${fmtPct(tomorrowAccessSnapshot.utilizationPct)} booked · ${fmtPct(availablePct)} available`);
    } else {
      const t = tomorrow.state_coverage;
      const att = t.filter((r) => r.status === 'zero' || r.status === 'critical' || r.status === 'low')
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.state.localeCompare(b.state));
      lines.push(`${t.length} active states in routing preview.`);
      if (att.length > 0) lines.push(`Watchlist: ${att.slice(0, 10).map((r) => r.state).join(', ')}`);
    }
    groups.push({ text: 'Tomorrow preview', blocks: [section(lines.join('\n'))] });
  }

  // Data-quality footnote.
  if (today.warnings.length > 0) {
    const byType = new Map<string, number>();
    for (const w of today.warnings) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
    const summary = [...byType.entries()].map(([t, n]) => `${n}× ${t.replace(/_/g, ' ')}`).join(', ');
    groups.push({ text: 'Data quality', blocks: [section(`*⚠️ Data-quality notes*\n${summary}\n_See routing run detail for specifics._`)] });
  }

  return groups;
}

function buildStateAccessThreadText(snapshot: StateAccessSnapshot | null, routingRows: StateRow[]): string | null {
  if (!snapshot || snapshot.rows.length === 0) return null;
  const rows = applyBookedVisitsByState(snapshot.rows, routingRows)
    .filter((row) => row.availableSlots !== null || row.bookedSlots !== null)
    .sort((a, b) =>
      (a.availableSlots ?? Number.MAX_SAFE_INTEGER) - (b.availableSlots ?? Number.MAX_SAFE_INTEGER) ||
      (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1) ||
      a.state.localeCompare(b.state),
    );
  if (rows.length === 0) return null;
  const lines = [
    '*State access by state*',
    '_Booked = unique booked visits from the booked-appointments/routing feed. Available = state-level open slots; do not sum available slots across states._',
    '',
    ...rows.map(formatStateAccessRow),
  ];
  return lines.join('\n');
}

function section(text: string) {
  return { type: 'section', text: { type: 'mrkdwn', text: text.length > 2900 ? text.slice(0, 2897) + '…' : text } };
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

// ── Read a persisted run back into the DateResult shape ─────────────────────────
async function loadRunResults(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  dates: string[],
): Promise<DateResult[]> {
  const [stateRes, assignRes, recRes, dqRes] = await Promise.all([
    supabase.from('daily_coverage_state_rows').select('*').eq('run_id', runId).in('coverage_date', dates),
    supabase.from('daily_coverage_provider_assignments').select('*').eq('run_id', runId).in('coverage_date', dates),
    supabase.from('daily_coverage_recommendations').select('*').eq('run_id', runId).in('coverage_date', dates),
    supabase.from('daily_coverage_data_quality').select('coverage_date, warning_type, detail').eq('run_id', runId).in('coverage_date', dates),
  ]);

  const byDate = new Map<string, DateResult>();
  const ensure = (d: string) => {
    if (!byDate.has(d)) byDate.set(d, { date: d, state_coverage: [], provider_assignments: [], moves: [], adds: [], warnings: [] });
    return byDate.get(d)!;
  };
  for (const d of dates) ensure(d);

  for (const r of stateRes.data ?? []) {
    ensure(String(r.coverage_date)).state_coverage.push({
      state: r.state, demand_hours: r.demand_hours, demand_source: r.demand_source,
      booked_locked_hours: Number(r.booked_locked_hours), confirmed_assigned_hours: Number(r.confirmed_assigned_hours),
      confirmed_coverage_hours: Number(r.confirmed_coverage_hours), tentative_upside_hours: Number(r.tentative_upside_hours),
      coverage_ratio: r.coverage_ratio === null ? null : Number(r.coverage_ratio), gap_hours: Number(r.gap_hours), status: r.status as Status,
    });
  }
  for (const a of assignRes.data ?? []) {
    ensure(String(a.coverage_date)).provider_assignments.push({
      name: a.provider_name, profession: a.profession, scheduled_hours: Number(a.scheduled_hours),
      booked_locked_hours: Number(a.booked_locked_hours), assignments: Array.isArray(a.assignments) ? a.assignments : [],
      unassigned_free_hours: Number(a.unassigned_free_hours),
    });
  }
  for (const rec of recRes.data ?? []) {
    const dr = ensure(String(rec.coverage_date));
    if (rec.kind === 'move') dr.moves.push({ name: rec.provider_name, state: rec.state, hours: Number(rec.hours ?? 0) });
    else dr.adds.push({ state: rec.state, name: rec.provider_name, profession: rec.profession ?? null, source: rec.source ?? '', available_hours: rec.hours === null ? null : Number(rec.hours), tentative: !!rec.tentative, utilization_pct: rec.utilization_pct === null ? null : Number(rec.utilization_pct) });
  }
  for (const w of dqRes.data ?? []) {
    ensure(String(w.coverage_date)).warnings.push({ type: w.warning_type, detail: w.detail });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
