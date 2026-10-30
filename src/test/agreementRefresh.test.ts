import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { refreshAgreementViews } from '@/lib/agreementRefresh';
import { physicianSlots, type SlotAgreement } from '@/lib/physicianSlots';
import { activeStateAgreementFlags, type StateAgreement } from '@/lib/activeStateAgreementFlags';
import { isDocumentExemptPhysician } from '@/lib/directShiftsPhysicians';

describe('agreement view refresh', () => {
  it.each(['uploaded agreement', 'DirectShifts supervisor'])('clears matching directory flags after saving an %s', async evidence => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const provider = { id: 'brittney', profession: 'NP' };
    const rules = ['OK', 'OH'].map(state_abbreviation => ({ state_abbreviation, ca_required: true, collab_requirement_type: 'always' }));
    const agreement: StateAgreement = { profileId: provider.id, state: 'OH', status: 'active', document: null };
    const observer = new QueryObserver(client, {
      queryKey: ['directory-collaboration', 'active-state-audit'],
      queryFn: async () => activeStateAgreementFlags(provider, ['OK', 'OH'], rules, [agreement], []),
    });
    const stop = observer.subscribe(() => {});
    try {
      await refreshAgreementViews(client);
      expect(observer.getCurrentResult().data?.map(flag => flag.state)).toEqual(['OH', 'OK']);
      if (evidence === 'uploaded agreement') agreement.document = 'https://example.org/signed-agreement.pdf';
      else agreement.documentExempt = isDocumentExemptPhysician('Dr. Anika Ramos (Direct Shifts)');
      await refreshAgreementViews(client);
      expect(observer.getCurrentResult().data?.map(flag => flag.state)).toEqual(['OK']);
    } finally {
      stop(); client.clear();
    }
  });

  it('refreshes physician counts and state overview after an agreement is added and terminated', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const agreements: SlotAgreement[] = [];
    const overview = new QueryObserver(client, { queryKey: ['agreements', 'overview'], queryFn: async () => agreements.filter(a => a.status === 'active').length });
    const slots = new QueryObserver(client, {
      queryKey: ['directory-collaboration', 'physician-slots'],
      queryFn: async () => physicianSlots(agreements,
        [{ id: 'np1', full_name: 'Kelsie', profession: 'NP', credentials: null, employment_status: 'active' }],
        [{ state_abbreviation: 'OH', np_md_ratio: '5', np_md_ratio_limit: 5 }]),
    });
    const stopOverview = overview.subscribe(() => {});
    const stopSlots = slots.subscribe(() => {});
    try {
      await refreshAgreementViews(client);
      expect(overview.getCurrentResult().data).toBe(0);
      expect(slots.getCurrentResult().data).toEqual([]);
      agreements.push({ physicianKey: 'patel', physicianName: 'Dr. Patel', state: 'OH', providerIds: ['np1'], status: 'active' });
      await refreshAgreementViews(client);
      expect(overview.getCurrentResult().data).toBe(1);
      expect(slots.getCurrentResult().data?.[0]).toMatchObject({ filled: 1, limit: 5 });
      agreements[0].status = 'terminated';
      await refreshAgreementViews(client);
      expect(overview.getCurrentResult().data).toBe(0);
      expect(slots.getCurrentResult().data).toEqual([]);
    } finally {
      stopOverview(); stopSlots(); client.clear();
    }
  });

  it('refreshes related flags and supervision without overwriting outside-practice totals', async () => {
    const client = new QueryClient();
    const keys = [['agreements', 'overview'], ['directory-collaboration', 'active-state-audit'], ['local-supervision-agreements'], ['provider-agreements-count'], ['provider-missing-doc-agreements']];
    for (const key of keys) client.setQueryData(key, 1);
    const confirmedKey = ['system-config', 'confirmed_physician_counts'];
    client.setQueryData(confirmedKey, { kate: { CA: 4 } });
    await refreshAgreementViews(client);
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(confirmedKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData(confirmedKey)).toEqual({ kate: { CA: 4 } });
    client.clear();
  });
});