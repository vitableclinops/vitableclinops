import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProviderAgreementEvidence } from '@/hooks/useProviderAgreementEvidence';
import { useRequirementProofs } from '@/hooks/useRequirementProofs';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';
import { ProofEntry, DECISION_PROOF_LABELS } from '@/components/agreements/ProofEntry';
import { REQUIREMENT_LABELS } from '@/lib/stateSheetRequirements';
import { AGREEMENT_REFRESH_OPTIONS } from '@/lib/agreementRefresh';

const OTHER = 'Other';

/** Every saved file/link for a provider, grouped alphabetically by state. */
export function ProviderDocumentsByState({ profileId, chartReviewUrl }: { profileId: string; chartReviewUrl?: string | null }) {
  const evidence = useProviderAgreementEvidence(profileId);
  const proofs = useRequirementProofs(profileId);
  const decisions = useQuery({
    queryKey: ['independent-verifications', profileId],
    ...AGREEMENT_REFRESH_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase.from('provider_state_collab_decisions')
        .select('state_abbreviation, decision, verified_source, verified_on, verified_link, verified_attachment_path, verified_attachment_name')
        .eq('profile_id', profileId).in('decision', ['independent_verified', 'rx_authority_verified', 'ncbon_registered']);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (evidence.isLoading || proofs.isLoading || decisions.isLoading) return <p className="text-sm text-muted-foreground">Loading documents…</p>;
  if (evidence.error) return <p className="text-sm text-destructive">Could not load documents.</p>;

  const groups = new Map<string, React.ReactNode[]>();
  const add = (state: string | null | undefined, node: React.ReactNode) => {
    const key = (state || OTHER).toUpperCase() === 'OTHER' ? OTHER : (state as string).toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), node]);
  };
  for (const d of evidence.data ?? []) add(d.state, <div key={d.id} className="text-sm"><EvidenceLink reference={d.reference}>{d.label}</EvidenceLink></div>);
  for (const p of proofs.data ?? []) add(p.state_abbreviation, <ProofEntry key={`r:${p.state_abbreviation}:${p.requirement_key}`} label={REQUIREMENT_LABELS[p.requirement_key] ?? p.requirement_key} proof={p} />);
  for (const d of decisions.data ?? []) add(d.state_abbreviation, <ProofEntry key={`d:${d.state_abbreviation}:${d.decision}`} label={DECISION_PROOF_LABELS[d.decision] ?? 'Collab alternative'} proof={d as any} />);
  if (chartReviewUrl) add(OTHER, (
    <a key="chart" href={chartReviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
      <FileText className="h-4 w-4" /> Chart review folder <ExternalLink className="h-3 w-3" />
    </a>
  ));

  const keys = [...groups.keys()].sort((a, b) => a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b));
  if (!keys.length) return <p className="text-sm text-muted-foreground">No saved documents or links.</p>;

  return (
    <div className="space-y-3">
      {keys.map(k => (
        <section key={k} className="rounded-lg border p-3 space-y-2">
          <h4 className="text-sm font-semibold">{k === OTHER ? 'Not state-specific' : k}</h4>
          <div className="space-y-2">{groups.get(k)}</div>
        </section>
      ))}
    </div>
  );
}
