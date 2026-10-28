import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import type { CoverageAlertSummary } from '@/lib/coverageAlertSummary';
import type { FlaggedProvider } from '@/lib/providerFlagSummary';
export type { FlaggedProvider } from '@/lib/providerFlagSummary';

function correction(field: string) {
  switch (field) {
    case 'employment_status':
      return 'Confirm whether this provider is currently working with Vitable. If the directory is wrong, open the profile, click Edit, and correct Status in Employment. If Medallion is wrong, correct it there. Do not reactivate a terminated provider just to match Medallion.';
    case 'employment_type':
      return 'Confirm the provider’s employment classification. Our W2, 1099, or agency classification is kept; Medallion may use a different label. If ours is wrong, open the profile, click Edit, and correct Employment Type in Employment. Otherwise confirm the difference with your team.';
    case 'npi':
      return 'Verify the provider’s 10-digit NPI before changing anything. Correct the inaccurate record in the profile’s Professional tab or in Medallion; do not link different people based on their names.';
    case 'name':
      return 'Verify the legal name in both records. Correct the inaccurate legal name in the profile or Medallion. Keep a nickname in Preferred Name rather than replacing the legal name.';
    case 'email':
      return 'Confirm the provider’s current email address. Correct the inaccurate email in the profile’s Professional tab or in Medallion.';
    case 'specialty':
      return 'Confirm the provider’s clinical specialty and correct the inaccurate specialty in the profile or Medallion. Medallion taxonomy is not a substitute for specialty.';
    default:
      return 'Compare both records with the provider’s verified information, then correct the inaccurate record in the profile or Medallion.';
  }
}

const labels: Record<string, string> = {
  employment_status: 'Employment status', employment_type: 'Employment type',
  npi: 'NPI', name: 'Legal name', email: 'Email', specialty: 'Specialty',
};

export function ProviderFlagAlerts({
  providers,
  coverage,
  onReview,
  onFindProfile,
}: {
  providers: FlaggedProvider[];
  coverage?: CoverageAlertSummary | null;
  onReview: (id: string) => void;
  onFindProfile: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flagCount = providers.length;
  if (!flagCount && !coverage) return null;
  const coverageIssues = !!coverage && (coverage.status !== 'ok' || !!coverage.failure || coverage.review.length > 0);
  const warning = flagCount > 0 || coverageIssues;

  return (
    <Alert className={`mb-6 ${warning ? 'border-warning/40 bg-warning/10' : 'border-border bg-muted/30'}`}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center justify-between gap-2 leading-normal">
        <span>
          {flagCount
            ? `Provider flagged · ${flagCount} provider${flagCount === 1 ? ' needs' : 's need'} review`
            : 'No provider flags'}
          {coverage ? ` · ${coverage.label}` : ''}
        </span>
        <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls="provider-flag-details" onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Hide details' : 'Review flags'}
          {expanded ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
        </Button>
      </AlertTitle>
      <AlertDescription>
        {flagCount > 0 && (
          <p className="break-words">{providers.map(p => `${p.name}: ${[...(p.identityReview || p.sourceIdentityReviews?.length ? ['Identity needs review'] : []), ...p.conflicts.map(c => labels[c.field] ?? c.field.replace(/_/g, ' '))].join(', ')}`).join(' · ')}</p>
        )}
        {coverage && <p className="mt-1 break-words text-muted-foreground">{coverage.summary}</p>}
        {coverage?.failure && <p className="mt-1 break-words text-destructive">{coverage.failure}</p>}
        {expanded && (
          <div id="provider-flag-details" className="mt-3 max-h-80 overflow-y-auto divide-y divide-border">
            {providers.map(provider => (
              <section key={provider.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{provider.name}</h3>
                  <Button size="sm" variant="outline" onClick={() => { if (provider.profileId) onReview(provider.profileId); else onFindProfile(); }}>
                    {provider.profileId ? 'Open profile' : 'Find provider profile'}<ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
                {provider.identityReview && (
                  <div className="mt-2 space-y-1">
                    <p><strong>Identity needs review:</strong> {provider.identityReview.reason}</p>
                    <p className="text-muted-foreground"><strong>How to fix:</strong> {provider.identityReview.howToFix} <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { if (provider.profileId) onReview(provider.profileId); else onFindProfile(); }}>Correct profile</Button></p>
                  </div>
                )}
                {provider.sourceIdentityReviews?.map((review, index) => (
                  <div key={index} className="mt-2 space-y-1">
                    <p><strong>Identity needs review:</strong> {review.reason}</p>
                    <p className="text-muted-foreground"><strong>How to fix:</strong> {review.howToFix} <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { if (provider.profileId) onReview(provider.profileId); else onFindProfile(); }}>{provider.profileId ? 'Correct profile' : 'Find provider profile'}</Button></p>
                  </div>
                ))}
                {provider.conflicts.map((conflict, index) => (
                  <div key={`${conflict.field}-${index}`} className="mt-2 space-y-1">
                    <p><strong>{labels[conflict.field] ?? conflict.field.replace(/_/g, ' ')}</strong>: Directory says “{conflict.local ?? 'Not supplied'}”; Medallion says “{conflict.medallion ?? 'Not supplied'}”.</p>
                    <p className="text-muted-foreground"><strong>How to fix:</strong> {correction(conflict.field)} <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { if (provider.profileId) onReview(provider.profileId); else onFindProfile(); }}>Correct profile</Button></p>
                  </div>
                ))}
              </section>
            ))}
            {coverage && (
              <section className="py-3">
                <h3 className="font-semibold">Active states in EHR — data freshness</h3>
                <p className="mt-1 break-words">{coverage.summary}</p>
                {coverage.failure && <p className="mt-1 break-words text-destructive">{coverage.failure}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Source: Metabase (current records returned by our read-only query, explicit exclusions applied).
                  Warehouse refresh time: not verified. The source’s is_active flag meaning is pending data-owner confirmation.
                </p>
              </section>
            )}
            <p className="pt-3 text-xs text-muted-foreground">Medallion differences are rechecked after the next successful directory sync.</p>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
