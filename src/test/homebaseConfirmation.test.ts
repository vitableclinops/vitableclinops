import { describe, expect, it } from 'vitest';
import { attachHomebaseConfirmations } from '@/lib/scheduling/homebaseConfirmation';

const employee = { id: 'hb-employee-1', profile_id: 'provider-1' };

const publishRow = {
  id: 'rec-1',
  provider_id: 'provider-1',
  recommendation: 'publish',
  shift_date: '2026-06-10',
  start_min: 9 * 60,
  end_min: 17 * 60,
};

describe('attachHomebaseConfirmations', () => {
  it('marks an exact published Homebase match as published', () => {
    const [row] = attachHomebaseConfirmations(
      [publishRow],
      [{
        homebase_id: 123,
        homebase_employee_id: employee.id,
        published: true,
        scheduled: true,
        start_at: '2026-06-10T13:00:00.000Z',
        end_at: '2026-06-10T21:00:00.000Z',
        synced_at: '2026-06-08T12:00:00.000Z',
      }],
      [employee],
    );

    expect(row.homebase_confirmation).toMatchObject({
      status: 'published',
      homebase_shift_id: '123',
      published: true,
      scheduled: true,
    });
  });

  it('distinguishes a matching unpublished Homebase shift', () => {
    const [row] = attachHomebaseConfirmations(
      [publishRow],
      [{
        homebase_id: 124,
        homebase_employee_id: employee.id,
        published: false,
        scheduled: true,
        start_at: '2026-06-10T13:00:00.000Z',
        end_at: '2026-06-10T21:00:00.000Z',
        synced_at: '2026-06-08T12:00:00.000Z',
      }],
      [employee],
    );

    expect(row.homebase_confirmation.status).toBe('unpublished');
  });

  it('matches within a small time tolerance', () => {
    const [row] = attachHomebaseConfirmations(
      [publishRow],
      [{
        homebase_id: 125,
        homebase_employee_id: employee.id,
        published: true,
        scheduled: true,
        start_at: '2026-06-10T13:05:00.000Z',
        end_at: '2026-06-10T21:05:00.000Z',
        synced_at: '2026-06-08T12:00:00.000Z',
      }],
      [employee],
    );

    expect(row.homebase_confirmation.status).toBe('published');
  });

  it('does not ask Homebase to confirm cut rows', () => {
    const [row] = attachHomebaseConfirmations(
      [{ ...publishRow, id: 'rec-2', recommendation: 'cut' }],
      [],
      [],
    );

    expect(row.homebase_confirmation.status).toBe('not_applicable');
  });
});
