/**
 * evaluate-schedule-submissions edge function
 *
 * Reads schedule_submissions and writes back a decision (accepted /
 * partial / declined) plus accepted_hours / declined_hours / decision_notes.
 *
 * Resubmission handling:
 *   When a provider submits multiple times for the same target_month, we
 *   group those submissions together and walk them chronologically. New
 *   submissions overwrite any overlapping date/time slots from earlier
 *   submissions; non-overlapping slots from earlier submissions remain.
 *   The latest submission in the group gets the decision based on the
 *   merged effective hours; earlier submissions get decision_status =
 *   'superseded' so the audit trail stays intact.
 *
 * Decision math (per group of submissions for the same provider + month):
 *   1. Expand every submission's parsed_shifts into concrete slots
 *      (date, startMin, endMin). Recurring entries expand into one slot
 *      per matching weekday in the target month. One-off and in-home
 *      entries become one slot each.
 *   2. Walk slots chronologically (by submitted_at). For each new slot,
 *      trim or remove any existing timeline slot it overlaps. Add the new
 *      slot.
 *   3. effective_hours = sum of (endMin - startMin)/60 for all merged
 *      slots in the timeline.
 *   4. eligible_states = provider's licensed states, filtered by the
 *      MD-only state rule: AL/IN/GA/MS/MO/SC/TN/LA can only be allocated
 *      to providers whose profession is MD or DO.
 *   5. For each eligible state, demand_hours = sum of demand_forecast
 *      values over the target month, minus committed hours from decisions
 *      made in prior runs for OTHER providers in same state+month.
 *      Note: demand_forecast.projected_visits stores hours of provider
 *      availability (not visits); column name is legacy. See
 *      compute-demand-forecast for the canonical methodology.
 *   6. total_gap = sum of demand_hours across eligible states (clipped 0).
 *   7. Decision:
 *        total_gap >= effective_hours       → accepted (all of it)
 *        0 < total_gap < effective_hours    → partial  (accept = total_gap,
 *                                                      decline = remainder)
 *        total_gap <= 0                     → declined
 *
 * Modes:
 *   POST /functions/v1/evaluate-schedule-submissions
 *     → evaluate every (provider, target_month) group with at least one
 *       pending submission
 *   POST /functions/v1/evaluate-schedule-submissions?target_month=YYYY-MM-01
 *     → evaluate every group for that month (re-runs supersedes too)
 *   POST /functions/v1/evaluate-schedule-submissions?provider_id=<uuid>
 *     → evaluate just that provider's pending groups
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// States that can only be served by MDs/DOs per Vitable scope-of-practice rules.
// NPs licensed in these states cannot be allocated demand hours here.
const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);
const MD_PROFESSIONS = new Set(['MD', 'DO']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ParsedShifts = {
  requested_states?: string[];
  recurring_virtual?: unknown;
  one_off_virtual?: unknown;
  in_home_clinic?: unknown;
  [k: string]: unknown;
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: ParsedShifts | null;
  decision_status: string;
  submitted_at: string;
};

type ShiftType = 'virtual_recurring' | 'virtual_oneoff' | 'in_home_clinic';

type Slot = {
  date: string;        // YYYY-MM-DD
  startMin: number;    // 0..1440
  endMin: number;      // > startMin (we pre-split midnight crossings)
  sourceSubmissionId: string;
  shiftType: ShiftType;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const monthFilter = url.searchParams.get('target_month');
  const providerFilter = url.searchParams.get('provider_id');

  const decisionRunId = crypto.randomUUID();
  const counters = {
    groups: 0,
    accepted: 0,
    partial: 0,
    declined: 0,
    superseded: 0,
    skipped_unmatched_provider: 0,
    skipped_no_hours: 0,
    skipped_no_licensed_states: 0,
    errors: 0,
  };
  const decisions: Array<Record<string, unknown>> = [];

  try {
    // ── Find groups (provider, target_month) that need work ─────────────
    let pendingQuery = supabase
      .from('schedule_submissions')
      .select('provider_id, target_month, decision_status');

    if (monthFilter) pendingQuery = pendingQuery.eq('target_month', monthFilter);
    if (providerFilter) pendingQuery = pendingQuery.eq('provider_id', providerFilter);
    if (!monthFilter && !providerFilter) {
      pendingQuery = pendingQuery.eq('decision_status', 'pending');
    }
    pendingQuery = pendingQuery.range(0, 49999);

    const { data: pendingRows, error: pErr } = await pendingQuery;
    if (pErr) throw new Error(`Pending lookup failed: ${pErr.message}`);

    // Skip historical submissions in the default eval — past months can't be
    // re-decided operationally, and demand_forecast doesn't have rows for
    // them. An explicit ?target_month= bypass remains for backfill.
    const currentMonth = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    })();

    const groupKeys = new Set<string>();
    for (const r of pendingRows ?? []) {
      if (!r.provider_id || !r.target_month) continue;
      if (!monthFilter && !providerFilter && r.target_month < currentMonth) continue;
      groupKeys.add(`${r.provider_id}|${r.target_month}`);
    }

    if (groupKeys.size === 0) {
      return json({
        ok: true, decision_run_id: decisionRunId, ...counters,
        message: 'No groups with pending submissions',
      });
    }

    // ── Load every submission in those groups ──────────────────────────
    const providerIds = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[0])
    ));
    const months = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[1])
    ));

    const { data: subsRaw, error: sErr } = await supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, submitted_at')
      .in('provider_id', providerIds)
      .in('target_month', months);
    if (sErr) throw new Error(`Submissions load failed: ${sErr.message}`);

    const submissions = (subsRaw ?? []) as Submission[];
    const submissionsByGroup = new Map<string, Submission[]>();
    for (const s of submissions) {
      if (!s.provider_id) continue;
      const k = `${s.provider_id}|${s.target_month}`;
      if (!groupKeys.has(k)) continue;
      if (!submissionsByGroup.has(k)) submissionsByGroup.set(k, []);
      submissionsByGroup.get(k)!.push(s);
    }

    // ── Preload provider profession (for MD-only state enforcement) ────
    const professionByProvider = new Map<string, string | null>();
    if (providerIds.length > 0) {
      const { data: provs } = await supabase
        .from('providers')
        .select('id, profession')
        .in('id', providerIds);
      for (const p of provs ?? []) {
        professionByProvider.set(p.id, p.profession ?? null);
      }
    }

    // ── Preload provider licenses (filtered by MD-only constraint) ─────
    // For the eight MD-only states, only providers whose profession is MD/DO
    // are eligible — even if an NP holds a valid license. Drop non-eligible
    // (provider, state) pairs at preload time so the allocator never sees them.
    const licensedStatesByProvider = new Map<string, Set<string>>();
    if (providerIds.length > 0) {
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('provider_id, state, status')
        .in('provider_id', providerIds);
      for (const l of licenses ?? []) {
        if (!l.provider_id || !l.state) continue;
        if (l.status && !['active', 'verified', 'pending_renewal'].includes(l.status)) continue;
        const st = String(l.state).trim().toUpperCase();
        const profession = (professionByProvider.get(l.provider_id) ?? '').toUpperCase();
        if (MD_ONLY_STATES.has(st) && !MD_PROFESSIONS.has(profession)) continue;
        if (!licensedStatesByProvider.has(l.provider_id)) {
          licensedStatesByProvider.set(l.provider_id, new Set());
        }
        licensedStatesByProvider.get(l.provider_id)!.add(st);
      }
    }

    // ── Preload baseline demand per (state, month) ──────────────────────
    // Reads from v_monthly_demand which pre-aggregates demand_forecast to one
    // row per (state, month). Querying the raw demand_forecast directly hits
    // PostgREST's silent row truncation at ~1,000 rows (a full month is 1,410
    // rows), which previously dropped PA from the result set entirely.
    const demandByKey = new Map<string, number>(); // `${state}_${month}` → total visits
    if (months.length > 0) {
      const { data: rows, error: dErr } = await supabase
        .from('v_monthly_demand')
        .select('state, month, total_visits')
        .in('month', months);
      if (dErr) throw new Error(`Demand load failed: ${dErr.message}`);
      for (const r of rows ?? []) {
        const st = String(r.state).trim().toUpperCase();
        const month = String(r.month);
        const k = `${st}_${month}`;
        demandByKey.set(k, Number(r.total_visits ?? 0));
      }
    }

    // ── Preload committed hours from OTHER groups (not in scope) ────────
    const groupKeysInScope = groupKeys;
    const committedByKey = new Map<string, number>(); // `${state}_${month}` → committed hours
    if (months.length > 0) {
      const { data: committed } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, parsed_shifts, accepted_hours, decision_status')
        .in('target_month', months)
        .in('decision_status', ['accepted', 'partial'])
        .range(0, 49999);

      // Sum accepted_hours per (state, month) for groups NOT being re-evaluated.
      // Best-effort even-split across the provider's licensed states for that month.
      for (const c of committed ?? []) {
        if (!c.provider_id || !c.target_month) continue;
        const k = `${c.provider_id}|${c.target_month}`;
        if (groupKeysInScope.has(k)) continue;
        const hours = typeof c.accepted_hours === 'number' ? c.accepted_hours : 0;
        if (hours <= 0) continue;
        const states = licensedStatesByProvider.get(c.provider_id);
        if (!states || states.size === 0) continue;
        const perState = hours / states.size;
        for (const st of states) {
          const key = `${st}_${c.target_month}`;
          committedByKey.set(key, (committedByKey.get(key) ?? 0) + perState);
        }
      }
    }

    // ── Sort groups: most-constrained providers first ──────────────────
    // Process providers with the fewest licensed-states-with-demand first so
    // they don't get bumped by multi-state providers who have alternatives.
    // This is the practical heuristic for "maximize utilization across
    // providers" — single-state providers grab their state's gap before
    // flexible providers consume it.
    const groupKeysSorted = Array.from(submissionsByGroup.keys()).sort((a, b) => {
      const [provA, monthA] = a.split('|');
      const [provB, monthB] = b.split('|');
      const licA = licensedStatesByProvider.get(provA) ?? new Set();
      const licB = licensedStatesByProvider.get(provB) ?? new Set();
      const countWithDemand = (states: Set<string>, month: string) =>
        Array.from(states).filter(s => (demandByKey.get(`${s}_${month}`) ?? 0) > 0).length;
      const cA = countWithDemand(licA, monthA);
      const cB = countWithDemand(licB, monthB);
      if (cA !== cB) return cA - cB;        // fewer licensed-with-demand first
      return monthA.localeCompare(monthB);  // stable tiebreaker
    });

    // ── Evaluate each group ─────────────────────────────────────────────
    for (const key of groupKeysSorted) {
      const groupSubs = submissionsByGroup.get(key)!;
      try {
        counters.groups++;
        const [providerId, targetMonth] = key.split('|');

        // Sort chronologically; latest is the one that carries the decision
        groupSubs.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
        const latest = groupSubs[groupSubs.length - 1];
        const olderIds = groupSubs.slice(0, -1).map(s => s.id);

        if (!providerId) {
          counters.skipped_unmatched_provider++;
          decisions.push({ group: key, status: 'skipped', reason: 'unmatched_provider' });
          continue;
        }

        // Build merged slot timeline
        let timeline: Slot[] = [];
        for (const sub of groupSubs) {
          const slots = expandSubmissionSlots(sub.id, sub.parsed_shifts, targetMonth);
          for (const slot of slots) {
            timeline = mergeSlot(timeline, slot);
          }
        }

        const effectiveHours = round2(timeline.reduce(
          (sum, s) => sum + (s.endMin - s.startMin) / 60, 0,
        ));

        if (effectiveHours <= 0) {
          counters.skipped_no_hours++;
          // Mark older as superseded; latest becomes 'declined' with note
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; group has 0 effective hours`);
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: 0,
            notes: 'No effective hours in any submission for this provider+month',
            decision_run_id: decisionRunId,
          });
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_hours', superseded: olderIds.length });
          continue;
        }

        // Eligible states = provider's licensed states (form has no state field)
        const licensed = licensedStatesByProvider.get(providerId) ?? new Set<string>();
        if (licensed.size === 0) {
          counters.skipped_no_licensed_states++;
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; provider has no active licenses`);
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: effectiveHours,
            notes: 'Provider has no active licenses on file',
            decision_run_id: decisionRunId,
          });
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_licenses', superseded: olderIds.length });
          continue;
        }

        // Compute remaining demand-hour gap per state
        const gapByState: Array<{ state: string; gapHours: number; missingDemand: boolean }> = [];
        for (const st of licensed) {
          const dKey = `${st}_${targetMonth}`;
          const visits = demandByKey.get(dKey);
          if (visits === undefined) {
            gapByState.push({ state: st, gapHours: 0, missingDemand: true });
            continue;
          }
          // demand_forecast.projected_visits stores hours of provider
          // availability (column name is legacy/misleading), so the value
          // already IS the demand hour figure — no conversion.
          const demandHours = visits;
          const committed = committedByKey.get(dKey) ?? 0;
          gapByState.push({
            state: st,
            gapHours: Math.max(0, demandHours - committed),
            missingDemand: false,
          });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);
        const totalGap = round2(gapByState.reduce((s, g) => s + g.gapHours, 0));
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);

        // Decide
        let status: 'accepted' | 'partial' | 'declined';
        let accepted: number;
        let declined: number;
        if (totalGap <= 0) {
          status = 'declined';
          accepted = 0;
          declined = effectiveHours;
        } else if (totalGap >= effectiveHours) {
          status = 'accepted';
          accepted = effectiveHours;
          declined = 0;
        } else {
          status = 'partial';
          accepted = totalGap;
          declined = round2(effectiveHours - accepted);
        }

        // Allocate accepted hours greedily across states
        const allocations: Array<{ state: string; hours: number }> = [];
        let remaining = accepted;
        for (const g of gapByState) {
          if (remaining <= 0 || g.gapHours <= 0) break;
          const take = Math.min(g.gapHours, remaining);
          if (take > 0) {
            allocations.push({ state: g.state, hours: round2(take) });
            remaining -= take;
          }
        }

        const noteParts: string[] = [];
        noteParts.push(`group_size=${groupSubs.length}`);
        noteParts.push(`effective_hours=${effectiveHours}h`);
        noteParts.push(`total_gap=${totalGap}h`);
        noteParts.push(
          'state_gaps=' + gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : round2(g.gapHours) + 'h'}`).join(','),
        );
        if (allocations.length) {
          noteParts.push('alloc=' + allocations.map(a => `${a.state}:${a.hours}h`).join(','));
        }
        if (missingDemandStates.length) {
          noteParts.push(`missing_demand=${missingDemandStates.join(',')}`);
        }
        if (olderIds.length) noteParts.push(`supersedes=${olderIds.length}`);

        // Mark older as superseded
        if (olderIds.length) {
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
          counters.superseded += olderIds.length;
        }

        await writeDecision(supabase, latest.id, {
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          notes: noteParts.join('; '),
          decision_run_id: decisionRunId,
        });

        // Emit per-shift recommendations: one row per slot in the merged
        // timeline with a publish/cut decision. The scheduling team executes
        // by entering 'publish' rows into Homebase. Cut rows are documented
        // in case a provider asks why their submitted shift wasn't scheduled.
        await writeShiftRecommendations(supabase, {
          submissionIds: groupSubs.map(s => s.id),
          providerId,
          providerName: latest.provider_name,
          targetMonth,
          timeline,
          declinedHours: declined,
          allocations,
          decisionRunId,
          decisionStatus: status,
        });

        if (status === 'accepted') counters.accepted++;
        else if (status === 'partial') counters.partial++;
        else counters.declined++;

        decisions.push({
          group: key,
          provider: latest.provider_name,
          target_month: targetMonth,
          group_size: groupSubs.length,
          superseded: olderIds.length,
          effective_hours: effectiveHours,
          total_gap_hours: totalGap,
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          allocations,
        });

        // Update committed map so subsequent groups in this run see this allocation
        if (accepted > 0 && allocations.length) {
          for (const a of allocations) {
            const dKey = `${a.state}_${targetMonth}`;
            committedByKey.set(dKey, (committedByKey.get(dKey) ?? 0) + a.hours);
          }
        }
      } catch (e) {
        counters.errors++;
        const message = e instanceof Error ? e.message : String(e);
        decisions.push({ group: key, status: 'error', error: message });
        console.error('Evaluate error', key, message);
      }
    }

    return json({ ok: true, decision_run_id: decisionRunId, ...counters, decisions });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), decision_run_id: decisionRunId, ...counters }, 500);
  }
});

// ── Slot expansion ────────────────────────────────────────────────────────
function expandSubmissionSlots(
  submissionId: string,
  parsed: ParsedShifts | null,
  targetMonth: string,
): Slot[] {
  if (!parsed) return [];
  const slots: Slot[] = [];

  // Recurring weekly: expand to every matching weekday in target month
  for (const e of parseWidgetArray(parsed.recurring_virtual)) {
    const dayName = e['Day of Week'];
    const range = parseTimeRange(e['Start Time (ET)'], e['End Time (ET)']);
    if (!range || !dayName) continue;
    for (const date of weekdayDatesInMonth(dayName, targetMonth)) {
      pushSlot(slots, submissionId, date, range, 'virtual_recurring');
    }
  }

  // One-off virtual + in-home: each entry is one date
  const widgets: Array<{ raw: unknown; type: ShiftType }> = [
    { raw: parsed.one_off_virtual, type: 'virtual_oneoff' },
    { raw: parsed.in_home_clinic, type: 'in_home_clinic' },
  ];
  for (const w of widgets) {
    for (const e of parseWidgetArray(w.raw)) {
      const date = parseFormDate(e['Date']);
      const range = parseTimeRange(e['Start Time (ET)'], e['End Time (ET)']);
      if (!date || !range) continue;
      if (!isInMonth(date, targetMonth)) continue;
      pushSlot(slots, submissionId, date, range, w.type);
    }
  }

  return slots;
}

function pushSlot(
  out: Slot[],
  sourceSubmissionId: string,
  date: string,
  range: { startMin: number; endMin: number },
  shiftType: ShiftType,
) {
  // If endMin <= startMin (crosses midnight), split into two slots
  if (range.endMin <= range.startMin) {
    out.push({ date, startMin: range.startMin, endMin: 1440, sourceSubmissionId, shiftType });
    const next = nextDate(date);
    if (next) out.push({ date: next, startMin: 0, endMin: range.endMin, sourceSubmissionId, shiftType });
  } else {
    out.push({ date, startMin: range.startMin, endMin: range.endMin, sourceSubmissionId, shiftType });
  }
}

// ── Slot merging: new slot wins over overlapping existing ─────────────────
function mergeSlot(timeline: Slot[], incoming: Slot): Slot[] {
  const out: Slot[] = [];
  for (const existing of timeline) {
    if (existing.date !== incoming.date || !overlaps(existing, incoming)) {
      out.push(existing);
      continue;
    }
    // Trim existing to non-overlapping portions
    if (existing.startMin < incoming.startMin) {
      out.push({ ...existing, endMin: incoming.startMin });
    }
    if (existing.endMin > incoming.endMin) {
      out.push({ ...existing, startMin: incoming.endMin });
    }
    // Drop the part that fully overlaps with incoming
  }
  out.push(incoming);
  return out;
}

function overlaps(a: Slot, b: Slot): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

// ── Time / date helpers ───────────────────────────────────────────────────
function parseWidgetArray(raw: unknown): Record<string, string>[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is Record<string, string> => e != null && typeof e === 'object');
}

function parseTimeRange(start: string | undefined, end: string | undefined): { startMin: number; endMin: number } | null {
  if (!start || !end) return null;
  const s = parseTimeOfDay(start);
  const e = parseTimeOfDay(end);
  if (s == null || e == null) return null;
  return { startMin: s, endMin: e };
}

/** "09:00 AM" / "5:00 PM" / "13:00" → minutes from midnight (0..1440). */
function parseTimeOfDay(t: string): number | null {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[3] ?? '').toUpperCase();
  if (ampm === 'AM') {
    if (h === 12) h = 0;
  } else if (ampm === 'PM') {
    if (h !== 12) h += 12;
  }
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return h * 60 + min;
}

