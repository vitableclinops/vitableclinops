import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type WorkflowReadinessStatus = 'not_ready' | 'ready_for_review' | 'ready_to_execute' | 'completed';

export interface BlockingReason {
  field: string;
  label: string;
  severity: 'required' | 'recommended';
  fixAction?: 'navigate' | 'inline' | 'task';
  fixTarget?: string;
}

export interface WorkflowReadiness {
  status: WorkflowReadinessStatus;
  blockingReasons: BlockingReason[];
  canExecute: boolean;
  canReview: boolean;
  isComplete: boolean;
}

// ─── Transfer Readiness ───────────────────────────────────

type Transfer = Tables<'agreement_transfers'>;
type Task = Tables<'agreement_tasks'>;

export function computeTransferReadiness(
  transfer: Transfer,
  tasks: Task[]
): WorkflowReadiness {
  const reasons: BlockingReason[] = [];

  // 1. Required intake fields
  if (!transfer.target_physician_name) {
    reasons.push({
      field: 'target_physician_name',
      label: 'Incoming physician not assigned',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  if (!transfer.effective_date) {
    reasons.push({
      field: 'effective_date',
      label: 'No effective date set',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  if (!transfer.termination_effective_date) {
    reasons.push({
      field: 'termination_effective_date',
      label: 'Termination effective date not set',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  if (!transfer.initiation_effective_date) {
    reasons.push({
      field: 'initiation_effective_date',
      label: 'Initiation effective date not set',
      severity: 'recommended',
      fixAction: 'inline',
    });
  }

  // 2. Date sequencing
  if (
    transfer.initiation_effective_date &&
    transfer.termination_effective_date &&
    transfer.initiation_effective_date < transfer.termination_effective_date
  ) {
    reasons.push({
      field: 'date_sequence',
      label: 'Initiation date is before termination date — coverage gap risk',
      severity: 'required',
    });
  }

  // 3. Task-based blocking
  const requiredTasks = tasks.filter(t => t.is_required !== false);
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const terminationTasks = requiredTasks.filter(t => t.auto_trigger === 'transfer_termination');
  const terminationComplete = terminationTasks.length > 0 && terminationTasks.every(t => t.status === 'completed');
  const allRequiredComplete = requiredTasks.length > 0 && requiredTasks.every(t => t.status === 'completed');

  if (blockedTasks.length > 0) {
    reasons.push({
      field: 'blocked_tasks',
      label: `${blockedTasks.length} task(s) are blocked`,
      severity: 'required',
      fixAction: 'inline',
    });
  }

  // 4. Phase gating: initiation tasks shouldn't start until termination docs are in
  const terminationSignatureTask = terminationTasks.find(
    t => t.category === 'signature' || t.title.toLowerCase().includes('termination agreement')
  );
  if (terminationSignatureTask && terminationSignatureTask.status !== 'completed') {
    const initiationStarted = tasks.some(
      t => t.auto_trigger === 'transfer_initiation' && t.status !== 'pending'
    );
    if (initiationStarted) {
      reasons.push({
        field: 'phase_sequence',
        label: 'Initiation started before termination agreement is signed',
        severity: 'required',
      });
    }
  }

  // Determine status
  let status: WorkflowReadinessStatus = 'not_ready';
  
  if (transfer.status === 'completed' && allRequiredComplete) {
    status = 'completed';
  } else if (reasons.filter(r => r.severity === 'required').length === 0) {
    status = 'ready_to_execute';
  } else {
    // Check if we have enough to at least review
    const criticalMissing = reasons.filter(r => 
      r.severity === 'required' && ['target_physician_name', 'effective_date'].includes(r.field)
    );
    if (criticalMissing.length === 0) {
      status = 'ready_for_review';
    }
  }

  return {
    status,
    blockingReasons: reasons,
    canExecute: status === 'ready_to_execute' || status === 'completed',
    canReview: status !== 'not_ready',
    isComplete: status === 'completed',
  };
}

// ─── Activation Readiness (extends existing) ─────────────

export function computeActivationReadiness(
  readinessStatus: string | null,
  readinessReason: string | null,
  ehrActivationStatus: string | null
): WorkflowReadiness {
  const reasons: BlockingReason[] = [];

  if (readinessReason) {
    const parts = readinessReason.split('; ');
    for (const part of parts) {
      let field = 'unknown';
      let fixAction: BlockingReason['fixAction'] = 'navigate';
      let fixTarget: string | undefined;
      
      if (part.includes('license')) {
        field = 'license';
        fixTarget = '/directory';
      } else if (part.includes('collaborative agreement') || part.includes('collab')) {
        field = 'collab_agreement';
        fixTarget = '/admin/agreements';
      }
      
      reasons.push({
        field,
        label: part,
        severity: 'required',
        fixAction,
        fixTarget,
      });
    }
  }

  let status: WorkflowReadinessStatus = 'not_ready';
  
  if (ehrActivationStatus === 'active' && readinessStatus === 'ready') {
    status = 'completed';
  } else if (readinessStatus === 'ready') {
    status = 'ready_to_execute';
  } else if (readinessStatus === 'at_risk') {
    status = 'ready_for_review';
  }

  return {
    status,
    blockingReasons: reasons,
    canExecute: status === 'ready_to_execute' || status === 'completed',
    canReview: status !== 'not_ready',
    isComplete: status === 'completed',
  };
}

// ─── Agreement Readiness ─────────────────────────────────

export function computeAgreementReadiness(
  agreement: Tables<'collaborative_agreements'>,
  tasks: Task[]
): WorkflowReadiness {
  const reasons: BlockingReason[] = [];

  if (!agreement.physician_name) {
    reasons.push({
      field: 'physician_name',
      label: 'No physician assigned',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  if (!agreement.start_date) {
    reasons.push({
      field: 'start_date',
      label: 'Start date not set',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  if (!agreement.state_abbreviation) {
    reasons.push({
      field: 'state',
      label: 'No state selected',
      severity: 'required',
      fixAction: 'inline',
    });
  }

  const requiredTasks = tasks.filter(t => t.is_required !== false);
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const allRequiredComplete = requiredTasks.length > 0 && requiredTasks.every(t => t.status === 'completed');

  if (blockedTasks.length > 0) {
    reasons.push({
      field: 'blocked_tasks',
      label: `${blockedTasks.length} task(s) are blocked`,
      severity: 'required',
      fixAction: 'inline',
    });
  }

  let status: WorkflowReadinessStatus = 'not_ready';
  
  if (agreement.workflow_status === 'fully_executed') {
    status = 'completed';
  } else if (reasons.filter(r => r.severity === 'required').length === 0) {
    status = 'ready_to_execute';
  } else if (agreement.physician_name && agreement.state_abbreviation) {
    status = 'ready_for_review';
  }

  return {
    status,
    blockingReasons: reasons,
    canExecute: status === 'ready_to_execute' || status === 'completed',
    canReview: status !== 'not_ready',
    isComplete: status === 'completed',
  };
}

// ─── Admin Override ──────────────────────────────────────

export async function logWorkflowOverride(params: {
  entityType: 'transfer' | 'agreement' | 'activation';
  entityId: string;
  action: string;
  reason: string;
  blockingReasons: BlockingReason[];
}) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', user?.id ?? '')
    .maybeSingle();

  const { error } = await supabase.from('workflow_overrides').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    reason: params.reason,
    overridden_by: user?.id,
    overridden_by_name: profile?.full_name || user?.email || 'Unknown',
    blocking_reasons_at_override: params.blockingReasons as any,
  });

  if (error) throw error;
}
