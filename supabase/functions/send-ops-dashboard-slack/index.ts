import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const rows = todayResult.state_coverage;

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
    const summaryLine =
      `🟢 ${counts.ok} OK · 🟡 ${counts.low} LOW · 🟠 ${counts.critical} CRITICAL · 🔴 ${counts.zero} ZERO` +
      (counts.noData > 0 ? ` · ⚪ ${counts.noData} NO DATA` : '');

    const attentionLines = attention.length === 0
      ? ['_All active states have confirmed same-day coverage today._ ✨']
      : attention.slice(0, 20).map((r) => {
          const ratioPct = r.coverage_ratio !== null ? `${Math.round(r.coverage_ratio * 100)}%` : '—';
          const demandStr = r.demand_hours !== null ? fmtH(r.demand_hours) : 'no demand';
          const tentative = r.tentative_upside_hours > 0 ? ` · +${fmtH(r.tentative_upside_hours)} tentative` : '';
          return `${statusEmoji(r.status)} *${r.state}* — confirmed ${fmtH(r.confirmed_coverage_hours)} of ${demandStr} (${ratioPct}) · gap ${fmtH(r.gap_hours)}${tentative}`;
        });
    const attentionOverflow = attention.length > 20 ? `\n_…and ${attention.length - 20} more states needing attention._` : '';
    const noDataLine = noData.length > 0 ? `\n\n⚪ *No demand data:* ${noData.map((r) => r.state).join(', ')}` : '';

    const sourceNote = `_Confirmed coverage drives status. Demand: ${demandSource} · booked: ${bookedSource}${generatedAt ? ` · computed ${timeAgo(generatedAt)}` : ''}._`;

    const messageBlocks: unknown[] = [
      { type: 'header', text: { type: 'plain_text', text: `📊 Same/Next-Day Coverage — ${headerDate}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${counts.total} active states*\n${summaryLine}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: sourceNote }] },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*States needing attention*\n${attentionLines.join('\n')}${attentionOverflow}${noDataLine}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `<${DASHBOARD_URL}|Open Ops Dashboard →> · 🧵 assignments, moves & outreach in thread` }] },
    ];

    const fallbackText = `Same/Next-Day Coverage — ${headerDate}: ${summaryLine}`;

    if (isDryRun) {
      return new Response(
        JSON.stringify({
          success: true, dry_run: true, date: today, demand_source: demandSource, booked_source: bookedSource,
          counts, attention_count: attention.length, blocks: messageBlocks, text: fallbackText,
          thread: buildThreadBlocks(todayResult, results.find((r) => r.date !== today) ?? null),
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
      const tomorrowResult = results.find((r) => r.date !== today) ?? null;
      const threadGroups = buildThreadBlocks(todayResult, tomorrowResult);
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

// ── Thread builders ───────────────────────────────────────────────────────────
function buildThreadBlocks(today: DateResult, tomorrow: DateResult | null): { text: string; blocks: unknown[] }[] {
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

  // Reply 2: gaps + recommended moves + tentative upside.
  const gapStates = today.state_coverage
    .filter((r) => (r.status === 'zero' || r.status === 'critical' || r.status === 'low') && r.demand_hours !== null)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.gap_hours - a.gap_hours);
  if (gapStates.length > 0) {
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
  if (today.adds.length > 0) {
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
    const t = tomorrow.state_coverage;
    const att = t.filter((r) => r.status === 'zero' || r.status === 'critical' || r.status === 'low')
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.gap_hours - a.gap_hours);
    const tCounts = {
      ok: t.filter((r) => r.status === 'ok').length, low: t.filter((r) => r.status === 'low').length,
      critical: t.filter((r) => r.status === 'critical').length, zero: t.filter((r) => r.status === 'zero').length,
    };
    const lines = [`*🔮 Tomorrow (${tomorrow.date}) preview*`, `🟢 ${tCounts.ok} OK · 🟡 ${tCounts.low} LOW · 🟠 ${tCounts.critical} CRITICAL · 🔴 ${tCounts.zero} ZERO`];
    if (att.length > 0) {
      lines.push('');
      for (const r of att.slice(0, 10)) lines.push(`${statusEmoji(r.status)} *${r.state}* — gap ${fmtH(r.gap_hours)}`);
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
