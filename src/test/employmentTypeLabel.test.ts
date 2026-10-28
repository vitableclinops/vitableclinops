import { describe, expect, it } from 'vitest';
import { employmentTypeBadgeLabel } from '@/lib/employmentTypeLabel';

describe('W2 label override for Genevieve, Shanta, and Rebecca', () => {
  it('shows W2 for the three overridden providers', () => {
    expect(employmentTypeBadgeLabel({ email: 'genevieve.teetie@vitablehealth.com', employment_type: 'w2' })).toBe('W2');
    expect(employmentTypeBadgeLabel({ email: 'shanta.w@vitablehealth.com', employment_type: 'w2' })).toBe('W2');
    expect(employmentTypeBadgeLabel({ email: 'rebecca.keuch@vitablehealth.com', employment_type: 'w2' })).toBe('W2');
  });

  it('keeps other w2 providers as Internal and leaves other types untouched', () => {
    expect(employmentTypeBadgeLabel({ email: 'someone@vitablehealth.com', employment_type: 'w2' })).toBeNull();
    expect(employmentTypeBadgeLabel({ email: 'genevieve.teetie@vitablehealth.com', employment_type: '1099' })).toBeNull();
    expect(employmentTypeBadgeLabel({ email: 'shanta.w@vitablehealth.com', employment_type: 'agency' })).toBeNull();
  });
});
