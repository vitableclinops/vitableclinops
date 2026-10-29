import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const fixtures = vi.hoisted(() => ({ profession: 'DO' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const provider = { id: 'doctor', full_name: 'Doctor', profession: fixtures.profession, credentials: fixtures.profession, email: 'doctor@example.test' };
      const license = { profile_id: 'doctor', state_abbreviation: 'OH', status: 'active', expiration_date: null, requires_collab_agreement: true };
      const rule = { state_abbreviation: 'OH', ca_required: true, collab_requirement_type: 'always' };
      const rows: Record<string, unknown[]> = {
        profiles: [provider], provider_licenses: [license], state_compliance_requirements: [rule],
        provider_state_status: [{ provider_id: 'doctor', state_abbreviation: 'OH', ehr_activation_status: 'active' }],
      };
      const data = rows[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or', 'gte', 'order', 'limit']) chain[method] = () => chain;
      chain.single = chain.maybeSingle = async () => ({ data: data[0] ?? null, error: null });
      chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
      return chain;
    },
  },
}));

import { useProviderReadiness } from '@/hooks/useProviderReadiness';
import { evaluateReadiness } from '@/hooks/useProviderStateStatus';

describe('Independent physician agreement readiness', () => {
  it.each(['MD', 'DO'])('%s has no agreement, signature, meeting or supervision-chart blockers', async profession => {
    fixtures.profession = profession;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useProviderReadiness(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const readiness = result.current.data?.[0];
    expect(readiness?.overall_status).toBe('ready');
    expect(readiness?.blocker_reasons).toEqual([]);
    expect(readiness?.states[0].collab_required).toBe(false);
    expect(readiness?.next_action?.type).toBe('mark_ready');
    expect(await evaluateReadiness('doctor', 'OH')).toEqual({ status: 'ready', reason: null, mismatchType: 'none' });
    unmount();
    client.clear();
  });
  it('continues to block an NP missing an Ohio agreement', async () => {
    fixtures.profession = 'NP';
    expect(await evaluateReadiness('doctor', 'OH')).toEqual({ status: 'not_ready', reason: 'Missing collaborative agreement', mismatchType: 'none' });
  });
});