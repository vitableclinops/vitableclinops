import { beforeEach, describe, expect, it, vi } from 'vitest';
const { upsert, upload } = vi.hoisted(() => ({ upsert: vi.fn(), upload: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ upsert }), storage: { from: () => ({ upload }) } } }));
import { saveIndependentVerification } from '@/components/agreements/IndependentPracticeVerifyDialog';

const input = { profileId: 'nc-np', state: 'NC', source: 'NCBON', verifiedOn: '2026-11-03', decision: 'ncbon_registered' as const };
beforeEach(() => { vi.clearAllMocks(); upsert.mockResolvedValue({ error: null }); upload.mockResolvedValue({ error: null }); });
describe('NCBON verification saving', () => {
  it('rejects missing proof before saving', async () => {
    await expect(saveIndependentVerification(input)).rejects.toThrow('NC requires');
    expect(upsert).not.toHaveBeenCalled();
  });
  it('saves the NC-specific decision and proof link', async () => {
    await saveIndependentVerification({ ...input, link: 'https://portal.ncbon.com/approval' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ decision: 'ncbon_registered', state_abbreviation: 'NC', verified_source: 'NCBON', verified_on: '2026-11-03', verified_link: 'https://portal.ncbon.com/approval' }), { onConflict: 'profile_id,state_abbreviation' });
  });
  it('saves an uploaded proof path for later opening', async () => {
    await saveIndependentVerification({ ...input, file: new File(['proof'], 'approval.pdf') });
    expect(upload).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ verified_attachment_path: expect.stringContaining('independent-verification/nc-np/NC-'), verified_attachment_name: 'approval.pdf' }), expect.anything());
  });
});