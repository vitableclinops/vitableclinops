import { describe, expect, it } from 'vitest';
import { agreementMissingDocument } from '@/lib/agreementDocumentRequired';

describe('DirectShifts agreement upload exemptions', () => {
  it.each(['Dr. Anika Ramos (Direct Shifts)', 'Dr. Dave Webster (Direct Shifts)', 'Dr. Annie Casta (Direct Shifts)', 'Dr. Another Supervisor (DirectShifts)'])('%s never creates a missing-upload flag', physician_name => {
    expect(agreementMissingDocument({ physician_name: 'Kate Baron', workflow_status: 'active' })).toBe(true);
    expect(agreementMissingDocument({ physician_name, workflow_status: 'active' })).toBe(false);
  });
  it('recognizes saved participant evidence', () => {
    expect(agreementMissingDocument({ physician_name: 'Kate Baron', workflow_status: 'active' }, 'signed.pdf')).toBe(false);
    expect(agreementMissingDocument({ physician_name: 'Kate Baron', workflow_status: 'active' })).toBe(true);
  });
});