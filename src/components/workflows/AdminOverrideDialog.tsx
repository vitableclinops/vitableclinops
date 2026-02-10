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
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { logWorkflowOverride, type BlockingReason } from '@/hooks/useWorkflowReadiness';
import { useToast } from '@/hooks/use-toast';

interface AdminOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'transfer' | 'agreement' | 'activation';
  entityId: string;
  entityLabel: string;
  action: string;
  blockingReasons: BlockingReason[];
  onConfirm: () => Promise<void>;
}

export function AdminOverrideDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityLabel,
  action,
  blockingReasons,
  onConfirm,
}: AdminOverrideDialogProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const requiredBlockers = blockingReasons.filter(r => r.severity === 'required');

  const handleOverride = async () => {
    if (!reason.trim()) return;
    
    setLoading(true);
    try {
      await logWorkflowOverride({
        entityType,
        entityId,
        action,
        reason: reason.trim(),
        blockingReasons,
      });

      await onConfirm();

      toast({
        title: 'Override applied',
        description: `Action "${action}" executed with admin override. Reason logged to audit trail.`,
      });

      setReason('');
      onOpenChange(false);
    } catch (error) {
      console.error('Override error:', error);
      toast({
        title: 'Override failed',
        description: 'Could not apply override. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" />
            Admin Override Required
          </DialogTitle>
          <DialogDescription>
            This action is blocked by readiness requirements. As an admin, you can override with a documented reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-sm font-medium">{entityLabel}</p>
            <p className="text-sm text-muted-foreground">Action: {action}</p>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium mb-2">
                {requiredBlockers.length} requirement(s) not met:
              </p>
              <ul className="space-y-1">
                {requiredBlockers.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span>•</span>
                    {r.label}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="override-reason">Override Reason (required)</Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this override is necessary and safe to proceed..."
              className="min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              This will be logged to the audit trail with your name and timestamp.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleOverride}
            disabled={!reason.trim() || loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Override & Proceed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
