export const DEFAULT_SCHEDULE_TIME_ZONE = 'America/New_York';

type DateParts = {
  year: number;
  month: number;
  day: number;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  const tz = (timeZone ?? '').trim();
  if (!tz) return DEFAULT_SCHEDULE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_SCHEDULE_TIME_ZONE;
  }
}

export function formatShiftDateKeyInProviderTime(
  shiftDate: string,
  startMin: number,
  providerTimeZone: string | null | undefined,
): string {
  const date = sourceScheduleDateToUtc(shiftDate, startMin);
  const parts = partsInTimeZone(date, normalizeTimeZone(providerTimeZone));
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function formatShiftDateLabelInProviderTime(
  shiftDate: string,
  startMin: number,
  providerTimeZone: string | null | undefined,
): string {
  const date = sourceScheduleDateToUtc(shiftDate, startMin);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(providerTimeZone),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatShiftTimeRangeInProviderTime(
  shiftDate: string,
  startMin: number,
  endMin: number,
  providerTimeZone: string | null | undefined,
): string {
  const timeZone = normalizeTimeZone(providerTimeZone);
  const start = sourceScheduleDateToUtc(shiftDate, startMin);
  const end = sourceScheduleDateToUtc(shiftDate, endMin);
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const zoneFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  });
  const zone = zoneFormatter
    .formatToParts(start)
    .find(part => part.type === 'timeZoneName')?.value;
  return `${timeFormatter.format(start)}-${timeFormatter.format(end)}${zone ? ` ${zone}` : ''}`;
}

function sourceScheduleDateToUtc(shiftDate: string, totalMinutes: number): Date {
  const [year, month, day] = shiftDate.split('-').map(Number);
  const dayOffset = Math.floor(totalMinutes / 1440);
  const minuteOfDay = ((totalMinutes % 1440) + 1440) % 1440;
  const base = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const sourceParts = {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return zonedLocalToUtcDate(sourceParts, hour, minute, DEFAULT_SCHEDULE_TIME_ZONE);
}

function zonedLocalToUtcDate(
  parts: DateParts,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  let utcMillis = localAsUtc;
  for (let i = 0; i < 3; i++) {
    const offset = timeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const next = localAsUtc - offset * 60_000;
    if (Math.abs(next - utcMillis) < 1000) {
      utcMillis = next;
      break;
    }
    utcMillis = next;
  }
  return new Date(utcMillis);
}

function partsInTimeZone(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = new Map(parts.map(part => [part.type, part.value]));
  return {
    year: Number(lookup.get('year')),
    month: Number(lookup.get('month')),
    day: Number(lookup.get('day')),
  };
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const lookup = new Map(parts.map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.get('year')),
    Number(lookup.get('month')) - 1,
    Number(lookup.get('day')),
    Number(lookup.get('hour')),
    Number(lookup.get('minute')),
    Number(lookup.get('second')),
  );
  return (asUtc - date.getTime()) / 60_000;
}
