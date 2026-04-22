import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const OPS_CHANNEL_ID = 'C08A03ET7C3'; // #appointment-availability-update

// Mirrors src/lib/slaFormulas.ts (kept inline to avoid cross-runtime imports)
const SLOTS_PER_HOUR = 4; // 15-min slots
const DEFAULT_SLA_BUFFER = 1.2;

function slotsToHours(slots: number) {
  return slots / SLOTS_PER_HOUR;
}
function slaTargetSlots(weeklyVisits: number, buffer: number) {
  // Weekly visits → daily target slots, with buffer
  return (weeklyVisits / 7) * buffer * SLOTS_PER_HOUR;
}
function coverageRatio(available: number, target: number) {
  if (!target || target <= 0) return null;
  return available / target;
}

type WeekStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

function computeWeekStatus(
  available: number | null,
  hasSlotData: boolean,
  target: number | null,
): WeekStatus {
  if (!hasSlotData || target === null) return 'no_data';
  if (available === null) return 'no_data';
  if (available <= 0) return 'zero';
  const ratio = available / target;
  if (ratio < 0.5) return 'critical';
  if (ratio < 1) return 'low';
  return 'ok';
}

function getChicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function statusEmoji(s: WeekStatus): string {
  switch (s) {
    case 'ok': return '🟢';
    case 'low': return '🟡';
    case 'critical': return '🟠';
    case 'zero': return '🔴';
    case 'no_data': return '⚪';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    if (!SLACK_API_KEY) throw new Error('SLACK_API_KEY is not configured');

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const isDryRun = body?.dry_run === true;
    const overrideDate = typeof body?.date === 'string' ? body.date as string : null;

    const today = overrideDate ?? getChicagoDate();
    const weekStart = getMonday(today);

    // Pull SLA buffer from system_config (fall back to default)
    let buffer = DEFAULT_SLA_BUFFER;
    const { data: cfg } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'sla_buffer_multiplier')
      .maybeSingle();
    if (cfg?.value) {
      const parsed = parseFloat(String(cfg.value));
      if (!Number.isNaN(parsed) && parsed > 0) buffer = parsed;
    }

    const [activationsRes, slotsRes, slaRes, forecastRes] = await Promise.all([
      supabase.from('state_activation').select('state_abbreviation, is_active'),
      supabase
        .from('state_leftover_slots')
        .select('state_abbreviation, unfilled_slots, window_type')
        .eq('slot_date', today)
        .in('window_type', ['historical', 'forecast']),
      supabase
        .from('state_sla_attainment')
        .select('state_abbreviation, sla_pct, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('demand_forecast')
        .select('state_abbreviation, projected_visits')
        .eq('week_start', weekStart),
    ]);

    const activations = activationsRes.data ?? [];

    const slotsByState = new Map<string, { slots: number; source: 'historical' | 'forecast' }>();
    for (const r of slotsRes.data ?? []) {
      const existing = slotsByState.get(r.state_abbreviation);
      if (!existing || existing.source === 'forecast') {
        slotsByState.set(r.state_abbreviation, {
          slots: r.unfilled_slots,
          source: r.window_type as 'historical' | 'forecast',
        });
      }
    }

    const slaByState = new Map<string, number>();
    for (const r of slaRes.data ?? []) {
      if (!slaByState.has(r.state_abbreviation)) {
        slaByState.set(r.state_abbreviation, Number(r.sla_pct));
      }
    }

    const forecastByState = new Map<string, number>(
      (forecastRes.data ?? []).map((r) => [r.state_abbreviation, r.projected_visits])
    );

    const rows = activations
      .filter((a) => a.is_active)
      .map((a) => {
        const state = a.state_abbreviation;
        const entry = slotsByState.get(state) ?? null;
        const hasSlotData = entry !== null;
        const available = entry?.slots ?? null;
        const visits = forecastByState.get(state) ?? null;
        const target = visits !== null ? slaTargetSlots(visits, buffer) : null;
        const ratio = target !== null && available !== null ? coverageRatio(available, target) : null;
        return {
          state,
          available,
          availableHours: available !== null ? slotsToHours(available) : null,
          target,
          targetHours: target !== null ? slotsToHours(target) : null,
          ratio,
          slaPct: slaByState.get(state) ?? null,
          weekStatus: computeWeekStatus(available, hasSlotData, target),
          source: entry?.source ?? null,
        };
      });

    const counts = {
      total: rows.length,
      ok: rows.filter((r) => r.weekStatus === 'ok').length,
      low: rows.filter((r) => r.weekStatus === 'low').length,
      critical: rows.filter((r) => r.weekStatus === 'critical').length,
      zero: rows.filter((r) => r.weekStatus === 'zero').length,
      noData: rows.filter((r) => r.weekStatus === 'no_data').length,
    };

    // States needing attention: zero + critical + low, sorted worst-first
    const order: Record<WeekStatus, number> = { zero: 0, critical: 1, low: 2, ok: 3, no_data: 4 };
    const attention = rows
      .filter((r) => r.weekStatus === 'zero' || r.weekStatus === 'critical' || r.weekStatus === 'low')
      .sort((a, b) => {
        const o = order[a.weekStatus] - order[b.weekStatus];
        if (o !== 0) return o;
        const ar = a.ratio ?? 999;
        const br = b.ratio ?? 999;
        return ar - br;
      });

    const noData = rows.filter((r) => r.weekStatus === 'no_data');

    // Format date for header
    const headerDate = new Date(today + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const summaryLine =
      `🟢 ${counts.ok} OK · 🟡 ${counts.low} LOW · 🟠 ${counts.critical} CRITICAL · 🔴 ${counts.zero} ZERO` +
      (counts.noData > 0 ? ` · ⚪ ${counts.noData} NO DATA` : '');

    const attentionLines = attention.length === 0
      ? ['_All active states have adequate coverage today._ ✨']
      : attention.slice(0, 20).map((r) => {
          const ratioPct = r.ratio !== null ? `${Math.round(r.ratio * 100)}%` : '—';
          const slotsStr = r.available !== null
            ? `${r.available} slot${r.available === 1 ? '' : 's'} (${(r.availableHours ?? 0).toFixed(1)}h)`
            : 'no slot data';
          const targetStr = r.target !== null ? `target ${Math.round(r.target)}` : 'no target';
          const slaStr = r.slaPct !== null ? ` · SLA ${r.slaPct.toFixed(1)}%` : '';
          return `${statusEmoji(r.weekStatus)} *${r.state}* — ${slotsStr} vs ${targetStr} (${ratioPct})${slaStr}`;
        });

    const attentionOverflow = attention.length > 20
      ? `\n_…and ${attention.length - 20} more states needing attention._`
      : '';

    const noDataLine = noData.length > 0
      ? `\n\n⚪ *No data:* ${noData.map((r) => r.state).join(', ')}`
      : '';

    const projectId = Deno.env.get('SUPABASE_URL')?.match(/https:\/\/([^.]+)\./)?.[1] ?? '';
    const dashboardUrl = 'https://vitableclinops.lovable.app/admin/ops';

    // Fetch recommendations from the engine
    let recs: any = null;
    try {
      const recsRes = await supabase.functions.invoke('compute-coverage-recommendations', {
        body: { date: today, candidates_per_state: 3 },
      });
      if (!recsRes.error) recs = recsRes.data;
    } catch (e) {
      console.warn('Recs engine call failed, continuing without recommendations:', e);
    }

    // Build "Recommended actions" Slack blocks
    const recommendationBlocks: any[] = [];
    if (recs?.state_recommendations?.length) {
      const order: Record<string, number> = { zero: 0, critical: 1, low: 2 };
      const actionable = (recs.state_recommendations as any[])
        .filter(s => ['zero', 'critical', 'low'].includes(s.status))
        .filter(s => s.outreach_candidates.length > 0 || s.apply_recommendation)
        .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
        .slice(0, 6);

      if (actionable.length > 0) {
        const lines: string[] = [];
        for (const s of actionable) {
          const emoji = s.status === 'zero' ? '🔴' : s.status === 'critical' ? '🟠' : '🟡';
          const gapStr = `~${s.gap_hours.toFixed(1)}h (${s.available_slots ?? 0} slots vs target ${s.target_slots ?? '—'})`;
          lines.push(`${emoji} *${s.state}* — needs ${gapStr}`);
          const sendable = s.outreach_candidates.filter((c: any) => !c.on_cooldown).slice(0, 3);
          if (sendable.length > 0) {
            const ping = sendable.map((c: any) => {
              const ctx = c.current_state_status === 'SURPLUS'
                ? `${c.surplus_hours.toFixed(1)}h surplus in ${c.current_state}`
                : c.current_state_status === 'BALANCED'
                ? `BALANCED in ${c.current_state}`
                : 'low utilization';
              return `${c.name} (${ctx})`;
            }).join(', ');
            lines.push(`   → Ping: ${ping}`);
          }
        }
        recommendationBlocks.push({ type: 'divider' });
        recommendationBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*🎯 Suggested providers to ping today*\n${lines.join('\n')}\n\n_Suggestions only — review and contact via your usual channel (Slack DM, text, etc.)._` },
        });
      }
    }

    const messageBlocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📊 Daily Ops Coverage — ${headerDate}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${counts.total} active states*\n${summaryLine}` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*States needing attention*\n${attentionLines.join('\n')}${attentionOverflow}${noDataLine}`,
        },
      },
      ...recommendationBlocks,
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `<${dashboardUrl}|Open Ops Dashboard →>` },
        ],
      },
    ];

    const fallbackText = `Daily Ops Coverage — ${headerDate}: ${summaryLine}`;

    if (isDryRun) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true, counts, attention_count: attention.length, blocks: messageBlocks, text: fallbackText }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': SLACK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: OPS_CHANNEL_ID,
        text: fallbackText,
        blocks: messageBlocks,
        username: 'Ops Coverage Bot 📊',
        icon_emoji: ':bar_chart:',
        unfurl_links: false,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`Slack API error: ${JSON.stringify(data)}`);
    }

    // ---- Threaded reply #1: Suggested reallocation moves ----
    // ---- Threaded reply #2: Residual gaps → providers to contact ----
    let reply1Ts: string | null = null;
    let reply2Ts: string | null = null;
    try {
      if (recs?.state_recommendations?.length) {
        const needyStates = (recs.state_recommendations as any[])
          .filter(s => ['zero', 'critical', 'low'].includes(s.status))
          .sort((a, b) => {
            const o: Record<string, number> = { zero: 0, critical: 1, low: 2 };
            return (o[a.status] ?? 9) - (o[b.status] ?? 9);
          });

        const statesWithActivations = needyStates.filter(s => (s.activation_recommendations?.length ?? 0) > 0);
        const deactivations = (recs.deactivation_recommendations ?? []) as any[];

        if (statesWithActivations.length > 0 || deactivations.length > 0) {
          const lines: string[] = ['*🛠 Suggested reallocation moves*', ''];

          for (const s of statesWithActivations) {
            const emoji = s.status === 'zero' ? '🔴' : s.status === 'critical' ? '🟠' : '🟡';
            lines.push(`${emoji} *${s.state}* — gap ${s.gap_hours.toFixed(1)}h`);
            for (const a of s.activation_recommendations) {
              lines.push(`   ✅ Activate: ${a.name} (license active, ready, +${a.capacity_gain_hours.toFixed(1)}h capacity once live)`);
            }
            const projected = s.projected_gain_hours ?? 0;
            const residual = s.residual_gap_hours ?? 0;
            if (residual <= 2) {
              lines.push(`   = projected +${projected.toFixed(1)}h → ✅ gap resolved`);
            } else {
              lines.push(`   = projected +${projected.toFixed(1)}h → still ${residual.toFixed(1)}h short`);
            }
            lines.push('');
          }

          if (deactivations.length > 0) {
            lines.push('*Surplus states — candidates to pull from*');
            for (const d of deactivations.slice(0, 6)) {
              lines.push(`🟢 *${d.state}* — ➖ ${d.name} (${d.allocated_hours.toFixed(1)}h allocated, ${d.estimated_demand_hours.toFixed(1)}h demand, frees ${d.slack_hours.toFixed(1)}h to redistribute)`);
            }
            lines.push('');
          }

          // Net effect summary
          const totalGap = needyStates.reduce((acc, s) => acc + (s.gap_hours ?? 0), 0);
          const totalGain = needyStates.reduce((acc, s) => acc + (s.projected_gain_hours ?? 0), 0);
          const resolved = needyStates.filter(s => (s.residual_gap_hours ?? 0) <= 2).length;
          const unresolved = needyStates.filter(s => (s.residual_gap_hours ?? 0) > 2);
          lines.push('*📊 Net effect across needy states*');
          lines.push(`   Total gap before: ${totalGap.toFixed(1)}h`);
          lines.push(`   Total recoverable via activations: ${totalGain.toFixed(1)}h`);
          if (unresolved.length === 0) {
            lines.push(`   Result: ✅ ${resolved} of ${needyStates.length} states resolved`);
          } else {
            const shortStr = unresolved.map(s => `${s.state} -${(s.residual_gap_hours).toFixed(1)}h`).join(', ');
            lines.push(`   Result: ✅ ${resolved} of ${needyStates.length} resolved · ⚠️ ${unresolved.length} still short (${shortStr})`);
          }

          const reply1 = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': SLACK_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              channel: OPS_CHANNEL_ID,
              thread_ts: data.ts,
              text: 'Suggested reallocation moves',
              blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }],
              username: 'Ops Coverage Bot 📊',
              icon_emoji: ':bar_chart:',
              unfurl_links: false,
            }),
          });
          const r1 = await reply1.json();
          if (r1.ok) reply1Ts = r1.ts;
          else console.warn('Reply #1 failed:', r1);

          // ---- Reply #2: residual gaps → per-state blocks with DM button ----
          const stillShort = needyStates.filter(s => (s.residual_gap_hours ?? s.gap_hours) > 2);
          if (stillShort.length > 0) {
            const r2blocks: any[] = [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*📞 Gaps still open after reallocation — providers to contact directly*',
                },
              },
            ];
            let hasAny = false;
            for (const s of stillShort) {
              const sendable = (s.outreach_candidates ?? []).filter((c: any) => !c.on_cooldown).slice(0, 3);
              if (sendable.length === 0) continue;
              hasAny = true;
              const emoji = s.status === 'zero' ? '🔴' : s.status === 'critical' ? '🟠' : '🟡';
              const residual = s.residual_gap_hours ?? s.gap_hours;
              const headerLine = `${emoji} *${s.state}* (still -${residual.toFixed(1)}h)`;
              const candidateLines: string[] = [];
              const candidatePayload: any[] = [];
              for (const c of sendable) {
                const ctxParts: string[] = [];
                if (c.working_today && c.shift_window) ctxParts.push(`working today ${c.shift_window}`);
                else if (c.working_today) ctxParts.push('working today');
                if (c.current_state_status === 'SURPLUS') {
                  ctxParts.push(`${c.surplus_hours.toFixed(1)}h surplus in ${c.current_state}`);
                } else if (c.current_state_status === 'BALANCED') {
                  ctxParts.push(`BALANCED in ${c.current_state}`);
                }
                if (typeof c.appointments_today === 'number') ctxParts.push(`${c.appointments_today} appts today`);
                const ctx = ctxParts.length ? ` (${ctxParts.join(', ')})` : '';
                candidateLines.push(`   → ${c.name}${ctx}`);
                candidatePayload.push({
                  profile_id: c.profile_id ?? null,
                  name: c.name,
                  context: ctx ? ctx.replace(/^\s\(|\)$/g, '') : '',
                });
              }
              r2blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `${headerLine}\n${candidateLines.join('\n')}` },
              });
              // Compact JSON payload — Slack action_id has 255 char limit, value has 2000
              const buttonValue = JSON.stringify({
                state: s.state,
                gap_hours: Number(residual.toFixed(1)),
                source_ts: data.ts,
                candidates: candidatePayload,
              });
              if (buttonValue.length < 1900) {
                r2blocks.push({
                  type: 'actions',
                  block_id: `coverage_dm_${s.state}`,
                  elements: [
                    {
                      type: 'button',
                      action_id: 'open_coverage_dm_modal',
                      text: { type: 'plain_text', text: `📨 DM ${sendable.length} provider${sendable.length === 1 ? '' : 's'}`, emoji: true },
                      style: 'primary',
                      value: buttonValue,
                    },
                  ],
                });
              }
            }

            if (hasAny) {
              const reply2 = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                  'X-Connection-Api-Key': SLACK_API_KEY,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  channel: OPS_CHANNEL_ID,
                  thread_ts: data.ts,
                  text: 'Providers to contact directly',
                  blocks: r2blocks,
                  username: 'Ops Coverage Bot 📊',
                  icon_emoji: ':bar_chart:',
                  unfurl_links: false,
                }),
              });
              const r2 = await reply2.json();
              if (r2.ok) reply2Ts = r2.ts;
              else console.warn('Reply #2 failed:', r2);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Threaded replies failed (main post still sent):', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        counts,
        attention_count: attention.length,
        message_ts: data.ts,
        reply1_ts: reply1Ts,
        reply2_ts: reply2Ts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-ops-dashboard-slack:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});