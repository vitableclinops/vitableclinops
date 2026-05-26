/**
 * homebase-hours-by-role
 *
 * Returns scheduled hours aggregated by role and calendar week for a given month.
 * Calls the Homebase API directly so it works even before the hourly sync runs.
 *
 * Query params:
 *   year  (default: 2026)
 *   month (default: 6, 1-based)
 *
 * Response shape:
 *   {
 *     month: "2026-06",
 *     weeks: [{ label, start, end }],
 *     roles: [{ role, weekly_hours: number[], monthly_total: number }],
 *     grand_total_by_week: number[],
 *     grand_total_monthly: number,
 *     shifts_counted: number
 *   }
 *
 * Required secret: HOMEBASE_API_KEY
 */

import { HomebaseClient } from '../_shared/homebaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Build week buckets for the given month. Each week is Mon–Sun clamped to the month. */
function buildWeeks(year: number, month: number) {
  // month is 1-based
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay  = new Date(Date.UTC(year, month, 0)); // day 0 = last day of prev month+1

  const weeks: { label: string; start: string; end: string }[] = [];

  // Walk forward in week-sized steps starting from the first Monday ≤ firstDay
  const dayOfWeek = firstDay.getUTCDay(); // 0=Sun,1=Mon,...
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const cursor = new Date(firstDay);
  cursor.setUTCDate(cursor.getUTCDate() + offsetToMonday);

  while (cursor <= lastDay) {
    const weekStart = new Date(cursor);
    const weekEnd   = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    // Clamp to month boundaries
    const clampedStart = weekStart < firstDay ? firstDay : weekStart;
    const clampedEnd   = weekEnd   > lastDay  ? lastDay  : weekEnd;

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const fmtLabel = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    weeks.push({
      label: `${fmtLabel(clampedStart)}–${fmtLabel(clampedEnd)}`,
      start: fmt(clampedStart),
      end:   fmt(clampedEnd),
    });

    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return weeks;
}

/** Returns the index into `weeks` that contains this date string (YYYY-MM-DD). */
function weekIndex(
  dateStr: string,
  weeks: { start: string; end: string }[]
): number {
  for (let i = 0; i < weeks.length; i++) {
    if (dateStr >= weeks[i].start && dateStr <= weeks[i].end) return i;
  }
  return -1;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('HOMEBASE_API_KEY');
  if (!apiKey) return json({ error: 'HOMEBASE_API_KEY secret not set' }, 500);

  const url   = new URL(req.url);
  const year  = parseInt(url.searchParams.get('year')  ?? '2026', 10);
  const month = parseInt(url.searchParams.get('month') ?? '6',    10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return json({ error: 'Invalid year/month params' }, 400);
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // Last day of month
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  const weeks = buildWeeks(year, month);

  // role → [hours per week]
  const roleWeeklyHours = new Map<string, number[]>();

  const getOrInit = (role: string) => {
    if (!roleWeeklyHours.has(role)) {
      roleWeeklyHours.set(role, new Array(weeks.length).fill(0));
    }
    return roleWeeklyHours.get(role)!;
  };

  const hb = new HomebaseClient(apiKey);
  let shiftsCount = 0;

  try {
    const locations = await hb.listLocations();

    for (const loc of locations) {
      for await (const shift of hb.iterateShifts(loc.uuid, startDate, endDate)) {
        const hours = shift.labor?.scheduled_hours ?? 0;
        if (hours <= 0) continue;

        const shiftDate = shift.start_at?.slice(0, 10) ?? '';
        const wi = weekIndex(shiftDate, weeks);
        if (wi === -1) continue; // outside the month (shouldn't happen)

        const role = (shift.role?.trim() || 'Unknown').replace(/\s+/g, ' ');
        getOrInit(role)[wi] += hours;
        shiftsCount++;
      }
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }

  // Sort roles alphabetically
  const sortedRoles = [...roleWeeklyHours.keys()].sort((a, b) => a.localeCompare(b));

  const roles = sortedRoles.map((role) => {
    const weekly = roleWeeklyHours.get(role)!.map((h) => Math.round(h * 100) / 100);
    const monthly_total = Math.round(weekly.reduce((s, h) => s + h, 0) * 100) / 100;
    return { role, weekly_hours: weekly, monthly_total };
  });

  const grandByWeek = weeks.map((_, wi) =>
    Math.round(roles.reduce((s, r) => s + r.weekly_hours[wi], 0) * 100) / 100
  );
  const grandMonthly = Math.round(grandByWeek.reduce((s, h) => s + h, 0) * 100) / 100;

  return json({
    month:               `${year}-${String(month).padStart(2, '0')}`,
    weeks,
    roles,
    grand_total_by_week: grandByWeek,
    grand_total_monthly: grandMonthly,
    shifts_counted:      shiftsCount,
  });
});
