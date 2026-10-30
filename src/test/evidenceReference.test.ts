import { describe, expect, it } from 'vitest';
import { evidenceReference } from '@/lib/evidenceReference';

describe('clickable saved evidence', () => {
  const origin = 'https://storage.example.org';
  it('reopens expired local storage links using their original bucket and path', () => {
    expect(evidenceReference(`${origin}/storage/v1/object/sign/task-documents/provider/proof%20image.png?token=expired`, undefined, origin)).toEqual({ bucket: 'task-documents', path: 'provider/proof image.png' });
  });
  it('keeps external document links external', () => {
    expect(evidenceReference('https://docs.google.com/document/d/proof', undefined, origin)).toEqual({ url: 'https://docs.google.com/document/d/proof' });
  });
  it('resolves raw file paths within the supplied bucket', () => {
    expect(evidenceReference('agency/proof.pdf', 'agency-documents', origin)).toEqual({ bucket: 'agency-documents', path: 'agency/proof.pdf' });
  });
  it('does not treat another host as application storage', () => {
    const url = 'https://other.example.org/storage/v1/object/sign/task-documents/file.pdf';
    expect(evidenceReference(url, undefined, origin)).toEqual({ url });
  });
  it('rejects executable links', () => {
    expect(() => evidenceReference('javascript:alert(1)', undefined, origin)).toThrow();
  });
});