const DAY_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function weekdayDatesInMonth(dayName: string, monthISO: string): string[] {
  const dayIdx = DAY_TO_INDEX[String(dayName).trim().toLowerCase()];
  if (dayIdx === undefined) return [];
  const [y, m] = monthISO.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (dayIdx - firstWeekday + 7) % 7;
  const dates: string[] = [];
  for (let day = 1 + offset; day <= daysInMonth; day += 7) {
    dates.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

/** Form sends "MM-DD-YYYY" (e.g. "06-04-2026"). */
function parseFormDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function isInMonth(dateISO: string, monthISO: string): boolean {
  return dateISO >= monthISO && dateISO < nextMonth(monthISO);
}

function nextMonth(monthISO: string): string {
  const [y, m] = monthISO.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function nextDate(dateISO: string): string | null {
  const d = new Date(dateISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── DB writes ─────────────────────────────────────────────────────────────
async function writeDecision(
  supabase: ReturnType<typeof createClient>,
  submissionId: string,
  decision: {
    status: 'accepted' | 'partial' | 'declined';
    accepted_hours: number;
    declined_hours: number;
    notes: string;
    decision_run_id: string;
  },
) {
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: decision.status,
      accepted_hours: decision.accepted_hours,
      declined_hours: decision.declined_hours,
      decision_notes: decision.notes,
      decided_at: new Date().toISOString(),
      decision_run_id: decision.decision_run_id,
    })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

async function writeShiftRecommendations(
  supabase: ReturnType<typeof createClient>,
  args: {
    submissionIds: string[];
    providerId: string;
    providerName: string;
    targetMonth: string;
    timeline: Slot[];
    declinedHours: number;
    allocations: Array<{ state: string; hours: number }>;
    decisionRunId: string;
    decisionStatus: 'accepted' | 'partial' | 'declined';
  },
) {
  // Wipe any prior recommendations for this group so re-runs are idempotent.
  // CASCADE on submission_id FK isn't automatic on rerun; do it explicitly.
  await supabase
    .from('shift_recommendations')
    .delete()
    .in('submission_id', args.submissionIds);

  if (args.timeline.length === 0) return;

  // Cut budget walks the timeline from the END of the month, latest slot first.
  // This preserves earlier-month commitments — providers expect to work the
  // hours they submitted at the start of the month and lose later flexibility
  // if oversupplied.
  const sortedDesc = [...args.timeline].sort((a, b) =>
    b.date.localeCompare(a.date) || b.startMin - a.startMin,
  );
  let cutBudget = round2(args.declinedHours);
  const cutSlots = new Set<Slot>();
  for (const slot of sortedDesc) {
    if (cutBudget <= 0.001) break;
    const slotHours = round2((slot.endMin - slot.startMin) / 60);
    cutSlots.add(slot);
    cutBudget = round2(cutBudget - slotHours);
  }

  // For publish slots, assign a state from the allocation buckets.
  // Walk slots in chronological order; each slot consumes hours from the
  // state with the largest remaining bucket. This naturally distributes
  // shifts across multi-state providers' allocations.
  const sortedAsc = [...args.timeline].sort((a, b) =>
    a.date.localeCompare(b.date) || a.startMin - b.startMin,
  );
  const buckets = new Map<string, number>(args.allocations.map(a => [a.state, a.hours]));

  const rows = sortedAsc.map(slot => {
    const slotHours = round2((slot.endMin - slot.startMin) / 60);
    const isCut = cutSlots.has(slot);
    let assignedState: string | null = null;
    let reason: string;

    if (isCut) {
      reason = args.decisionStatus === 'declined'
        ? 'Provider has no remaining demand-hour gap in any licensed state'
        : 'Trimmed as oversupply — accepted hours capped at network demand';
    } else {
      // Pick the bucket with largest remaining hours
      let bestState: string | null = null;
      let bestRemaining = -1;
      for (const [state, remaining] of buckets) {
        if (remaining > bestRemaining) {
          bestState = state;
          bestRemaining = remaining;
        }
      }
      assignedState = bestState;
      if (bestState) {
        buckets.set(bestState, round2((buckets.get(bestState) ?? 0) - slotHours));
      }
      reason = bestState
        ? `Publish to ${bestState} (largest remaining state gap at time of allocation)`
        : 'Publish (no state allocation; review manually)';
    }

    return {
      submission_id: slot.sourceSubmissionId,
      provider_id: args.providerId,
      provider_name: args.providerName,
      target_month: args.targetMonth,
      shift_date: slot.date,
      start_min: slot.startMin,
      end_min: slot.endMin,
      hours: slotHours,
      shift_type: slot.shiftType,
      assigned_state: assignedState,
      recommendation: isCut ? 'cut' : 'publish',
      recommendation_reason: reason,
      decision_run_id: args.decisionRunId,
      publish_status: 'pending',
    };
  });

  if (rows.length === 0) return;

  // Insert in chunks to stay under PostgREST limits
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('shift_recommendations').insert(chunk);
    if (error) throw new Error(`shift_recommendations insert failed: ${error.message}`);
  }
}

async function markSuperseded(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
  decisionRunId: string,
  note: string,
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: 'superseded',
      accepted_hours: 0,
      declined_hours: 0,
      decision_notes: note,
      decided_at: new Date().toISOString(),
      decision_run_id: decisionRunId,
    })
    .in('id', ids);
  if (error) throw new Error(error.message);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
