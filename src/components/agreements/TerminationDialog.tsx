import { useState } from 'react';
import { format } from 'date-fns';
import { 
  AlertTriangle, 
  Mail, 
  FileText, 
  CheckCircle2,
  Loader2,
  Send
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
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

type TerminationStep = 'reason' | 'notifications' | 'confirm' | 'complete';

interface NotificationRecipient {
  id: string;
  name: string;
  email: string;
  type: 'physician' | 'provider';
  selected: boolean;
}

export function TerminationDialog({
  open,
  onOpenChange,
  agreement,
  providers,
  onSuccess,
}: TerminationDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<TerminationStep>('reason');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [notificationsSent, setNotificationsSent] = useState(false);
  
  const [recipients, setRecipients] = useState<NotificationRecipient[]>(() => [
    {
      id: 'physician',
      name: agreement.physician_name,
      email: agreement.physician_email,
      type: 'physician',
      selected: true,
    },
    ...providers.map(p => ({
      id: p.id,
      name: p.provider_name,
      email: p.provider_email,
      type: 'provider' as const,
      selected: true,
    })),
  ]);

  const toggleRecipient = (id: string) => {
    setRecipients(prev =>
      prev.map(r => (r.id === id ? { ...r, selected: !r.selected } : r))
    );
  };

  const selectedRecipients = recipients.filter(r => r.selected);

  const handleInitiateTermination = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason for termination.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Update agreement status to termination_initiated
      const { error } = await supabase
        .from('collaborative_agreements')
        .update({
          workflow_status: 'termination_initiated',
          termination_reason: reason,
        })
        .eq('id', agreement.id);

      if (error) throw error;

      setStep('notifications');
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

  const handleSendNotifications = async () => {
    setLoading(true);

    try {
      // Create notification records for manual follow-up
      const notifications = selectedRecipients.map(recipient => ({
        agreement_id: agreement.id,
        notification_type: 'termination_initiated' as const,
        recipient_email: recipient.email,
        recipient_name: recipient.name,
        subject: `Collaborative Agreement Termination Notice - ${agreement.state_name}`,
        delivered: false,
      }));

      const { error } = await supabase
        .from('agreement_notifications')
        .insert(notifications);

      if (error) throw error;

      setNotificationsSent(true);
      toast({
        title: 'Notifications queued',
        description: `${selectedRecipients.length} notification(s) have been queued for manual sending.`,
      });

      setStep('confirm');
    } catch (error) {
      console.error('Error creating notifications:', error);
      toast({
        title: 'Error',
        description: 'Failed to queue notifications. You can proceed without them.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTermination = async () => {
    setLoading(true);

    try {
      // Update agreement to terminated status
      const { error: agreementError } = await supabase
        .from('collaborative_agreements')
        .update({
          workflow_status: 'terminated',
          terminated_at: new Date().toISOString(),
        })
        .eq('id', agreement.id);

      if (agreementError) throw agreementError;

      // Deactivate all providers on this agreement
      const { error: providersError } = await supabase
        .from('agreement_providers')
        .update({
          is_active: false,
          removed_at: new Date().toISOString(),
          removed_reason: 'Agreement terminated',
        })
        .eq('agreement_id', agreement.id);

      if (providersError) throw providersError;

      // Create completion notification records
      const completionNotifications = selectedRecipients.map(recipient => ({
        agreement_id: agreement.id,
        notification_type: 'termination_complete' as const,
        recipient_email: recipient.email,
        recipient_name: recipient.name,
        subject: `Collaborative Agreement Terminated - ${agreement.state_name}`,
        delivered: false,
      }));

      await supabase
        .from('agreement_notifications')
        .insert(completionNotifications);

      setStep('complete');
      toast({
        title: 'Agreement terminated',
        description: 'The agreement has been successfully terminated.',
      });
    } catch (error) {
      console.error('Error completing termination:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete termination. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (step === 'complete') {
      onSuccess?.();
    }
    onOpenChange(false);
    // Reset state after close
    setTimeout(() => {
      setStep('reason');
      setReason('');
      setNotificationsSent(false);
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

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {(['reason', 'notifications', 'confirm', 'complete'] as TerminationStep[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`h-2 w-2 rounded-full ${
                  step === s
                    ? 'bg-destructive'
                    : ['reason', 'notifications', 'confirm', 'complete'].indexOf(step) > i
                    ? 'bg-destructive/50'
                    : 'bg-muted'
                }`}
              />
              {i < 3 && <div className="w-8 h-0.5 bg-muted" />}
            </div>
          ))}
        </div>

        <Separator />

        {/* Step: Reason */}
        {step === 'reason' && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Termination *</Label>
              <Textarea
                id="reason"
                placeholder="Please provide a detailed reason for terminating this agreement..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                This will be recorded for audit purposes and may be included in notifications.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <p className="text-sm text-destructive">
                <strong>Warning:</strong> Terminating this agreement will affect{' '}
                {providers.length} provider{providers.length !== 1 ? 's' : ''} and their
                ability to practice in {agreement.state_name}.
              </p>
            </div>
          </div>
        )}

        {/* Step: Notifications */}
        {step === 'notifications' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>Select recipients to notify about this termination</span>
            </div>

            <div className="space-y-2">
              {recipients.map(recipient => (
                <div
                  key={recipient.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={recipient.id}
                      checked={recipient.selected}
                      onCheckedChange={() => toggleRecipient(recipient.id)}
                    />
                    <div>
                      <Label htmlFor={recipient.id} className="cursor-pointer">
                        {recipient.name}
                      </Label>
                      <p className="text-xs text-muted-foreground">{recipient.email}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {recipient.type}
                  </Badge>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Notification records will be created for manual follow-up. You can send 
              these manually via your email system.
            </p>
          </div>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Termination Summary
              </h4>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agreement</span>
                  <span>{agreement.state_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Physician</span>
                  <span>Dr. {agreement.physician_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Providers Affected</span>
                  <span>{providers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Notifications Queued</span>
                  <span>{selectedRecipients.length}</span>
                </div>
              </div>

              <Separator />

              <div>
                <span className="text-muted-foreground text-sm">Reason:</span>
                <p className="text-sm mt-1">{reason}</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive font-medium">
                This action cannot be undone. The agreement will be permanently terminated.
              </p>
            </div>
          </div>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <div className="py-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Termination Complete</h3>
              <p className="text-muted-foreground mt-1">
                The agreement has been terminated and all parties have been notified.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <p className="text-muted-foreground">
                <strong>{selectedRecipients.length}</strong> notification records have been
                created. Please send these manually through your email system.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'reason' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleInitiateTermination}
                disabled={loading || !reason.trim()}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Initiate Termination
              </Button>
            </>
          )}

          {step === 'notifications' && (
            <>
              <Button variant="outline" onClick={() => setStep('confirm')}>
                Skip Notifications
              </Button>
              <Button onClick={handleSendNotifications} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Send className="h-4 w-4 mr-2" />
                Queue {selectedRecipients.length} Notification{selectedRecipients.length !== 1 ? 's' : ''}
              </Button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => setStep('notifications')}>
                Back
              </Button>
              <Button variant="destructive" onClick={handleCompleteTermination} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Complete Termination
              </Button>
            </>
          )}

          {step === 'complete' && (
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
