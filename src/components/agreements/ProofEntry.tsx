import { Link2, Paperclip, ShieldCheck } from 'lucide-react';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';

export interface ProofEntryData {
  verified_on?: string | null;
  verified_source?: string | null;
  verified_link?: string | null;
  verified_attachment_path?: string | null;
  verified_attachment_name?: string | null;
}

/** One shared layout for saved proof of verification on every page. */
export function ProofEntry({ label, proof, status, compact = false }: { label: string; proof: ProofEntryData; status?: string; compact?: boolean }) {
  return <div className={`min-w-0 ${compact ? 'text-xs' : 'text-sm'} space-y-0.5`}>
    <p className="flex flex-wrap items-center gap-x-1.5 font-medium text-foreground">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />{label}
      {status && <span className="font-normal text-muted-foreground">· {status}</span>}
      {proof.verified_on && <span className="font-normal text-muted-foreground">· Verified {proof.verified_on}</span>}
    </p>
    {proof.verified_source && <p className="pl-5 text-muted-foreground break-words">Source: {proof.verified_source}</p>}
    {(proof.verified_attachment_path || proof.verified_link) && <p className="pl-5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {proof.verified_attachment_path && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" /><EvidenceLink reference={proof.verified_attachment_path}>{proof.verified_attachment_name || 'Uploaded file'}</EvidenceLink></span>}
      {proof.verified_link && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3 shrink-0 text-muted-foreground" /><EvidenceLink reference={proof.verified_link}>Verification link</EvidenceLink></span>}
    </p>}
  </div>;
}

export const DECISION_PROOF_LABELS: Record<string, string> = {
  ncbon_registered: 'NCBON registration',
  independent_verified: 'Independent practice',
  rx_authority_verified: 'Prescriptive authority',
};
