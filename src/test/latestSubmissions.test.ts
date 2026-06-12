import { describe, expect, it } from 'vitest';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestAcceptedSubmissions,
  filterRowsToLatestSubmissions,
  latestAcceptedSubmissionIds,
  type LatestSchedulingSubmission,
} from '@/lib/scheduling/latestSubmissions';

const submission = (
  overrides: Partial<LatestSchedulingSubmission>,
): LatestSchedulingSubmission => ({
  id: 'sub-1',
  provider_id: 'provider-1',
  target_month: '2026-07-01',
  decision_status: 'accepted',
  submitted_at: '2026-06-01T00:00:00Z',
  ...overrides,
});

describe('latest scheduling submission scoping', () => {
  it('keeps only the latest accepted or partial submission per provider/month', () => {
    const submissions = [
      submission({ id: 'old', submitted_at: '2026-06-01T00:00:00Z' }),
      submission({ id: 'latest', decision_status: 'partial', submitted_at: '2026-06-02T00:00:00Z' }),
      submission({
        id: 'other-month',
        target_month: '2026-08-01',
        submitted_at: '2026-06-03T00:00:00Z',
      }),
      submission({
        id: 'superseded',
        decision_status: 'superseded',
        submitted_at: '2026-06-04T00:00:00Z',
      }),
    ];

    expect([...latestAcceptedSubmissionIds(submissions)].sort()).toEqual(['latest', 'other-month']);
  });

  it('drops old accepted rows when a newer submission needs review', () => {
    const rows = [
      { submission_id: 'old', hours: 40 },
      { submission_id: 'review', hours: 60 },
    ];
    const submissions = [
      submission({ id: 'old', decision_status: 'accepted', submitted_at: '2026-06-01T00:00:00Z' }),
      submission({ id: 'review', decision_status: 'needs_review', submitted_at: '2026-06-02T00:00:00Z' }),
    ];

    expect(filterRowsToLatestAcceptedSubmissions(rows, submissions)).toEqual([]);
  });

  it('keeps already-published rows even after a newer submission needs review', () => {
    const rows = [
      { submission_id: 'old', hours: 40, publish_status: 'published_to_homebase' },
      { submission_id: 'review', hours: 60, publish_status: 'pending' },
    ];
    const submissions = [
      submission({ id: 'old', decision_status: 'superseded', submitted_at: '2026-06-01T00:00:00Z' }),
      submission({ id: 'review', decision_status: 'needs_review', submitted_at: '2026-06-02T00:00:00Z' }),
    ];

    expect(filterRowsToLatestAcceptedSubmissions(rows, submissions)).toEqual([
      { submission_id: 'old', hours: 40, publish_status: 'published_to_homebase' },
    ]);
  });

  it('filters generated rows to the current accepted submission id', () => {
    const rows = [
      { submission_id: 'old', hours: 40 },
      { submission_id: 'latest', hours: 25 },
      { submission_id: 'unknown', hours: 999 },
    ];
    const submissions = [
      submission({ id: 'old', submitted_at: '2026-06-01T00:00:00Z' }),
      submission({ id: 'latest', submitted_at: '2026-06-02T00:00:00Z' }),
    ];

    expect(filterRowsToLatestAcceptedSubmissions(rows, submissions)).toEqual([
      { submission_id: 'latest', hours: 25 },
    ]);
  });

  it('can keep latest declined rows for cut/audit views', () => {
    const rows = [
      { submission_id: 'old', hours: 40 },
      { submission_id: 'declined', hours: 25 },
    ];
    const submissions = [
      submission({ id: 'old', decision_status: 'accepted', submitted_at: '2026-06-01T00:00:00Z' }),
      submission({ id: 'declined', decision_status: 'declined', submitted_at: '2026-06-02T00:00:00Z' }),
    ];

    expect(filterRowsToLatestSubmissions(rows, submissions)).toEqual([
      { submission_id: 'declined', hours: 25 },
    ]);
    expect(filterRowsToLatestAcceptedSubmissions(rows, submissions)).toEqual([]);
  });

  it('dedupes exact shift recommendation intervals', () => {
    const rows = [
      {
        id: 'pending-copy',
        submission_id: 'latest',
        shift_date: '2026-07-01',
        start_min: 540,
        end_min: 870,
        shift_type: 'virtual_recurring',
        publish_status: 'pending',
        hours: 5.5,
      },
      {
        id: 'confirmed-copy',
        submission_id: 'latest',
        shift_date: '2026-07-01',
        start_min: 540,
        end_min: 870,
        shift_type: 'virtual_recurring',
        publish_status: 'confirmed',
        hours: 5.5,
      },
      {
        id: 'split-piece',
        submission_id: 'latest',
        shift_date: '2026-07-01',
        start_min: 870,
        end_min: 1020,
        shift_type: 'virtual_recurring',
        publish_status: 'pending',
        hours: 2.5,
      },
    ];

    expect(dedupeShiftRecommendationRows(rows).map(row => row.id)).toEqual([
      'confirmed-copy',
      'split-piece',
    ]);
  });
});
