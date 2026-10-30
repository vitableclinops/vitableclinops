import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => {
    const agreement = { id: 'a', provider_id: 'provider', physician_name: 'Supervisor', state_abbreviation: 'OK', agreement_document_url: null, medallion_document_url: null };
    const rows: Record<string, Record<string, unknown>[]> = {
      collaborative_agreements: [agreement],
      agreement_providers: [{ provider_id: 'provider', medallion_document_url: 'https://example.org/proof', collaborative_agreements: agreement }],
      agreement_tasks: [{ id: 'task', agreement_id: 'a' }],
      task_documents: [
        { id: 'screenshot', agreement_id: 'a', task_id: 'task', file_name: 'Screenshot.png', file_path: 'a/task/screenshot.png' },
        { id: 'legacy', agreement_id: null, task_id: 'task', file_name: 'Email.png', file_path: 'unlinked/task/email.png' },
        { id: 'other', agreement_id: 'other', task_id: 'other-task', file_name: 'Other.png', file_path: 'other/proof.png' },
      ],
    };
    let data = rows[table] ?? [];
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { data = data.filter(row => row[key] === value); return chain; },
      in: (key: string, values: unknown[]) => { data = data.filter(row => values.includes(row[key])); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
    };
    return chain;
  } },
}));
import { useProviderAgreementEvidence } from '@/hooks/useProviderAgreementEvidence';

describe('saved provider agreement evidence', () => {
  it('retains participant links and screenshots without duplicates or another provider’s proof', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useProviderAgreementEvidence('provider'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(d => d.reference)).toEqual(['https://example.org/proof', 'a/task/screenshot.png', 'unlinked/task/email.png']);
    unmount(); client.clear();
  });
});