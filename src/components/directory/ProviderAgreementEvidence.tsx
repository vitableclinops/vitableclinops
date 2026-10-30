import { useProviderAgreementEvidence } from '@/hooks/useProviderAgreementEvidence';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';

export function ProviderAgreementEvidence({ profileId }: { profileId: string }) {
  const { data = [], isLoading, error } = useProviderAgreementEvidence(profileId);
  return <section className="space-y-3">
    <h3 className="text-sm font-medium">Collaborative agreement documents</h3>
    {isLoading ? <p className="text-sm text-muted-foreground">Loading documents…</p> : error ? <p className="text-sm text-destructive">Could not load agreement documents.</p> : !data.length ? <p className="text-sm text-muted-foreground">No saved agreement documents.</p> : data.map(d => <div key={d.id}><EvidenceLink reference={d.reference}>{d.label}</EvidenceLink></div>)}
  </section>;
}