import { describe, it, expect } from 'vitest';
import { agreementDocumentEvidence } from '@/lib/agreementDocumentEvidence';
describe('existing agreement uploads', () => {
  it('recognizes an uploaded task document linked directly to the agreement', () => {
    expect(agreementDocumentEvidence('a', 'p', null, [], [{ agreement_id: 'a', task_id: null, file_path: 'existing.pdf' }], [])).toBe('existing.pdf');
  });
  it('recognizes a document linked through its saved task', () => {
    expect(agreementDocumentEvidence('a', 'p', null, [], [{ agreement_id: null, task_id: 't', file_path: 'task.pdf' }], [{ id: 't', agreement_id: 'a' }])).toBe('task.pdf');
  });
  it('recognizes the active participant’s uploaded agreement', () => {
    expect(agreementDocumentEvidence('a', 'p', null, [{ agreement_id: 'a', provider_id: 'p', is_active: true, medallion_document_url: 'participant.pdf' }], [], [])).toBe('participant.pdf');
  });
  it('never borrows another agreement or provider’s document', () => {
    expect(agreementDocumentEvidence('a', 'p', null, [{ agreement_id: 'a', provider_id: 'other', is_active: true, medallion_document_url: 'other.pdf' }], [{ agreement_id: 'other', task_id: null, file_path: 'other.pdf' }], [])).toBeNull();
  });
});