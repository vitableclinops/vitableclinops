import { describe, it, expect } from 'vitest';
import { agreementTypeLabel } from '@/hooks/useMedallionDirectory';
describe('agreementTypeLabel', () => {
  it('missing type is Unknown, not guessed', () => { expect(agreementTypeLabel(null)).toBe('Unknown'); });
  it('primary/backup kept', () => { expect(agreementTypeLabel('primary')).toBe('Primary'); expect(agreementTypeLabel('Backup')).toBe('Backup'); });
});
describe('5:15 Chicago gate', () => {
  const hr = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));
  it('summer: 10:15 UTC is 5 AM', () => { expect(hr('2026-10-14T10:15:00Z')).toBe(5); expect(hr('2026-10-14T11:15:00Z')).toBe(6); });
  it('winter: 11:15 UTC is 5 AM', () => { expect(hr('2026-11-16T11:15:00Z')).toBe(5); expect(hr('2026-11-16T10:15:00Z')).toBe(4); });
});
