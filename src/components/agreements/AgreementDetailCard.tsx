import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { 
  Calendar, 
  FileText, 
  MapPin, 
  Users, 
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { WorkflowStatusTracker } from './WorkflowStatusTracker';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Agreement = Tables<'collaborative_agreements'>;
type AgreementProvider = Tables<'agreement_providers'>;

interface AgreementDetailCardProps {
  agreementId: string;
  onTerminate?: () => void;
  onRenew?: () => void;
}

export function AgreementDetailCard({ 
  agreementId, 
  onTerminate, 
  onRenew 
}: AgreementDetailCardProps) {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [providers, setProviders] = useState<AgreementProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchAgreement = async () => {
      setLoading(true);
      
      const [agreementResult, providersResult] = await Promise.all([
        supabase
          .from('collaborative_agreements')
          .select('*')
          .eq('id', agreementId)
          .maybeSingle(),
        supabase
          .from('agreement_providers')
          .select('*')
          .eq('agreement_id', agreementId)
          .eq('is_active', true)
      ]);

      if (agreementResult.data) {
        setAgreement(agreementResult.data);
      }
      if (providersResult.data) {
        setProviders(providersResult.data);
      }
      
      setLoading(false);
    };

    fetchAgreement();
  }, [agreementId]);

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-6 bg-muted rounded w-1/3" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!agreement) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Agreement not found
        </CardContent>
      </Card>
    );
  }

  const providerSignatures = providers.map(p => ({
    name: p.provider_name,
    signed: p.signature_status === 'signed',
  }));

  const isPendingRenewal = agreement.workflow_status === 'pending_renewal';
  const canTerminate = !['terminated', 'termination_initiated'].includes(agreement.workflow_status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">
                {agreement.state_abbreviation}
              </span>
            </div>
            <div>
              <CardTitle className="text-lg">
                {agreement.state_name} Agreement
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Dr. {agreement.physician_name}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {isPendingRenewal && onRenew && (
              <Button size="sm" onClick={onRenew}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Renew
              </Button>
            )}
            {canTerminate && onTerminate && (
              <Button size="sm" variant="outline" onClick={onTerminate}>
                Terminate
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Compact workflow tracker */}
        <WorkflowStatusTracker
          status={agreement.workflow_status}
          physicianName={agreement.physician_name}
          providerCount={providers.length}
          physicianSigned={!!agreement.physician_signed_at}
          providerSignatures={providerSignatures}
          compact
        />

        {/* Key details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {agreement.start_date 
                ? format(new Date(agreement.start_date), 'MMM d, yyyy')
                : 'Not started'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{agreement.meeting_cadence || 'Monthly'} meetings</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4" />
            <span>{agreement.renewal_cadence || 'Annual'} renewal</span>
          </div>
        </div>

        {/* Expandable details */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full">
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide Details
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show Details
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4 space-y-4">
            {/* Full workflow tracker */}
            <WorkflowStatusTracker
              status={agreement.workflow_status}
              physicianName={agreement.physician_name}
              providerCount={providers.length}
              physicianSigned={!!agreement.physician_signed_at}
              providerSignatures={providerSignatures}
            />

            {/* Provider list */}
            {providers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Providers</h4>
                <div className="space-y-1">
                  {providers.map(provider => (
                    <div 
                      key={provider.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                    >
                      <div>
                        <p className="text-sm font-medium">{provider.provider_name}</p>
                        <p className="text-xs text-muted-foreground">{provider.provider_email}</p>
                      </div>
                      <Badge 
                        variant={provider.signature_status === 'signed' ? 'default' : 'secondary'}
                      >
                        {provider.signature_status === 'signed' ? 'Signed' : 'Pending'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chart review info */}
            {agreement.chart_review_required && (
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Chart Review Required</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {agreement.chart_review_frequency || '5% of charts quarterly, then annually'}
                </p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
