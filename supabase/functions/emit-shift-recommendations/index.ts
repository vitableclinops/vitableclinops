/**
 * emit-shift-recommendations edge function
 *
 * Reads post-decision schedule_submissions and writes per-shift
 * publish/cut rows into shift_recommendations. The output is what the
 * scheduling team uses to enter shifts into Homebase.
 *
 * Runs after evaluate-schedule-submissions has set decision_status,
 * accepted_hours, declined_hours and a decision_notes string that
 * includes "alloc=ST:Hh,..." for the per-state allocations.
 *
 * Per slot:
 *   - We expand each submission's parsed_shifts into Slot[] (recurring
 *     weekly + one-off + in-home), then merge by submitted_at chronology
 *     (later wins).
 *   - We determine cut vs publish: walk timeline END-of-month-first and
 *     mark slots as 'cut' until we've cut declined_hours total. Earlier
 *     slots get 'publish'. This preserves earlier-month commitments.
 *   - For 'publish' slots, we assign the state with the largest remaining
 *     allocation bucket at time of placement. Buckets come from the
 *     evaluator's "alloc=" notes.
 *
 * Modes:
 *   POST /functions/v1/emit-shift-recommendations?target_month=YYYY-MM-01
 *   POST /functions/v1/emit-shift-recommendations?provider_id=<uuid>
 *   POST /functions/v1/emit-shift-recommendations
 *     -> all current+future-month submissions with a decision
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ShiftType = 'virtual_recurring' | 'virtual_oneoff' | 'in_home_clinic';

type Slot = {
  date: string;
  startMin: number;
  endMin: number;
  sourceSubmissionId: string;
  shiftType: ShiftType;
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: Record<string, unknown> | null;
  decision_status: string;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  submitted_at: string;
  decision_run_id: string | null;
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

  const counters = {
    groups: 0,
    rows_inserted: 0,
    rows_deleted: 0,
    skipped_no_decision: 0,
    errors: 0,
  };
  const errors: Array<{ submission_id: string; error: string }> = [];

  try {
    let q = supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id');

    if (monthFilter) q = q.eq('target_month', monthFilter);
    if (providerFilter) q = q.eq('provider_id', providerFilter);
    q = q.in('decision_status', ['accepted', 'partial', 'declined']);
    q = q.range(0, 49999);

    const { data, error } = await q;
    if (error) throw new Error(`submissions load: ${error.message}`);

    const subs = (data ?? []) as Submission[];

    // Group by (provider_id, target_month). Within each group we need every
    // submission (to rebuild the merged timeline), but only the latest
    // carries the decision_notes / accepted / declined fields.
    const groups = new Map<string, Submission[]>();
    for (const s of subs) {
      if (!s.provider_id) continue;
      const k = `${s.provider_id}|${s.target_month}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }

    // Need the full set of submissions (including superseded) to rebuild
    // the timeline correctly. Fetch any superseded peers we missed above.
    const providerMonths = Array.from(groups.keys());
    if (providerMonths.length > 0) {
      const providerIds = Array.from(new Set(providerMonths.map(k => k.split('|')[0])));
      const months = Array.from(new Set(providerMonths.map(k => k.split('|')[1])));
      const { data: peers, error: pErr } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id')
        .in('provider_id', providerIds)
        .in('target_month', months)
        .eq('decision_status', 'superseded')
        .range(0, 49999);
      if (pErr) throw new Error(`peer load: ${pErr.message}`);
      for (const s of (peers ?? []) as Submission[]) {
        if (!s.provider_id) continue;
        const k = `${s.provider_id}|${s.target_month}`;
        if (groups.has(k)) groups.get(k)!.push(s);
      }
    }

    for (const [key, groupSubs] of groups) {
      try {
        counters.groups++;
        // The latest non-superseded carries the decision
        const decided = groupSubs
          .filter(s => s.decision_status !== 'superseded')
          .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
        if (!decided) {
          counters.skipped_no_decision++;
          continue;
        }

        // Wipe prior recommendations for every submission in this group
        // so re-runs are idempotent.
        const ids = groupSubs.map(s => s.id);
        const { count: deletedCount, error: dErr } = await supabase
          .from('shift_recommendations')
          .delete({ count: 'exact' })
          .in('submission_id', ids);
        if (dErr) throw new Error(`delete prior: ${dErr.message}`);
        counters.rows_deleted += deletedCount ?? 0;

        if (decided.decision_status === 'declined') {
          // Treat declined as: every submitted slot gets 'cut'
        }

        // Build merged slot timeline (chronological, later wins on overlap)
        const ordered = [...groupSubs].sort((a, b) =>
          a.submitted_at.localeCompare(b.submitted_at),
        );
        let timeline: Slot[] = [];
        for (const sub of ordered) {
          const slots = expandSubmissionSlots(sub.id, sub.parsed_shifts ?? null, sub.target_month);
          for (const slot of slots) timeline = mergeSlot(timeline, slot);
        }

        if (timeline.length === 0) continue;

        const accepted = Number(decided.accepted_hours ?? 0);
        const declined = Number(decided.declined_hours ?? 0);
        const allocations = parseAllocations(decided.decision_notes ?? '');

        // Cut slots latest-first until cut budget is exhausted
        const cutSlots = new Set<Slot>();
        const sortedDesc = [...timeline].sort((a, b) =>
          b.date.localeCompare(a.date) || b.startMin - a.startMin,
        );
        let cutBudget = round2(decided.decision_status === 'declined'
          ? sumHours(timeline)
          : declined);
        for (const slot of sortedDesc) {
          if (cutBudget <= 0.001) break;
          const slotHours = round2((slot.endMin - slot.startMin) / 60);
          cutSlots.add(slot);
          cutBudget = round2(cutBudget - slotHours);
        }

        // Assign states to publish slots
        const buckets = new Map<string, number>(allocations.map(a => [a.state, a.hours]));
        const sortedAsc = [...timeline].sort((a, b) =>
          a.date.localeCompare(b.date) || a.startMin - b.startMin,
        );

        const rows = sortedAsc.map(slot => {
          const slotHours = round2((slot.endMin - slot.startMin) / 60);
          const isCut = cutSlots.has(slot);
          let assignedState: string | null = null;
          let reason: string;

          if (isCut) {
            reason = decided.decision_status === 'declined'
              ? 'Declined — no demand-hour gap remained in any licensed state when allocator processed this provider'
              : 'Trimmed as oversupply — accepted hours capped at network demand';
          } else {
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
              ? `Publish to ${bestState} (largest remaining state allocation at time of placement)`
              : 'Publish (no state allocation parsed; review manually)';
          }

          return {
            submission_id: slot.sourceSubmissionId,
            provider_id: decided.provider_id,
            provider_name: decided.provider_name,
            target_month: decided.target_month,
            shift_date: slot.date,
            start_min: slot.startMin,
            end_min: slot.endMin,
            hours: slotHours,
            shift_type: slot.shiftType,
            assigned_state: assignedState,
            recommendation: isCut ? 'cut' : 'publish',
            recommendation_reason: reason,
            decision_run_id: decided.decision_run_id ?? crypto.randomUUID(),
            publish_status: 'pending',
          };
        });

        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const { error: iErr } = await supabase.from('shift_recommendations').insert(chunk);
          if (iErr) throw new Error(`insert: ${iErr.message}`);
          counters.rows_inserted += chunk.length;
        }
      } catch (e) {
        counters.errors++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ submission_id: key, error: msg });
        console.error('group failed', key, msg);
      }
    }

    return json({ ok: true, ...counters, errors });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), ...counters }, 500);
  }
});

// ── helpers (mirrored from evaluate-schedule-submissions) ──────────────────
function expandSubmissionSlots(
  submissionId: string,
  parsed: Record<string, unknown> | null,
  targetMonth: string,
): Slot[] {
  if (!parsed) return [];
  const slots: Slot[] = [];

  for (const e of parseWidgetArray(parsed.recurring_virtual)) {
    const dayName = e['Day of Week'];
    const range = parseTimeRange(e['Start Time (ET)'], e['End Time (ET)']);
    if (!range || !dayName) continue;
    for (const date of weekdayDatesInMonth(dayName, targetMonth)) {
      pushSlot(slots, submissionId, date, range, 'virtual_recurring');
    }
  }
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
  out: Slot[], sid: string, date: string,
  range: { startMin: number; endMin: number }, type: ShiftType,
) {
  if (range.endMin <= range.startMin) {
    // Crosses midnight: same-day portion runs to 24:00
    if (range.startMin < 1440) {
      out.push({ date, startMin: range.startMin, endMin: 1440, sourceSubmissionId: sid, shiftType: type });
    }
    // Next-day continuation only if there's actual time past midnight.
    // Form quirk: providers sometimes enter "12:00 AM" as End Time meaning
    // "until midnight"; that yields endMin=0 with no real continuation.
    if (range.endMin > 0) {
      const next = nextDate(date);
      if (next) out.push({ date: next, startMin: 0, endMin: range.endMin, sourceSubmissionId: sid, shiftType: type });
    }
  } else {
    out.push({ date, startMin: range.startMin, endMin: range.endMin, sourceSubmissionId: sid, shiftType: type });
  }
}

function mergeSlot(timeline: Slot[], incoming: Slot): Slot[] {
  const out: Slot[] = [];
  for (const existing of timeline) {
    if (existing.date !== incoming.date || !overlaps(existing, incoming)) {
      out.push(existing);
      continue;
    }
    if (existing.startMin < incoming.startMin) out.push({ ...existing, endMin: incoming.startMin });
    if (existing.endMin > incoming.endMin) out.push({ ...existing, startMin: incoming.endMin });
  }
  out.push(incoming);
  return out;
}

function overlaps(a: Slot, b: Slot): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

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

function parseTimeOfDay(t: string): number | null {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[3] ?? '').toUpperCase();
  if (ampm === 'AM') { if (h === 12) h = 0; }
  else if (ampm === 'PM') { if (h !== 12) h += 12; }
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return h * 60 + min;
}

const DAY_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function weekdayDatesInMonth(dayName: string, monthISO: string): string[] {
  const idx = DAY_TO_INDEX[String(dayName).trim().toLowerCase()];
  if (idx === undefined) return [];
  const [y, m] = monthISO.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (idx - firstWeekday + 7) % 7;
  const out: string[] = [];
  for (let day = 1 + offset; day <= daysInMonth; day += 7) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

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

function parseAllocations(notes: string): Array<{ state: string; hours: number }> {
  const allocStr = notes.match(/alloc=([^;]+)/);
  if (!allocStr) return [];
  const out: Array<{ state: string; hours: number }> = [];
  const re = /([A-Z]{2}):([0-9.]+)h/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allocStr[1])) !== null) {
    const hours = Number(m[2]);
    if (Number.isFinite(hours) && hours > 0) out.push({ state: m[1], hours });
  }
  return out;
}

function sumHours(slots: Slot[]): number {
  return slots.reduce((s, x) => s + (x.endMin - x.startMin) / 60, 0);
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
