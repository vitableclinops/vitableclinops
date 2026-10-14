import { Badge } from '@/components/ui/badge';
import type { PcpCoverageData } from '@/hooks/usePcpCoverage';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT' : 'not recorded';

/** Source, timestamps and identity-review summary for Active PCP Telemedicine States. */
export function PcpCoverageStatus({ data }: { data: PcpCoverageData | null }) {
  if (!data || !data.pulledAt) {
    return <p className="text-xs text-muted-foreground mb-2">Active PCP Telemedicine States: unavailable — no ID-based Metabase snapshot has been fetched yet.</p>;
  }
  const count = (s: string) => data.identities.filter((i) => i.status === s).length;
  const review = data.identities.filter((i) => i.status === 'unmatched' || i.status === 'ambiguous' || i.nameDiffers);
  const excluded = data.identities.filter((i) => i.status === 'excluded');
  const failed = data.lastAttempt && data.lastAttempt.status !== 'success' && data.lastAttempt.status !== 'running';
  return (
    <div className="text-xs text-muted-foreground mb-2 space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        {data.stale ? <Badge variant="destructive">Stale snapshot</Badge> : <Badge variant="secondary">Fetched recently</Badge>}
        <span>
          Active PCP Telemedicine States — source: Metabase (current records returned by our read-only query, explicit exclusions applied).
          Last successful fetch: {fmt(data.pulledAt)}. Latest source-record change: {fmt(data.warehouseLatestChangeAt)}.
          Warehouse refresh time: not verified.
        </span>
      </p>
      <p>
        {count('matched')} matched by NPI · {count('unmatched')} unmatched · {count('ambiguous')} ambiguous · {count('excluded')} excluded.
        Data-quality note: the meaning of the source's is_active flag is pending data-owner confirmation.
      </p>
      {failed && <p className="text-destructive">Latest refresh failed {fmt(data.lastAttempt!.at)} — showing the last successful snapshot.</p>}
      {review.length > 0 && (
        <details>
          <summary className="cursor-pointer">Identities needing review ({review.length})</summary>
          <ul className="mt-1 ml-4 list-disc">
            {review.map((i) => (
              <li key={i.ehrProviderId}>
                {i.ehrName} (NPI {i.npi ?? 'none'}) — {i.status === 'matched' ? 'linked by NPI; name differs from directory record' : i.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {excluded.length > 0 && (
        <details>
          <summary className="cursor-pointer">Explicit exclusions still present in source ({excluded.length})</summary>
          <ul className="mt-1 ml-4 list-disc">
            {excluded.map((i) => <li key={i.ehrProviderId}>{i.ehrName} (NPI {i.npi ?? 'none'}) — {i.reason}; source still lists {i.states.length} state(s)</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
