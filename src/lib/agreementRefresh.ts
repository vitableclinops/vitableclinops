import type { QueryClient } from '@tanstack/react-query';

// All agreement-derived queries share the same refresh boundary after a save.
export const AGREEMENT_REFRESH_OPTIONS = {
  refetchOnWindowFocus: true,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
} as const;

export async function refreshAgreementViews(queryClient: QueryClient) {
  await Promise.all([
    ['agreements'],
    ['directory-collaboration'],
    ['local-supervision-agreements'],
    ['provider-agreements-count'],
    ['provider-missing-doc-agreements'],
    ['independent-verifications'],
    ['provider-missing-requirements'],
    ['provider-readiness'],
    ['pcp-coverage-by-id'],
    ['medallion_directory'],
    ['provider_directory_state_map'],
  ].map(queryKey => queryClient.invalidateQueries({ queryKey })));
}