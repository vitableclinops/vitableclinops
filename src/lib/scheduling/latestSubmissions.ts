export type LatestSchedulingSubmission = {
  id: string;
  provider_id: string | null;
  target_month: string | null;
  decision_status: string | null;
  submitted_at: string | null;
};

export type ShiftRecommendationIdentity = {
  submission_id?: string | null;
};

export type ShiftRecommendationNaturalIdentity = ShiftRecommendationIdentity & {
  shift_date?: string | null;
  start_min?: number | string | null;
  end_min?: number | string | null;
  shift_type?: string | null;
  publish_status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  id?: string | null;
};

const ACCEPTED_DECISIONS = new Set(['accepted', 'partial']);
const LOCKED_PUBLISH_STATUSES = new Set(['published_to_homebase', 'confirmed']);

const isLockedPublishedRow = (row: ShiftRecommendationIdentity) =>
  LOCKED_PUBLISH_STATUSES.has(
    (row as ShiftRecommendationIdentity & { publish_status?: string | null }).publish_status ?? '',
  );

const submissionGroupKey = (row: LatestSchedulingSubmission) => {
  if (!row.provider_id || !row.target_month) return null;
  return `${row.provider_id}|${row.target_month}`;
};

const isNewerSubmission = (
  candidate: LatestSchedulingSubmission,
  current: LatestSchedulingSubmission,
) => {
  const candidateSubmittedAt = candidate.submitted_at ?? '';
  const currentSubmittedAt = current.submitted_at ?? '';
  if (candidateSubmittedAt !== currentSubmittedAt) {
    return candidateSubmittedAt > currentSubmittedAt;
  }
  return candidate.id > current.id;
};

export function latestSubmissionIds(
  submissions: LatestSchedulingSubmission[],
  allowedDecisions?: ReadonlySet<string>,
): Set<string> {
  const latestByProviderMonth = new Map<string, LatestSchedulingSubmission>();
  for (const submission of submissions) {
    if (submission.decision_status === 'superseded') continue;
    const key = submissionGroupKey(submission);
    if (!key) continue;
    const current = latestByProviderMonth.get(key);
    if (!current || isNewerSubmission(submission, current)) {
      latestByProviderMonth.set(key, submission);
    }
  }

  const ids = new Set<string>();
  for (const submission of latestByProviderMonth.values()) {
    if (!allowedDecisions || allowedDecisions.has(submission.decision_status ?? '')) {
      ids.add(submission.id);
    }
  }
  return ids;
}

export function latestAcceptedSubmissionIds(
  submissions: LatestSchedulingSubmission[],
): Set<string> {
  return latestSubmissionIds(submissions, ACCEPTED_DECISIONS);
}

export function filterRowsToLatestSubmissions<T extends ShiftRecommendationIdentity>(
  rows: T[],
  submissions: LatestSchedulingSubmission[],
): T[] {
  const latestIds = latestSubmissionIds(submissions);
  if (latestIds.size === 0) return [];
  return rows.filter(row => {
    const submissionId = row.submission_id;
    return Boolean(submissionId && latestIds.has(submissionId));
  });
}

export function filterRowsToLatestAcceptedSubmissions<T extends ShiftRecommendationIdentity>(
  rows: T[],
  submissions: LatestSchedulingSubmission[],
): T[] {
  const acceptedLatestIds = latestAcceptedSubmissionIds(submissions);
  if (acceptedLatestIds.size === 0) return rows.filter(isLockedPublishedRow);
  return rows.filter(row => {
    const submissionId = row.submission_id;
    return isLockedPublishedRow(row) || Boolean(submissionId && acceptedLatestIds.has(submissionId));
  });
}

export function shiftRecommendationNaturalKey(
  row: ShiftRecommendationNaturalIdentity,
): string | null {
  if (
    !row.submission_id ||
    !row.shift_date ||
    row.start_min == null ||
    row.end_min == null ||
    !row.shift_type
  ) {
    return null;
  }
  return `${row.submission_id}|${row.shift_date}|${row.start_min}|${row.end_min}|${row.shift_type}`;
}

const publishStatusRank = (status: string | null | undefined) => {
  if (status === 'confirmed') return 1;
  if (status === 'published_to_homebase') return 2;
  if (status === 'pending') return 3;
  return 4;
};

const shouldPreferShiftRow = (
  candidate: ShiftRecommendationNaturalIdentity,
  current: ShiftRecommendationNaturalIdentity,
) => {
  const candidateRank = publishStatusRank(candidate.publish_status);
  const currentRank = publishStatusRank(current.publish_status);
  if (candidateRank !== currentRank) return candidateRank < currentRank;

  const candidateTimestamp = candidate.updated_at ?? candidate.created_at ?? '';
  const currentTimestamp = current.updated_at ?? current.created_at ?? '';
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;

  return (candidate.id ?? '') > (current.id ?? '');
};

export function dedupeShiftRecommendationRows<T extends ShiftRecommendationNaturalIdentity>(
  rows: T[],
): T[] {
  const out: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const key = shiftRecommendationNaturalKey(row);
    if (!key) {
      out.push(row);
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      indexByKey.set(key, out.length);
      out.push(row);
      continue;
    }

    if (shouldPreferShiftRow(row, out[existingIndex])) {
      out[existingIndex] = row;
    }
  }

  return out;
}
