import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Lock } from 'lucide-react';
import { useUpdateActivationStatus, type EhrActivationStatus } from '@/hooks/useProviderStateStatus';
import { useEmailNotifications } from '@/hooks/useEmailNotifications';
import { supabase } from '@/integrations/supabase/client';
import { computeActivationReadiness, logWorkflowOverride } from '@/hooks/useWorkflowReadiness';
import { WorkflowReadinessBanner } from '@/components/workflows/WorkflowReadinessBanner';

interface ActivationActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  providerName: string;
  stateAbbreviation: string;
  stateName: string;
  currentStatus: EhrActivationStatus;
  readinessStatus: string;
  readinessReason?: string | null;
  actionType: 'activate' | 'deactivate' | 'request_activation' | 'request_deactivation';
}

const actionConfig = {
  activate: {
    title: 'Activate Provider in EHR',
    description: 'This will mark the provider as active in the EHR for this state.',
    buttonText: 'Activate Now',
    newStatus: 'active' as EhrActivationStatus,
    variant: 'default' as const,
  },
  deactivate: {
    title: 'Deactivate Provider in EHR',
    description: 'This will mark the provider as deactivated in the EHR for this state.',
    buttonText: 'Deactivate Now',
    newStatus: 'deactivated' as EhrActivationStatus,
    variant: 'destructive' as const,
  },
  request_activation: {
    title: 'Request Activation',
    description: 'Submit a request to activate this provider in the EHR.',
    buttonText: 'Submit Request',
    newStatus: 'activation_requested' as EhrActivationStatus,
    variant: 'default' as const,
  },
  request_deactivation: {
    title: 'Request Deactivation',
    description: 'Submit a request to deactivate this provider in the EHR.',
    buttonText: 'Submit Request',
    newStatus: 'deactivation_requested' as EhrActivationStatus,
    variant: 'destructive' as const,
  },
};

export function ActivationActionDialog({
  open,
  onOpenChange,
  providerId,
  providerName,
  stateAbbreviation,
  stateName,
  currentStatus,
  readinessStatus,
  readinessReason,
  actionType,
}: ActivationActionDialogProps) {
  const [notes, setNotes] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [evidenceLink, setEvidenceLink] = useState('');
  
  const updateMutation = useUpdateActivationStatus();
  const { notifyStatusChanged } = useEmailNotifications();
  const config = actionConfig[actionType];

  const isNotReady = readinessStatus !== 'ready';
  const isActivating = actionType === 'activate' || actionType === 'request_activation';
  const activationReadiness = computeActivationReadiness(readinessStatus, readinessReason, currentStatus);
  const isHardBlocked = isActivating && isNotReady;

  const [overrideReason, setOverrideReason] = useState('');

  const handleSubmit = async () => {
    if (!notes.trim()) return;

    // If blocked, require override reason
    if (isHardBlocked && !overrideReason.trim()) return;
    
    // Log override if proceeding despite blockers
    if (isHardBlocked) {
      await logWorkflowOverride({
        entityType: 'activation',
        entityId: `${providerId}:${stateAbbreviation}`,
        action: config.buttonText,
        reason: overrideReason.trim(),
        blockingReasons: activationReadiness.blockingReasons,
      });
    }

    await updateMutation.mutateAsync({
      providerId,
      stateAbbreviation,
      newStatus: config.newStatus,
      notes,
      effectiveDate: effectiveDate || undefined,
      evidenceLink: evidenceLink || undefined,
    });

    // Fetch provider email to send notification
    const { data: providerProfile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', providerId)
      .single();

    if (providerProfile?.email) {
      await notifyStatusChanged(
        providerProfile.email,
        providerProfile.full_name || providerName,
        {
          entityName: `${providerName} - ${stateName} (${stateAbbreviation})`,
          previousStatus: currentStatus,
          newStatus: config.newStatus,
          notes: notes,
          actionUrl: `${window.location.origin}/directory?search=${encodeURIComponent(providerName)}`,
        }
      );
    }

    setNotes('');
    setEffectiveDate('');
    setEvidenceLink('');
    setOverrideReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>
            {config.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-sm font-medium">{providerName}</p>
            <p className="text-sm text-muted-foreground">{stateName} ({stateAbbreviation})</p>
          </div>

          {isHardBlocked && (
            <WorkflowReadinessBanner 
              readiness={activationReadiness}
              entityLabel={`${providerName} — ${stateName}`}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (required)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain the reason for this action..."
              className="min-h-[100px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Effective Date (optional)</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evidenceLink">Evidence Link (optional)</Label>
              <Input
                id="evidenceLink"
                type="url"
                value={evidenceLink}
                onChange={(e) => setEvidenceLink(e.target.value)}
                placeholder="Ticket or screenshot URL"
              />
            </div>
          </div>

          {/* Admin override reason — only shown when hard-blocked */}
          {isHardBlocked && (
            <div className="space-y-2">
              <Label htmlFor="overrideReason" className="flex items-center gap-2 text-destructive">
                <Lock className="h-3.5 w-3.5" />
                Override Reason (required to proceed)
              </Label>
              <Textarea
                id="overrideReason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why activation is safe despite unmet requirements..."
                className="min-h-[80px] border-destructive/30"
              />
              <p className="text-xs text-muted-foreground">
                This override will be logged to the audit trail.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isHardBlocked ? 'destructive' : config.variant}
            onClick={handleSubmit}
            disabled={
              !notes.trim() || 
              updateMutation.isPending || 
              (isHardBlocked && !overrideReason.trim())
            }
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isHardBlocked ? (
              <>
                <Lock className="h-3.5 w-3.5 mr-1" />
                Override & {config.buttonText}
              </>
            ) : (
              config.buttonText
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
