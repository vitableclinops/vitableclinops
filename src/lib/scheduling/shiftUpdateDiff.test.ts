import { describe, it, expect } from 'vitest';
import { diffProviderShifts } from './shiftUpdateDiff';

const ex = (id: string, d: string, s: number, e: number) => ({ id, shift_date: d, start_min: s, end_min: e, hours: (e - s) / 60 });

describe('diffProviderShifts', () => {
  it('never touches today or earlier', () => {
    const r = diffProviderShifts([ex('a', '2026-11-04', 540, 720)], [], '2026-11-04');
    expect(r.remove).toHaveLength(0);
  });
  it('keeps matching shifts, removes others, adds new ones', () => {
    const r = diffProviderShifts(
      [ex('a', '2026-11-11', 540, 720), ex('b', '2026-11-11', 540, 1140), ex('c', '2026-11-09', 540, 1260)],
      [{ date: '2026-11-11', start_min: 540, end_min: 720 }, { date: '2026-11-24', start_min: 540, end_min: 1260 }],
      '2026-11-04',
    );
    expect(r.keep.map((x) => x.id)).toEqual(['a']);
    expect(r.remove.map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(r.add).toEqual([{ date: '2026-11-24', start_min: 540, end_min: 1260 }]);
  });
});
