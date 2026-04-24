import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { 
  MapPin, 
  UserRound, 
  Users, 
  Calendar, 
  RefreshCw, 
  ClipboardList,
  CheckCircle2,
  Mail,
  AlertTriangle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AgreementFormData } from '../AgreementWizard';

interface ReviewStepProps {
  formData: AgreementFormData;
  updateFormData?: (updates: Partial<AgreementFormData>) => void;
}

export const ReviewStep = ({ formData }: ReviewStepProps) => {
  const stateCode = formData.selectedState?.abbreviation;

  // Check whether this state has collab email requirements configured.
  // If not, the auto-send on submit will be blocked by send-collab-email.
  const { data: stateReq, isLoading: loadingStateReq } = useQuery({
    queryKey: ['wizard-collab-email-state', stateCode],
    enabled: !!stateCode,
    queryFn: async () => {
      const { data } = await supabase
        .from('collab_email_state_requirements')
        .select('state_code, state_name')
        .eq('state_code', stateCode!)
        .maybeSingle();
      return data;
    },
  });

  const willSend = !!stateReq;
  const recipients = [
    ...formData.providers.map((p) => ({ role: 'NP', name: p.name, email: p.email })),
    formData.physicianEmail
      ? { role: 'Physician', name: formData.physicianName, email: formData.physicianEmail }
      : null,
  ].filter(Boolean) as Array<{ role: string; name: string; email: string }>;

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Review the agreement details below. Once created, the agreement will be in 
          <Badge variant="default" className="mx-1">In Progress</Badge> 
          status with required tasks auto-generated.
        </p>
      </Card>

      {/* State */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="h-4 w-4 text-primary" />
          <h4 className="font-medium">State</h4>
        </div>
        <div className="pl-6">
          <p className="font-semibold">
            {formData.selectedState?.name} ({formData.selectedState?.abbreviation})
          </p>
          {formData.selectedState?.demandTag && (
            <Badge 
              variant={formData.selectedState.demandTag === 'critical' ? 'destructive' : 'secondary'} 
              className="mt-1 capitalize"
            >
              {formData.selectedState.demandTag.replace('_', ' ')}
            </Badge>
          )}
        </div>
      </Card>

      {/* Physician */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserRound className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Collaborating Physician</h4>
        </div>
        <div className="pl-6 space-y-1">
          <p className="font-semibold">{formData.physicianName}</p>
          <p className="text-sm text-muted-foreground">{formData.physicianEmail}</p>
          {formData.physicianNpi && (
            <p className="text-sm text-muted-foreground">NPI: {formData.physicianNpi}</p>
          )}
        </div>
      </Card>

      {/* Providers */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Providers ({formData.providers.length})</h4>
        </div>
        <div className="pl-6 space-y-2">
          {formData.providers.map((provider, index) => (
            <div key={index} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="font-medium text-sm">{provider.name}</span>
              <span className="text-xs text-muted-foreground">({provider.email})</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Details */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Agreement Details</h4>
        </div>
        <div className="pl-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start Date
            </p>
            <p className="font-medium text-sm">
              {formData.startDate ? format(formData.startDate, 'PPP') : 'Not set'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Renewal Cadence
            </p>
            <p className="font-medium text-sm capitalize">{formData.renewalCadence}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Supervision Cadence</p>
            <p className="font-medium text-sm capitalize">
              {formData.meetingCadence === 'as_needed' ? 'As needed' : formData.meetingCadence}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Includes chart review</p>
          </div>
          {formData.chartReviewFrequency && (
            <div>
              <p className="text-xs text-muted-foreground">Supervision Notes</p>
              <p className="font-medium text-sm">{formData.chartReviewFrequency}</p>
            </div>
          )}
        </div>
      </Card>

      {/* What happens next */}
      <Card className="p-4 border-primary/20 bg-primary/5">
        <h4 className="font-medium mb-2">What happens next?</h4>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Agreement will be created in <strong>In Progress</strong> status</li>
          <li>Required setup tasks are auto-generated (confirm eligibility, signatures, etc.)</li>
          <li>Agreement <strong>cannot</strong> be marked Active until all required tasks are complete</li>
          <li>At minimum: signed document uploaded + provider notified</li>
          <li>Supervision meetings will be scheduled per the cadence</li>
        </ol>
      </Card>

      {/* Email notifications that will fire on submit */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Email notifications</h4>
        </div>
        <div className="pl-6 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">Phase 1</Badge>
                <p className="font-medium text-sm">Initiation notice</p>
                {loadingStateReq ? (
                  <Badge variant="secondary" className="text-xs">Checking…</Badge>
                ) : willSend ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Will send on submit
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" /> Blocked
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-sent the moment you click <strong>Create Agreement</strong>. Notifies the NP and
                collaborating physician that the agreement has been initiated, with state-specific
                statute language pulled from compliance settings.
              </p>
            </div>
          </div>

          {!loadingStateReq && !willSend && stateCode && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              No collab email requirements configured for <strong>{stateCode}</strong>. The
              initiation email will be logged as <em>blocked</em> until an admin adds requirements
              for this state. The agreement itself will still be created.
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1">Recipients ({recipients.length})</p>
            <div className="space-y-1">
              {recipients.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">{r.role}</Badge>
                  <span className="font-medium">{r.name || '—'}</span>
                  <span className="text-xs text-muted-foreground truncate">{r.email}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground border-t pt-2">
            Phase 2 (Box Sign sent) and Phase 3 (Agreement complete) are sent later from the
            agreement detail page — not from this wizard.
          </p>
        </div>
      </Card>
    </div>
  );
};
