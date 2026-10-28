import type { PcpCell } from '@/lib/pcpCoverage';

export function directoryIdentityAlert(cell: PcpCell) {
  if (cell.kind !== 'needs_review') return undefined;
  let howToFix = 'Verify the provider’s 10-digit NPI in the profile’s Professional tab and the EHR. Correct the inaccurate source; never link records by name alone.';
  if (cell.detail.startsWith('No NPI on this record')) {
    howToFix = 'Open the profile, click Edit, and enter the provider’s verified 10-digit NPI in Professional. Do not guess it from a name. Coverage is rechecked after the next successful refresh.';
  } else if (cell.detail === 'NPI belongs to more than one directory record') {
    howToFix = 'Verify which directory record belongs to this provider. Correct an inaccurate NPI or ask an admin to consolidate a confirmed duplicate while preserving its licenses and agreements. Do not delete records just to clear the flag.';
  } else if (cell.detail === 'Several EHR IDs share this directory record') {
    howToFix = 'Ask the EHR administrator to review the multiple EHR provider records and their NPIs. Correct or consolidate confirmed duplicates in the EHR; do not assign coverage until identity is verified.';
  } else if (cell.detail.includes('name review needed')) {
    howToFix = 'The NPI already matches and coverage is retained. Verify the legal name in the profile and EHR, then correct the inaccurate source. Keep a nickname in Preferred Name; do not change a verified NPI to match a name.';
  }
  return { reason: cell.detail, howToFix };
}