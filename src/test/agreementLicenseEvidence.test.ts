import { describe, expect, it } from 'vitest';
import { agreementLicenseEvidence } from '../../supabase/functions/_shared/agreementLicenseEvidence';

describe('agreement license evidence', () => {
  const today = '2026-10-29';
  it('does not invalidate Genevieve FL when neither source contains a license', () => {
    expect(agreementLicenseEvidence([], today)).toBe('unknown');
  });
  it('does not invalidate incomplete manually added licenses absent from Medallion', () => {
    expect(agreementLicenseEvidence([{ status: 'pending_verification', expiration_date: null }], today)).toBe('unknown');
  });
  it('keeps genuine recorded expired licenses invalid', () => {
    expect(agreementLicenseEvidence([{ status: 'active', expiration_date: '2026-04-30' }, { status: 'inactive', expiration_date: '2026-04-30' }], today)).toBe('invalid');
  });
  it('accepts a renewed Medallion license despite an expired local record', () => {
    expect(agreementLicenseEvidence([{ status: 'active', expiration_date: '2026-05-31' }, { status: 'active', expiration_date: '2028-05-31' }], today)).toBe('valid');
  });
  it('retains explicit revocation evidence', () => {
    expect(agreementLicenseEvidence([{ status: 'revoked', expiration_date: null }], today)).toBe('invalid');
  });
});