import { describe, expect, it } from 'vitest';
import { derivePublishDisplayValues } from '@/lib/scheduling/publishDisplay';

describe('derivePublishDisplayValues', () => {
  it('shows fully locked rows as published even when the latest submission is declined with 0 accepted hours', () => {
    const display = derivePublishDisplayValues({
      decisionStatus: 'declined',
      acceptedHours: 0,
      shifts: [
        { hours: 8, publish_status: 'published_to_homebase' },
        { hours: 6, publish_status: 'confirmed' },
      ],
    });

    expect(display).toMatchObject({
      publishedHours: 14,
      openAcceptedHours: 0,
      displayAcceptedHours: 14,
      publishedShiftCount: 2,
      totalShiftCount: 2,
      status: 'published',
      statusLabel: 'Published',
    });
  });

  it('shows mixed locked and open rows as partial published with total accepted hours', () => {
    const display = derivePublishDisplayValues({
      decisionStatus: 'accepted',
      acceptedHours: 1.2,
      shifts: [
        { hours: 10, publish_status: 'published_to_homebase' },
        { hours: 4, publish_status: 'pending' },
      ],
    });

    expect(display).toMatchObject({
      publishedHours: 10,
      openAcceptedHours: 4,
      displayAcceptedHours: 14,
      publishedShiftCount: 1,
      totalShiftCount: 2,
      status: 'mixed_published',
      statusLabel: 'Partial · 1/2 published',
    });
  });

  it('preserves accepted status and shift-hour total for open rows with no locked shifts', () => {
    const display = derivePublishDisplayValues({
      decisionStatus: 'partial',
      acceptedHours: 2,
      shifts: [
        { hours: 3, publish_status: 'pending' },
        { hours: 4.5, publish_status: 'pending' },
      ],
    });

    expect(display).toMatchObject({
      publishedHours: 0,
      openAcceptedHours: 7.5,
      displayAcceptedHours: 7.5,
      status: 'partial',
      statusLabel: 'Partial',
    });
  });

  it('falls back to submission accepted hours and decision status when no shift rows exist', () => {
    const display = derivePublishDisplayValues({
      decisionStatus: 'accepted',
      acceptedHours: 12,
      shifts: [],
    });

    expect(display).toMatchObject({
      displayAcceptedHours: 12,
      status: 'accepted',
      statusLabel: 'Accepted',
      hasShiftRows: false,
    });
  });

  it('keeps declined providers declined when they have no publish rows', () => {
    const display = derivePublishDisplayValues({
      decisionStatus: 'declined',
      acceptedHours: 0,
      shifts: [],
    });

    expect(display).toMatchObject({
      displayAcceptedHours: 0,
      status: 'declined',
      statusLabel: 'Declined',
      hasPublishedRows: false,
    });
  });
});
