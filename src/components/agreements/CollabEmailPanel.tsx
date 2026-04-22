import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Mail, Send, AlertCircle, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type EmailId = 'email_1_initiation' | 'email_2_box_sign_sent' | 'email_3_agreement_complete';

const EMAIL_META: Record<EmailId, { name: string; description: string; phase: number }> = {
  email_1_initiation: {
    phase: 1,
    name: 'Initiation notice',
    description: 'Sent automatically when an agreement is created. Notifies NP + physician that Box Sign documents are coming.',
  },
  email_2_box_sign_sent: {
    phase: 2,
    name: 'Box Sign sent',
    description: 'Sent when the Box Sign envelope goes out. Stub: trigger manually until Box Sign integration is wired.',
  },
  email_3_agreement_complete: {
    phase: 3,
    name: 'Agreement complete',
    description: 'Sent when both parties have signed. Will fire from Box Sign webhook (not yet wired).',
  },
};

interface Props {
  agreementId: string;
  stateAbbreviation: string;
}

export function CollabEmailPanel({ agreementId, stateAbbreviation }: Props) {
  const { hasRole, user } = useAuth();
  const queryClient = useQueryClient();
  const [sendingEmailId, setSendingEmailId] = useState<EmailId | null>(null);

  const isAdmin = hasRole('admin') || hasRole('pod_lead');

  // Check if state requirements exist
  const { data: stateReq, isLoading: loadingState } = useQuery({
    queryKey: ['collab-email-state', stateAbbreviation],
    queryFn: async () => {
      const { data } = await supabase
        .from('collab_email_state_requirements')
        .select('state_code, state_name')
        .eq('state_code', stateAbbreviation)
        .maybeSingle();
      return data;
    },
  });

  const { data: log = [], isLoading: loadingLog } = useQuery({
    queryKey: ['collab-email-log', agreementId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collab_email_log')
        .select('*')
        .eq('agreement_id', agreementId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (emailId: EmailId) => {
      const { data, error } = await supabase.functions.invoke('send-collab-email', {
        body: { agreementId, emailId, triggeredBy: user?.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, emailId) => {
      if (data?.blocked) {
        toast.error('Email blocked', { description: data.message ?? 'Missing state requirements.' });
      } else {
        const sent = (data?.results || []).filter((r: any) => r.status === 'sent').length;
        const failed = (data?.results || []).filter((r: any) => r.status !== 'sent').length;
        if (failed === 0) {
          toast.success(`Sent ${EMAIL_META[emailId].name} to ${sent} recipient(s)`);
        } else {
          toast.warning(`Sent ${sent}, ${failed} failed`, {
            description: 'Check the email log for details.',
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['collab-email-log', agreementId] });
    },
    onError: (err: any) => {
      toast.error('Send failed', { description: err.message });
    },
    onSettled: () => setSendingEmailId(null),
  });

  const handleSend = (emailId: EmailId) => {
    setSendingEmailId(emailId);
    sendMutation.mutate(emailId);
  };

  const lastSentByEmail = (emailId: EmailId) =>
    log.find((l: any) => l.email_id === emailId && l.status === 'sent');

  return (
    <div className="space-y-4">
      {!loadingState && !stateReq && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>State requirements missing</AlertTitle>
          <AlertDescription>
            No collab email requirements configured for <strong>{stateAbbreviation}</strong>.
            Sends will be blocked until an admin adds a row in <code>collab_email_state_requirements</code>.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Collaborative Agreement Emails
          </CardTitle>
          <CardDescription>
            Automated lifecycle emails to the NP and collaborating physician.
            Email 1 fires automatically on agreement creation; Emails 2 and 3 are manual until Box Sign is wired.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['email_1_initiation', 'email_2_box_sign_sent', 'email_3_agreement_complete'] as EmailId[]).map((emailId) => {
            const meta = EMAIL_META[emailId];
            const last = lastSentByEmail(emailId);
            const isSending = sendingEmailId === emailId && sendMutation.isPending;
            return (
              <div key={emailId} className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">Phase {meta.phase}</Badge>
                    <p className="font-medium">{meta.name}</p>
                    {last && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Last sent {format(new Date(last.created_at), 'MMM d, h:mm a')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                </div>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant={last ? 'outline' : 'default'}
                    disabled={isSending || !stateReq}
                    onClick={() => handleSend(emailId)}
                  >
                    {isSending ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sending</>
                    ) : (
                      <><Send className="h-3 w-3 mr-1" /> {last ? 'Resend' : 'Send'}</>
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send history</CardTitle>
          <CardDescription>Audit log of all collab email sends for this agreement.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLog ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails sent yet.</p>
          ) : (
            <div className="space-y-2">
              {log.map((entry: any) => (
                <div key={entry.id} className="flex items-start gap-3 text-sm py-2 border-b last:border-0">
                  <div className="mt-0.5">
                    {entry.status === 'sent' && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {entry.status === 'blocked' && <AlertCircle className="h-4 w-4 text-warning" />}
                    {entry.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{EMAIL_META[entry.email_id as EmailId]?.name ?? entry.email_id}</span>
                      <Badge variant="outline" className="text-xs capitalize">{entry.recipient_type}</Badge>
                      <span className="text-muted-foreground text-xs">→ {entry.recipient_email || '(no email)'}</span>
                    </div>
                    {entry.subject && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.subject}</p>
                    )}
                    {entry.blocked_reason && (
                      <p className="text-xs text-warning mt-0.5">Blocked: {entry.blocked_reason}</p>
                    )}
                    {entry.error_message && (
                      <p className="text-xs text-destructive mt-0.5">Error: {entry.error_message}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(entry.created_at), 'MMM d, h:mm a')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}