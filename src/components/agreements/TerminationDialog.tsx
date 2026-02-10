import { useState } from 'react';
import { format } from 'date-fns';
import { 
  AlertTriangle, 
  FileText, 
  CheckCircle2,
  Loader2,
  ClipboardList,
  Calendar,
} from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAgreementWorkflow } from '@/hooks/useAgreementWorkflow';
import type { Tables } from '@/integrations/supabase/types';

type Agreement = Tables<'collaborative_agreements'>;
type AgreementProvider = Tables<'agreement_providers'>;

interface TerminationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreement: Agreement;
  providers: AgreementProvider[];
  onSuccess?: () => void;
}

export function TerminationDialog({
  open,
  onOpenChange,
  agreement,
  providers,
  onSuccess,
}: TerminationDialogProps) {
  const { toast } = useToast();
  const { initiateTermination } = useAgreementWorkflow();
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [tasksGenerated, setTasksGenerated] = useState(0);

  const handleInitiateTermination = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason for termination.',
        variant: 'destructive',
      });
      return;
    }

    if (!effectiveDate) {
      toast({
        title: 'Effective date required',
        description: 'Please provide a termination effective date.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const taskCount = await initiateTermination(
        agreement.id,
        agreement,
        reason
      );

      setTasksGenerated(taskCount);
      setCompleted(true);

      toast({
        title: 'Termination initiated',
        description: `${taskCount} required termination tasks have been generated. Complete all tasks before finalizing.`,
      });
    } catch (error) {
      console.error('Error initiating termination:', error);
      toast({
        title: 'Error',
        description: 'Failed to initiate termination. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (completed) {
      onSuccess?.();
    }
    onOpenChange(false);
    setTimeout(() => {
      setReason('');
      setEffectiveDate('');
      setCompleted(false);
      setTasksGenerated(0);
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>Terminate Agreement</DialogTitle>
              <DialogDescription>
                {agreement.state_name} - Dr. {agreement.physician_name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        {!completed ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Termination *</Label>
              <Textarea
                id="reason"
                placeholder="Please provide a detailed reason for terminating this agreement..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Termination Effective Date *</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>

            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">What will happen:</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
                <li>Agreement status → <Badge variant="destructive" className="text-xs">Pending Termination</Badge></li>
                <li>Required termination tasks will be auto-generated</li>
                <li>Agreement <strong>cannot</strong> be finalized until all tasks are completed</li>
                <li>{providers.length} provider{providers.length !== 1 ? 's' : ''} will be affected</li>
              </ul>
            </div>

            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <p className="text-sm text-destructive">
                <strong>Warning:</strong> This will block the agreement and generate compliance tasks.
                The agreement will remain in "Pending Termination" until all tasks are verified complete.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Termination Initiated</h3>
              <p className="text-muted-foreground mt-1">
                {tasksGenerated} required task{tasksGenerated !== 1 ? 's' : ''} have been generated.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm text-left space-y-2">
              <p className="font-medium">Next steps:</p>
              <ul className="text-muted-foreground space-y-1 ml-4 list-disc">
                <li>Complete all termination tasks on the agreement detail page</li>
                <li>Upload required documentation</li>
                <li>Admin must verify and finalize termination</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          {!completed ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleInitiateTermination}
                disabled={loading || !reason.trim() || !effectiveDate}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Initiate Termination
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} className="w-full">
              Go to Agreement Details
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}