import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useMedallionDirectoryData } from '@/hooks/useMedallionDirectory';

describe('Previously loaded Medallion employment alerts', () => {
  it('removes cached employment-type alerts without a refetch and preserves status alerts', () => {
    const client = new QueryClient();
    const employment = { field: 'employment_type', local: '1099', medallion: 'full_time' };
    const status = { field: 'employment_status', local: 'active', medallion: 'inactive' };
    const provider = { profile_id: 'nicole', conflicts: [employment, status] };
    client.setQueryData(['medallion_directory'], {
      providers: [provider], byProfile: new Map([['nicole', provider]]),
      licenses: [], agreements: [], runs: [],
      licensesByProfile: new Map(), agreementsByProfile: new Map(),
    });
    const { result } = renderHook(() => useMedallionDirectoryData(false), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.data?.providers[0].conflicts).toEqual([status]);
    expect(result.current.data?.byProfile.get('nicole')?.conflicts).toEqual([status]);
    client.clear();
  });
});