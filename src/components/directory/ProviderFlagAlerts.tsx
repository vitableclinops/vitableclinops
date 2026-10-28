import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';

interface Conflict { field: string; local: string | null; medallion: string | null }
export interface FlaggedProvider { id: string; name: string; conflicts: Conflict[]; identityReview?: { reason: string; howToFix: string } }

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

export function ProviderFlagAlerts({ providers, onReview }: { providers: FlaggedProvider[]; onReview: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (providers.length === 0) return null;
  return (
    <Alert className="mb-6 border-warning/40 bg-warning/10">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center justify-between gap-2 leading-normal">
        <span>Provider flagged · {providers.length} provider{providers.length === 1 ? '' : 's'} need review</span>
        <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls="provider-flag-details" onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Hide details' : 'Review flags'}
          {expanded ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
        </Button>
      </AlertTitle>
      <AlertDescription>
        <p className="break-words">{providers.map(p => `${p.name}: ${[...(p.identityReview ? ['Identity needs review'] : []), ...p.conflicts.map(c => labels[c.field] ?? c.field.replace(/_/g, ' '))].join(', ')}`).join(' · ')}</p>
        {expanded && (
          <div id="provider-flag-details" className="mt-3 max-h-80 overflow-y-auto divide-y divide-border">
            {providers.map(provider => (
              <section key={provider.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{provider.name}</h3>
                  <Button size="sm" variant="outline" onClick={() => onReview(provider.id)}>
                    Open profile<ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
                {provider.identityReview && (
                  <div className="mt-2 space-y-1">
                    <p><strong>Identity needs review:</strong> {provider.identityReview.reason}</p>
                    <p className="text-muted-foreground"><strong>How to fix:</strong> {provider.identityReview.howToFix}</p>
                  </div>
                )}
                {provider.conflicts.map((conflict, index) => (
                  <div key={`${conflict.field}-${index}`} className="mt-2 space-y-1">
                    <p><strong>{labels[conflict.field] ?? conflict.field.replace(/_/g, ' ')}</strong>: Directory says “{conflict.local ?? 'Not supplied'}”; Medallion says “{conflict.medallion ?? 'Not supplied'}”.</p>
                    <p className="text-muted-foreground"><strong>How to fix:</strong> {correction(conflict.field)}</p>
                  </div>
                ))}
              </section>
            ))}
            <p className="pt-3 text-xs text-muted-foreground">Medallion differences are rechecked after the next successful directory sync.</p>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}