import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { getInitiationTaskTemplates, getTerminationTaskTemplates, hydrateTaskTemplates } from '@/data/taskTemplates';

type AgreementTask = Tables<'agreement_tasks'>;
type AgreementTaskInsert = TablesInsert<'agreement_tasks'>;
type WorkflowStatus = Tables<'collaborative_agreements'>['workflow_status'];

/**
 * Generates the full set of required setup tasks for a new collaborative agreement.
 * Uses the canonical initiation task templates.
 */
export const getSetupTasks = (
  agreementId: string,
  stateAbbreviation: string,
  stateName: string,
  providerId: string | null,
  physicianId: string | null,
  _options?: { chartReviewRequired?: boolean; meetingCadence?: string }
): AgreementTaskInsert[] => {
  const templates = getInitiationTaskTemplates(
    'assigned physician',
    1
  );

  return hydrateTaskTemplates(templates, {
    agreementId,
    providerId,
    physicianId,
    stateAbbreviation,
    stateName,
    autoTrigger: 'agreement_creation',
  });
};

/**
 * Generates termination tasks for an agreement.
 * Uses the canonical termination task templates.
 */
export const getTerminationTasks = (
  agreementId: string,
  stateAbbreviation: string,
  stateName: string,
  providerId: string | null,
  physicianId: string | null
): AgreementTaskInsert[] => {
  const templates = getTerminationTaskTemplates(
    'supervising physician',
    1
  );

  return hydrateTaskTemplates(templates, {
    agreementId,
    providerId,
    physicianId,
    stateAbbreviation,
    stateName,
    autoTrigger: 'agreement_termination',
  });
};

/**
 * Hook for managing agreement workflow state transitions with task enforcement.
 */
