const ET_TIME_ZONE = 'America/New_York';
const MATCH_TOLERANCE_MINUTES = 15;

export type HomebaseConfirmationStatus =
  | 'not_applicable'
  | 'published'
  | 'unpublished'
  | 'unscheduled'
  | 'not_found';

export interface ShiftRecommendationLike {
  id: string;
  provider_id: string | null;
  recommendation: string;
  shift_date: string;
  start_min: number;
  end_min: number;
}

export interface HomebaseShiftLike {
  homebase_id: number | string;
  homebase_employee_id: string | null;
  published: boolean | null;
  scheduled: boolean | null;
  start_at: string | null;
  end_at: string | null;
  synced_at: string | null;
}

export interface HomebaseEmployeeLike {
  id: string;
  profile_id: string | null;
}

export interface HomebaseShiftConfirmation {
  status: HomebaseConfirmationStatus;
  homebase_shift_id: string | null;
  published: boolean | null;
  scheduled: boolean | null;
  synced_at: string | null;
}

export type WithHomebaseConfirmation<T> = T & {
  homebase_confirmation: HomebaseShiftConfirmation;
};

type IndexedHomebaseShift = HomebaseShiftLike & {
  provider_id: string;
  shift_date: string;
  start_min: number;
  end_min: number;
};

const noConfirmation = (status: HomebaseConfirmationStatus): HomebaseShiftConfirmation => ({
  status,
  homebase_shift_id: null,
  published: null,
  scheduled: null,
  synced_at: null,
});

const statusForHomebaseShift = (shift: HomebaseShiftLike): HomebaseConfirmationStatus => {
  if (shift.scheduled === false) return 'unscheduled';
  return shift.published ? 'published' : 'unpublished';
};

const confirmationForShift = (shift: HomebaseShiftLike): HomebaseShiftConfirmation => ({
  status: statusForHomebaseShift(shift),
  homebase_shift_id: String(shift.homebase_id),
  published: shift.published,
  scheduled: shift.scheduled,
  synced_at: shift.synced_at,
});

const exactKey = (providerId: string, date: string, startMin: number, endMin: number) =>
  `${providerId}|${date}|${startMin}|${endMin}`;

const providerDateKey = (providerId: string, date: string) => `${providerId}|${date}`;

export function attachHomebaseConfirmations<T extends ShiftRecommendationLike>(
  rows: T[],
  homebaseShifts: HomebaseShiftLike[],
  homebaseEmployees: HomebaseEmployeeLike[],
): Array<WithHomebaseConfirmation<T>> {
  const providerIdByEmployeeId = new Map(
    homebaseEmployees
      .filter(employee => Boolean(employee.profile_id))
      .map(employee => [employee.id, employee.profile_id!] as const),
  );

  const exactMatches = new Map<string, IndexedHomebaseShift[]>();
  const providerDateMatches = new Map<string, IndexedHomebaseShift[]>();

  for (const shift of homebaseShifts) {
    if (!shift.homebase_employee_id || !shift.start_at || !shift.end_at) continue;
    const providerId = providerIdByEmployeeId.get(shift.homebase_employee_id);
    if (!providerId) continue;

    const start = getEasternDateTimeParts(shift.start_at);
    const end = getEasternDateTimeParts(shift.end_at);
    if (!start || !end) continue;

    const indexed: IndexedHomebaseShift = {
      ...shift,
      provider_id: providerId,
      shift_date: start.date,
      start_min: start.minutes,
      end_min: end.minutes,
    };

    const exact = exactKey(providerId, indexed.shift_date, indexed.start_min, indexed.end_min);
    const byDate = providerDateKey(providerId, indexed.shift_date);
    exactMatches.set(exact, [...(exactMatches.get(exact) ?? []), indexed]);
    providerDateMatches.set(byDate, [...(providerDateMatches.get(byDate) ?? []), indexed]);
  }

  return rows.map(row => {
    if (row.recommendation !== 'publish') {
      return { ...row, homebase_confirmation: noConfirmation('not_applicable') };
    }
    if (!row.provider_id) {
      return { ...row, homebase_confirmation: noConfirmation('not_found') };
    }

    const exact = exactMatches.get(exactKey(row.provider_id, row.shift_date, row.start_min, row.end_min));
    const exactMatch = pickBestHomebaseShift(exact);
    if (exactMatch) {
      return { ...row, homebase_confirmation: confirmationForShift(exactMatch) };
    }

    const candidates = providerDateMatches.get(providerDateKey(row.provider_id, row.shift_date)) ?? [];
    const nearMatch = pickBestHomebaseShift(
      candidates.filter(candidate =>
        Math.abs(candidate.start_min - row.start_min) <= MATCH_TOLERANCE_MINUTES &&
        Math.abs(candidate.end_min - row.end_min) <= MATCH_TOLERANCE_MINUTES,
      ),
    );
    if (nearMatch) {
      return { ...row, homebase_confirmation: confirmationForShift(nearMatch) };
    }

    const containingMatch = pickBestHomebaseShift(
      candidates.filter(candidate =>
        candidate.scheduled !== false &&
        candidate.start_min <= row.start_min &&
        candidate.end_min >= row.end_min,
      ),
    );

    return {
      ...row,
      homebase_confirmation: containingMatch
        ? confirmationForShift(containingMatch)
        : noConfirmation('not_found'),
    };
  });
}

function pickBestHomebaseShift<T extends HomebaseShiftLike>(shifts: T[] | undefined): T | null {
  if (!shifts || shifts.length === 0) return null;
  return [...shifts].sort((a, b) => {
    const aRank = a.scheduled === false ? 2 : a.published ? 0 : 1;
    const bRank = b.scheduled === false ? 2 : b.published ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (b.synced_at ?? '').localeCompare(a.synced_at ?? '');
  })[0];
}

function getEasternDateTimeParts(iso: string): { date: string; minutes: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const minute = Number(values.minute);
  if (!values.year || !values.month || !values.day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: hour * 60 + minute,
  };
}
