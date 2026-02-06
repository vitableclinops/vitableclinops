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
import { Loader2, AlertTriangle } from 'lucide-react';
import { useUpdateActivationStatus, type EhrActivationStatus } from '@/hooks/useProviderStateStatus';

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
  const config = actionConfig[actionType];

  const isNotReady = readinessStatus !== 'ready';
  const isActivating = actionType === 'activate' || actionType === 'request_activation';

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    
    await updateMutation.mutateAsync({
      providerId,
      stateAbbreviation,
      newStatus: config.newStatus,
      notes,
      effectiveDate: effectiveDate || undefined,
      evidenceLink: evidenceLink || undefined,
    });

    setNotes('');
    setEffectiveDate('');
    setEvidenceLink('');
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

          {isActivating && isNotReady && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> This provider is not ready for activation.
                {readinessReason && <span className="block mt-1">{readinessReason}</span>}
              </AlertDescription>
            </Alert>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={config.variant}
            onClick={handleSubmit}
            disabled={!notes.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {config.buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
