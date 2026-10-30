import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const rows: Record<string, unknown[]> = {
    collaborative_agreements: [
      { id: 'ds', provider_id: 'brittney', state_abbreviation: 'OH', physician_name: 'Dr. Anika Ramos (Direct Shifts)', workflow_status: 'active' },
      { id: 'missing', provider_id: 'jane', state_abbreviation: 'PA', physician_name: 'Kate Baron', workflow_status: 'active' },
      { id: 'uploaded', provider_id: 'jane', state_abbreviation: 'OH', physician_name: 'Kate Baron', workflow_status: 'active' },
      { id: 'invalid', provider_id: 'jane', state_abbreviation: 'TX', physician_name: 'Kate Baron', workflow_status: 'invalid' },
    ],
    agreement_providers: [], agreement_tasks: [],
    task_documents: [{ agreement_id: 'uploaded', task_id: null, file_path: 'signed.pdf' }],
    agreement_audit_log: [{ entity_id: 'invalid', changes: { reason: 'Known expired license' }, created_at: '2026-10-30' }],
  };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'range']) chain[method] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
  return chain;
} } }));
import { useDirectoryProfileWarnings } from '@/hooks/useDirectoryProfileWarnings';

describe('shared directory profile warnings', () => {
  it('exposes missing and invalid warnings together while respecting uploaded proof and DirectShifts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useDirectoryProfileWarnings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('jane')?.missing?.map(a => a.id)).toEqual(['missing']);
    expect(result.current.data?.get('jane')?.invalid.map(a => a.reason)).toEqual(['Known expired license']);
    expect(result.current.data?.get('brittney')?.missing).toEqual([]);
    unmount(); client.clear();
  });
});