export type PublishDisplayDecisionStatus =
  | 'accepted'
  | 'partial'
  | 'declined'
  | 'needs_review'
  | 'pending'
  | 'superseded'
  | null
  | undefined;

export type PublishDisplayShift = {
  hours?: number | string | null;
  publish_status?: string | null;
};

export type PublishDisplayValues = {
  publishedHours: number;
  openAcceptedHours: number;
  displayAcceptedHours: number;
  publishedShiftCount: number;
  totalShiftCount: number;
  status: PublishDisplayDecisionStatus | 'published' | 'mixed_published';
  statusLabel: string;
  hasShiftRows: boolean;
  hasPublishedRows: boolean;
};

const LOCKED_PUBLISH_STATUSES = new Set(['published_to_homebase', 'confirmed']);

const STATUS_LABELS: Record<Exclude<PublishDisplayDecisionStatus, null | undefined>, string> = {
  accepted: 'Accepted',
  partial: 'Partial',
  declined: 'Declined',
  needs_review: 'Needs review',
  pending: 'Pending',
  superseded: 'Superseded',
};

const numericHours = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const isLockedPublishStatus = (status: string | null | undefined) =>
  LOCKED_PUBLISH_STATUSES.has(status ?? '');

export function derivePublishDisplayValues(args: {
  shifts?: PublishDisplayShift[] | null;
  acceptedHours?: number | string | null;
  decisionStatus?: PublishDisplayDecisionStatus;
}): PublishDisplayValues {
  const shifts = args.shifts ?? [];
  const publishedShifts = shifts.filter(shift => isLockedPublishStatus(shift.publish_status));
  const openShifts = shifts.filter(shift => !isLockedPublishStatus(shift.publish_status));
  const publishedHours = publishedShifts.reduce((sum, shift) => sum + numericHours(shift.hours), 0);
  const openAcceptedHours = openShifts.reduce((sum, shift) => sum + numericHours(shift.hours), 0);
  const hasShiftRows = shifts.length > 0;
  const hasPublishedRows = publishedShifts.length > 0;
  const displayAcceptedHours = hasShiftRows
    ? publishedHours + openAcceptedHours
    : numericHours(args.acceptedHours);

  if (hasShiftRows && publishedShifts.length === shifts.length) {
    return {
      publishedHours,
      openAcceptedHours,
      displayAcceptedHours,
      publishedShiftCount: publishedShifts.length,
      totalShiftCount: shifts.length,
      status: 'published',
      statusLabel: 'Published',
      hasShiftRows,
      hasPublishedRows,
    };
  }

  if (hasPublishedRows) {
    return {
      publishedHours,
      openAcceptedHours,
      displayAcceptedHours,
      publishedShiftCount: publishedShifts.length,
      totalShiftCount: shifts.length,
      status: 'mixed_published',
      statusLabel: `Partial · ${publishedShifts.length}/${shifts.length} published`,
      hasShiftRows,
      hasPublishedRows,
    };
  }

  const decisionStatus = args.decisionStatus ?? null;
  return {
    publishedHours,
    openAcceptedHours,
    displayAcceptedHours,
    publishedShiftCount: 0,
    totalShiftCount: shifts.length,
    status: decisionStatus,
    statusLabel: decisionStatus ? STATUS_LABELS[decisionStatus] : 'No submission',
    hasShiftRows,
    hasPublishedRows,
  };
}
