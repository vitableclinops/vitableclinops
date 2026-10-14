import { describe, expect, it } from 'vitest';
import { computeEntityHealth, type MedallionSyncRun } from '@/hooks/useMedallionDirectory';

const NOW = new Date('2026-10-14T18:00:00Z').getTime();
const run = (p: Partial<MedallionSyncRun>): MedallionSyncRun => ({
  id: Math.random().toString(), entity: 'providers', scope: 'full', mode: 'apply', trigger_source: 'scheduled',
  status: 'success', started_at: '2026-10-14T10:15:00Z', finished_at: '2026-10-14T10:16:00Z',
  rows_returned: 1, rows_written: 1, rows_failed: 0, error_message: null, details: {}, ...p,
});

describe('Medallion sync health', () => {
  it('flags an entity that has never refreshed as stale (job never started)', () => {
    const h = computeEntityHealth([], NOW);
    expect(h.every((e) => e.stale)).toBe(true);
  });

  it('is stale when the last success is older than 26 hours', () => {
    const h = computeEntityHealth([run({ finished_at: '2026-10-13T15:00:00Z' })], NOW);
    expect(h.find((e) => e.entity === 'providers')!.stale).toBe(true);
  });

  it('is fresh when the last success is within 26 hours', () => {
    const h = computeEntityHealth([run({})], NOW);
    expect(h.find((e) => e.entity === 'providers')!.stale).toBe(false);
  });

  it('does not count a partly failed run as a successful refresh', () => {
    const h = computeEntityHealth([run({ status: 'partial' })], NOW);
    const p = h.find((e) => e.entity === 'providers')!;
    expect(p.lastSuccess).toBeNull();
    expect(p.stale).toBe(true);
  });

  it('ignores practice runs and single-provider refreshes for directory freshness', () => {
    const h = computeEntityHealth([run({ mode: 'dry_run' }), run({ scope: 'provider' })], NOW);
    expect(h.find((e) => e.entity === 'providers')!.stale).toBe(true);
  });
});
