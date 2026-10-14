import { Badge } from '@/components/ui/badge';
import type { PcpCoverageData } from '@/hooks/usePcpCoverage';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT' : '—';

/** Freshness + identity-match summary for the Active PCP Telemedicine States column. */
export function PcpCoverageStatus({ data }: { data: PcpCoverageData | null }) {
  if (!data || !data.pulledAt) {
    return <p className="text-xs text-muted-foreground mb-2">Active PCP Telemedicine States: no ID-based snapshot yet — column left blank rather than guessed.</p>;
  }
  const count = (s: string) => data.identities.filter((i) => i.status === s).length;
  const review = data.identities.filter((i) => i.status === 'unmatched' || i.status === 'ambiguous' || i.nameDiffers);
  const failed = data.lastAttempt && data.lastAttempt.status !== 'success' && data.lastAttempt.status !== 'running';
  return (
    <div className="text-xs text-muted-foreground mb-2 space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        {data.stale
          ? <Badge variant="destructive">Stale — historical snapshot</Badge>
          : <Badge variant="secondary">Current</Badge>}
        <span>Active PCP Telemedicine States (EHR, separate from Medallion licenses and EHR activation). Fetched {fmt(data.pulledAt)}; warehouse last change {fmt(data.warehouseLatestChangeAt)}.</span>
        <span>{count('matched')} matched by NPI · {count('unmatched')} unmatched · {count('ambiguous')} ambiguous · {count('excluded')} excluded.</span>
      </p>
      {failed && (
        <p className="text-destructive">Latest refresh failed {fmt(data.lastAttempt!.at)} — showing the last successful snapshot.</p>
      )}
      {review.length > 0 && (
        <details>
          <summary className="cursor-pointer">Identities needing review ({review.length})</summary>
          <ul className="mt-1 ml-4 list-disc">
            {review.map((i) => (
              <li key={i.ehrProviderId}>
                {i.ehrName} (NPI {i.npi ?? 'none'}) — {i.nameDiffers && i.status === 'matched' ? 'matched by NPI, name differs in directory' : i.reason}; {i.states.length} states
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
