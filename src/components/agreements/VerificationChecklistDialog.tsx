import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationCheck {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  detail: string;
  loading: boolean;
}

interface VerificationChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreementId: string;
  agreement: {
    state_abbreviation: string;
    state_name: string;
    physician_email: string | null;
    physician_name: string | null;
    physician_id: string | null;
    provider_id: string | null;
    agreement_document_url: string | null;
    meeting_cadence: string | null;
  };
  onApprove: () => Promise<void>;
}

export function VerificationChecklistDialog({
  open,
  onOpenChange,
  agreementId,
  agreement,
  onApprove,
}: VerificationChecklistDialogProps) {
  const [checks, setChecks] = useState<VerificationCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);

  const allPassed = checks.length > 0 && checks.every(c => !c.loading && c.passed);

  const runChecks = async () => {
    setRunning(true);

    const initialChecks: VerificationCheck[] = [
      { id: 'tasks', label: 'Required tasks completed', description: 'All required tasks have status "completed"', passed: false, detail: '', loading: true },
      { id: 'document', label: 'Signed agreement uploaded', description: 'Document upload task completed with attachment', passed: false, detail: '', loading: true },
      { id: 'capacity', label: 'Physician capacity not exceeded', description: 'Physician has not exceeded state ratio limit', passed: false, detail: '', loading: true },
    ];
    setChecks([...initialChecks]);

    // Run all checks in parallel
    const results = await Promise.allSettled([
      checkRequiredTasks(),
      checkDocument(),
      checkCapacity(),
    ]);

    const updatedChecks = initialChecks.map((check, i) => {
      const result = results[i];
      if (result.status === 'fulfilled') {
        return { ...check, ...result.value, loading: false };
      }
      return { ...check, passed: false, detail: 'Error running check', loading: false };
    });

    setChecks(updatedChecks);
    setRunning(false);
  };

  const checkRequiredTasks = async (): Promise<{ passed: boolean; detail: string }> => {
    const { data: tasks } = await supabase
      .from('agreement_tasks')
      .select('id, title, status, is_required')
      .eq('agreement_id', agreementId)
      .eq('is_required', true)
      .is('archived_at', null);

    const total = tasks?.length || 0;
    const completed = tasks?.filter(t => t.status === 'completed').length || 0;
    const pending = total - completed;

    if (total === 0) return { passed: true, detail: 'No required tasks defined' };
    if (pending === 0) return { passed: true, detail: `All ${total} required tasks completed` };

    const pendingNames = tasks?.filter(t => t.status !== 'completed').map(t => t.title).slice(0, 3) || [];
    return {
      passed: false,
      detail: `${pending} of ${total} required tasks incomplete: ${pendingNames.join(', ')}${pending > 3 ? '...' : ''}`,
    };
  };

  const checkDocument = async (): Promise<{ passed: boolean; detail: string }> => {
    const { data: docTasks } = await supabase
      .from('agreement_tasks')
      .select('id, title, status')
      .eq('agreement_id', agreementId)
      .eq('title', 'Upload executed new agreement')
      .is('archived_at', null);

    if (!docTasks || docTasks.length === 0) {
      return { passed: false, detail: 'No "Upload executed new agreement" task found' };
    }

    const completed = docTasks.every(t => t.status === 'completed');
    return {
      passed: completed,
      detail: completed
        ? 'Executed agreement uploaded'
        : 'Upload executed new agreement task is not yet completed',
    };
  };

  const checkCapacity = async (): Promise<{ passed: boolean; detail: string }> => {
    if (!agreement.physician_email) {
      return { passed: true, detail: 'No physician assigned — capacity check skipped' };
    }

    const { data: stateConfig } = await supabase
      .from('state_compliance_requirements')
      .select('np_md_ratio_limit')
      .eq('state_abbreviation', agreement.state_abbreviation)
      .single();

    const limit = stateConfig?.np_md_ratio_limit;
    if (!limit) {
      return { passed: true, detail: 'No ratio limit configured for this state' };
    }

    const { data: agreements } = await supabase
      .from('collaborative_agreements')
      .select('id')
      .eq('physician_email', agreement.physician_email)
      .eq('state_abbreviation', agreement.state_abbreviation)
      .neq('workflow_status', 'cancelled');

    const count = agreements?.length || 0;
    const withinLimit = count <= limit;

    return {
      passed: withinLimit,
      detail: withinLimit
        ? `Physician has ${count} of ${limit} allowed agreements in ${agreement.state_abbreviation}`
        : `Physician has ${count} agreements, exceeding the ${limit} limit in ${agreement.state_abbreviation}`,
    };
  };

  useEffect(() => {
    if (open) {
      runChecks();
    }
  }, [open]);

  const handleApprove = async () => {
    setApproving(true);
    try {
      // Log the verification check results to audit log
      await supabase.from('agreement_audit_log').insert({
        entity_type: 'agreement',
        entity_id: agreementId,
        action: 'verification_completed',
        changes: {
          checks: checks.map(c => ({
            id: c.id,
            label: c.label,
            passed: c.passed,
            detail: c.detail,
          })),
          all_passed: allPassed,
          verified_at: new Date().toISOString(),
        },
      });

      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verification & Activation
          </DialogTitle>
          <DialogDescription>
            Automated checks against live data. Review results below before approving activation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          {checks.map((check) => (
            <div
              key={check.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                check.loading && 'bg-muted/30',
                !check.loading && check.passed && 'bg-success/5 border-success/20',
                !check.loading && !check.passed && 'bg-destructive/5 border-destructive/20'
              )}
            >
              <div className="mt-0.5 shrink-0">
                {check.loading ? (
                  <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                ) : check.passed ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{check.label}</p>
                {!check.loading && (
                  <p className={cn(
                    'text-xs mt-0.5',
                    check.passed ? 'text-muted-foreground' : 'text-destructive'
                  )}>
                    {check.detail}
                  </p>
                )}
              </div>
              {!check.loading && (
                <Badge
                  variant={check.passed ? 'outline' : 'destructive'}
                  className="shrink-0 text-xs"
                >
                  {check.passed ? 'Pass' : 'Fail'}
                </Badge>
              )}
            </div>
          ))}
        </div>

        {!running && !allPassed && checks.length > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <p className="text-sm text-muted-foreground">
              One or more checks failed. Resolve the issues above before activating.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={runChecks}
            disabled={running}
          >
            <RefreshCw className={cn('h-4 w-4 mr-1', running && 'animate-spin')} />
            Re-check
          </Button>
          <Button
            onClick={handleApprove}
            disabled={!allPassed || approving}
          >
            {approving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4 mr-2" />
            )}
            Approve & Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
