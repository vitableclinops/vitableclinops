import { describe, expect, it } from 'vitest';
import { directoryDisplayName } from '@/lib/directoryDisplayName';

describe('Amanda Clement directory identity', () => {
  it('includes Mandy while retaining the legal name', () => {
    const provider = { id: 'c69f6935-34eb-4ba2-b4c0-794d95370027', full_name: 'Amanda Clement', preferred_name: 'Mandy' };
    expect(directoryDisplayName(provider)).toBe('Amanda (Mandy) Clement');
    expect(provider.full_name).toBe('Amanda Clement');
  });
});