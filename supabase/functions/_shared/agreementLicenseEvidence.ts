export interface AgreementLicenseEvidence {
  status: string | null;
  expiration_date: string | null;
}

// Missing/pending records are not proof that an externally held license is invalid.
export function agreementLicenseEvidence(records: AgreementLicenseEvidence[], today: string): 'valid' | 'invalid' | 'unknown' {
  if (records.some(l => ['active', 'verified'].includes(l.status ?? '') && (!l.expiration_date || l.expiration_date >= today))) return 'valid';
  if (!records.length) return 'unknown';
  const knownInvalid = (l: AgreementLicenseEvidence) =>
    Boolean(l.expiration_date && l.expiration_date < today) || ['expired', 'invalid', 'revoked', 'suspended', 'inactive'].includes(l.status ?? '');
  return records.every(knownInvalid) ? 'invalid' : 'unknown';
}