export const useAgreementWorkflow = () => {
  const { toast } = useToast();

  /**
   * Check if all required tasks for a given trigger are completed.
   */
  const checkTasksComplete = useCallback(async (
    agreementId: string,
    trigger: string
  ): Promise<{ allComplete: boolean; pending: number; total: number }> => {
    const { data: tasks, error } = await supabase
      .from('agreement_tasks')
      .select('id, status, is_required')
      .eq('agreement_id', agreementId)
      .eq('is_required', true)
      .is('archived_at', null);

    if (error) throw error;

    // If trigger-specific filtering is needed, try it first; fall back to all tasks
    let filtered = tasks?.filter(t => true) || [];
    if (trigger) {
      const triggerTasks = filtered;
      // Don't filter by trigger — tasks may have different triggers (transfer_initiation vs agreement_creation)
    }

    const total = filtered.length;
    const completed = filtered.filter(t => t.status === 'completed').length;
    const pending = total - completed;

    return { allComplete: pending === 0 && total > 0, pending, total };
  }, []);

  /**
   * Attempt to advance agreement status. Returns true if advanced, false if blocked.
   */
  const advanceStatus = useCallback(async (
    agreementId: string,
    targetStatus: WorkflowStatus,
    adminId?: string
  ): Promise<boolean> => {
    // Hard blocker validation by target status
    if (['pending_signatures', 'pending_verification', 'active'].includes(targetStatus)) {
      const { allComplete, pending } = await checkTasksComplete(agreementId, 'agreement_creation');
      
      // For active: ALL required tasks must be complete (signed doc uploaded + provider notified)
      if (targetStatus === 'active' && !allComplete) {
        toast({
          title: 'Cannot activate agreement',
          description: `${pending} required task(s) must be completed first, including signed document upload and provider notification.`,
          variant: 'destructive',
        });
        return false;
      }

      // For pending_signatures: at minimum confirm-required and send-for-signature tasks
      if (targetStatus === 'pending_signatures' && !allComplete) {
        // Allow advancing to signatures if only signature tasks remain
        const { data: nonSigTasks } = await supabase
          .from('agreement_tasks')
          .select('id, status, category')
          .eq('agreement_id', agreementId)
          .eq('is_required', true)
          .is('archived_at', null)
          .neq('category', 'signature')
          .neq('status', 'completed');
        
        if (nonSigTasks && nonSigTasks.length > 0) {
          toast({
            title: 'Cannot advance to signatures',
            description: `${nonSigTasks.length} non-signature task(s) must be completed first.`,
            variant: 'destructive',
          });
          return false;
        }
      }
    }

    if (targetStatus === 'terminated') {
      const { allComplete, pending } = await checkTasksComplete(agreementId, 'agreement_termination');
      if (!allComplete) {
        toast({
          title: 'Cannot finalize termination',
          description: `${pending} required termination task(s) must be completed first.`,
          variant: 'destructive',
        });
        return false;
      }
    }

    // Perform the status update
    const updateData: Record<string, any> = { workflow_status: targetStatus };
    
    if (targetStatus === 'terminated') {
      updateData.terminated_at = new Date().toISOString();
      if (adminId) updateData.terminated_by = adminId;
    }

    if (targetStatus === 'cancelled') {
      updateData.terminated_at = new Date().toISOString();
      if (adminId) updateData.terminated_by = adminId;
    }

    const { error } = await supabase
      .from('collaborative_agreements')
      .update(updateData)
      .eq('id', agreementId);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to update agreement status.',
        variant: 'destructive',
      });
      return false;
    }

    // Log the transition
    await supabase.from('agreement_audit_log').insert({
      entity_type: 'agreement',
      entity_id: agreementId,
      action: `status_change_to_${targetStatus}`,
      performed_by: adminId || null,
      changes: { new_status: targetStatus },
    });

    return true;
  }, [checkTasksComplete, toast]);

  /**
   * Create agreement with full task generation and proper status transition.
   */
  const createAgreementWithTasks = useCallback(async (
    agreementData: Record<string, any>,
    providers: Array<{ id?: string; name: string; email: string; npi?: string }>,
    options?: { chartReviewRequired?: boolean; meetingCadence?: string; providerMessage?: string }
  ) => {
    // Compute next_renewal_date from start_date + renewal_cadence
    let computedRenewalDate: string | null = null;
    if (agreementData.start_date && agreementData.renewal_cadence) {
      const startDate = new Date(agreementData.start_date);
      const yearsToAdd = agreementData.renewal_cadence === 'biennial' ? 2 : 1;
      const renewalDate = new Date(startDate);
      renewalDate.setFullYear(renewalDate.getFullYear() + yearsToAdd);
      computedRenewalDate = renewalDate.toISOString().split('T')[0];
    }

    // Step 1: Create agreement in Draft
    const { data: agreement, error: agreementError } = await supabase
      .from('collaborative_agreements')
      .insert({
        ...agreementData,
        next_renewal_date: agreementData.next_renewal_date || computedRenewalDate,
        workflow_status: 'draft' as const,
        provider_message: options?.providerMessage || null,
      } as any)
      .select()
      .single();

    if (agreementError) throw agreementError;

    // Step 2: Add providers
    if (providers.length > 0) {
      const providerInserts = providers.map(provider => ({
        agreement_id: agreement.id,
        provider_id: provider.id || null,
        provider_name: provider.name,
        provider_email: provider.email,
        provider_npi: provider.npi || null,
      }));

      const { error: providersError } = await supabase
        .from('agreement_providers')
        .insert(providerInserts);

      if (providersError) throw providersError;
    }

    // Step 3: Check if there's an active transfer with initiation tasks for this physician+state
    let hasTransferInitiationTasks = false;
    if (agreementData.physician_id && agreementData.state_abbreviation) {
      const { data: transferTasks } = await supabase
        .from('agreement_tasks')
        .select('id, transfer_id')
        .eq('auto_trigger', 'transfer_initiation')
        .eq('physician_id', agreementData.physician_id)
        .eq('state_abbreviation', agreementData.state_abbreviation)
        .limit(1);

      if (transferTasks && transferTasks.length > 0) {
        hasTransferInitiationTasks = true;
        // Re-parent these transfer initiation tasks to the new agreement
        const transferId = transferTasks[0].transfer_id;
        if (transferId) {
          await supabase
            .from('agreement_tasks')
            .update({ agreement_id: agreement.id })
            .eq('transfer_id', transferId)
            .eq('auto_trigger', 'transfer_initiation');

          // Also link the transfer to this new agreement
          await supabase
            .from('agreement_transfers')
            .update({ target_agreement_id: agreement.id })
            .eq('id', transferId);
        }
      }
    }

    // Only generate setup tasks if no transfer already created initiation tasks
    if (!hasTransferInitiationTasks) {
      const setupTasks = getSetupTasks(
        agreement.id,
        agreementData.state_abbreviation,
        agreementData.state_name,
        providers[0]?.id || null,
        agreementData.physician_id || null,
        options
      );

      const { data: createdTasks, error: tasksError } = await supabase
        .from('agreement_tasks')
        .insert(setupTasks)
        .select();

      if (tasksError) throw tasksError;

      // Auto-link providers to tasks
      if (createdTasks && createdTasks.length > 0) {
        const links: { task_id: string; provider_id: string; role_label: string }[] = [];
        for (const task of createdTasks) {
          for (const p of providers) {
            if (p.id) links.push({ task_id: task.id, provider_id: p.id, role_label: 'NP' });
          }
          if (agreementData.physician_id) {
            links.push({ task_id: task.id, provider_id: agreementData.physician_id, role_label: 'Physician' });
          }
        }
        if (links.length > 0) {
          await supabase.from('task_linked_providers').insert(links);
        }
      }
    }


    // Step 4: Create workflow steps
    const workflowSteps = [
      { step_number: 1, step_name: 'Agreement Created', step_description: 'Initial agreement draft created', status: 'completed', agreement_id: agreement.id, completed_at: new Date().toISOString() },
      { step_number: 2, step_name: 'In Progress', step_description: 'Required setup tasks in progress', status: 'in_progress', agreement_id: agreement.id },
      { step_number: 3, step_name: 'Pending Signatures', step_description: 'Awaiting all party signatures', status: 'pending', agreement_id: agreement.id },
      { step_number: 4, step_name: 'Pending Verification', step_description: 'Admin verification required', status: 'pending', agreement_id: agreement.id },
      { step_number: 5, step_name: 'Active', step_description: 'Agreement is active and in effect', status: 'pending', agreement_id: agreement.id },
    ];

    await supabase.from('agreement_workflow_steps').insert(workflowSteps);

    // Step 5: Transition to in_progress (NOT active)
    await supabase
      .from('collaborative_agreements')
      .update({ workflow_status: 'in_progress' })
      .eq('id', agreement.id);

    // Step 6: Log creation
    await supabase.from('agreement_audit_log').insert({
      entity_type: 'agreement',
      entity_id: agreement.id,
      action: 'agreement_created',
      changes: {
        state: agreementData.state_abbreviation,
        reused_transfer_tasks: hasTransferInitiationTasks,
        initial_status: 'in_progress',
      },
    });

    return agreement;
  }, []);

  /**
   * Initiate termination with task generation.
   */
  const initiateTermination = useCallback(async (
    agreementId: string,
    agreement: Tables<'collaborative_agreements'>,
    reason: string,
    adminId?: string
  ) => {
    // Check if an active transfer already has termination tasks for this agreement
    const { data: existingTransferTasks } = await supabase
      .from('agreement_tasks')
      .select('id')
      .eq('agreement_id', agreementId)
      .eq('auto_trigger', 'transfer_termination')
      .limit(1);

    const hasTransferTerminationTasks = existingTransferTasks && existingTransferTasks.length > 0;

    // Step 1: Set to pending termination
    const { error: statusError } = await supabase
      .from('collaborative_agreements')
      .update({
        workflow_status: 'termination_initiated',
        termination_reason: reason,
      })
      .eq('id', agreementId);

    if (statusError) throw statusError;

    let taskCount = 0;

    // Step 2: Only generate termination tasks if no transfer already created them
    if (!hasTransferTerminationTasks) {
      const terminationTasks = getTerminationTasks(
        agreementId,
        agreement.state_abbreviation,
        agreement.state_name,
        null,
        agreement.physician_id
      );

      const { error: tasksError } = await supabase
        .from('agreement_tasks')
        .insert(terminationTasks);

      if (tasksError) throw tasksError;
      taskCount = terminationTasks.length;
    } else {
      // Count existing transfer termination tasks as "generated"
      taskCount = existingTransferTasks.length;
    }

    // Step 3: Log
    await supabase.from('agreement_audit_log').insert({
      entity_type: 'agreement',
      entity_id: agreementId,
      action: 'termination_initiated',
      performed_by: adminId || null,
      changes: {
        reason,
        tasks_generated: taskCount,
        reused_transfer_tasks: hasTransferTerminationTasks,
      },
    });

    return taskCount;
  }, []);

  return {
    createAgreementWithTasks,
    advanceStatus,
    checkTasksComplete,
    initiateTermination,
  };
};