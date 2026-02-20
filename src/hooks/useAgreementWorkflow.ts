import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

type AgreementTask = Tables<'agreement_tasks'>;
type AgreementTaskInsert = TablesInsert<'agreement_tasks'>;
type WorkflowStatus = Tables<'collaborative_agreements'>['workflow_status'];

/**
 * Generates the full set of required setup tasks for a new collaborative agreement.
 */
export const getSetupTasks = (
  agreementId: string,
  stateAbbreviation: string,
  stateName: string,
  providerId: string | null,
  physicianId: string | null,
  options?: { chartReviewRequired?: boolean; meetingCadence?: string }
): AgreementTaskInsert[] => {
  const tasks: AgreementTaskInsert[] = [
    {
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Confirm collaborative agreement required for state',
      description: `Verify that ${stateName} requires a collaborative agreement for this provider type`,
      category: 'agreement_creation',
      status: 'pending',
      priority: 'high',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Ensures we are not creating unnecessary agreements',
      compliance_risk: 'Creating agreements for states that do not require them wastes resources',
      expected_outcome: 'Confirmed that state requires collaborative agreement',
      sort_order: 1,
    },
    {
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Send agreement to provider for signature',
      description: 'Send the collaborative agreement document to the provider for review and signature',
      category: 'signature',
      status: 'pending',
      priority: 'high',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Provider must review and sign the agreement',
      compliance_risk: 'Provider cannot practice without a signed agreement',
      expected_outcome: 'Provider has received and reviewed the agreement',
      sort_order: 2,
    },
    {
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Send agreement to physician for signature',
      description: 'Send the collaborative agreement document to the supervising physician for review and signature',
      category: 'signature',
      status: 'pending',
      priority: 'high',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Physician must review and sign the agreement',
      compliance_risk: 'Agreement is not valid without physician signature',
      expected_outcome: 'Physician has received and reviewed the agreement',
      sort_order: 3,
    },
    {
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Receive signed agreement from all parties',
      description: 'Collect the fully executed agreement with all required signatures',
      category: 'signature',
      status: 'pending',
      priority: 'high',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Agreement must be fully signed before it is valid',
      compliance_risk: 'Unsigned agreements have no legal standing',
      expected_outcome: 'Fully executed agreement document obtained',
      sort_order: 4,
    },
    {
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Upload signed agreement to record',
      description: 'Upload the signed agreement document and link it to this agreement record',
      category: 'agreement_creation',
      status: 'pending',
      priority: 'high',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Signed agreement must be on file for audit purposes',
      compliance_risk: 'Missing documentation during audit can result in compliance violations',
      expected_outcome: 'Signed agreement document is linked to this record',
      sort_order: 5,
    },
  ];

  // Conditional tasks based on state requirements
  if (options?.meetingCadence && options.meetingCadence !== 'none') {
    tasks.push({
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Schedule required supervision meeting',
      description: `Schedule the first supervision meeting per the ${options.meetingCadence} cadence requirement`,
      category: 'supervision_meeting',
      status: 'pending',
      priority: 'medium',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Supervision meetings are required by the state',
      compliance_risk: 'Missing meetings can result in non-compliance',
      expected_outcome: 'First supervision meeting is scheduled',
      sort_order: 6,
    });
  }

  if (options?.chartReviewRequired) {
    tasks.push({
      agreement_id: agreementId,
      provider_id: providerId,
      physician_id: physicianId,
      title: 'Link chart review / supervision documentation',
      description: 'Set up and link the chart review folder for ongoing supervision documentation',
      category: 'chart_review',
      status: 'pending',
      priority: 'medium',
      assigned_role: 'admin',
      is_auto_generated: true,
      is_required: true,
      auto_trigger: 'agreement_creation',
      state_abbreviation: stateAbbreviation,
      state_name: stateName,
      task_purpose: 'Chart review documentation must be maintained',
      compliance_risk: 'Missing chart reviews can result in audit findings',
      expected_outcome: 'Chart review folder is linked and accessible',
      sort_order: 7,
    });
  }

  return tasks;
};

/**
 * Generates termination tasks for an agreement.
 */
export const getTerminationTasks = (
  agreementId: string,
  stateAbbreviation: string,
  stateName: string,
  providerId: string | null,
  physicianId: string | null
): AgreementTaskInsert[] => [
  {
    agreement_id: agreementId,
    provider_id: providerId,
    physician_id: physicianId,
    title: 'Notify provider of termination',
    description: 'Send formal termination notice to the provider',
    category: 'termination',
    status: 'pending',
    priority: 'urgent',
    assigned_role: 'admin',
    is_auto_generated: true,
    is_required: true,
    auto_trigger: 'agreement_termination',
    state_abbreviation: stateAbbreviation,
    state_name: stateName,
    task_purpose: 'Provider must be formally notified of termination',
    compliance_risk: 'Provider may continue practicing without valid agreement',
    expected_outcome: 'Provider has been notified and acknowledged termination',
    sort_order: 1,
  },
  {
    agreement_id: agreementId,
    provider_id: providerId,
    physician_id: physicianId,
    title: 'Notify physician of termination',
    description: 'Send formal termination notice to the supervising physician',
    category: 'termination',
    status: 'pending',
    priority: 'urgent',
    assigned_role: 'admin',
    is_auto_generated: true,
    is_required: true,
    auto_trigger: 'agreement_termination',
    state_abbreviation: stateAbbreviation,
    state_name: stateName,
    task_purpose: 'Physician must be formally notified of termination',
    compliance_risk: 'Physician may be unaware supervision has ended',
    expected_outcome: 'Physician has been notified and acknowledged termination',
    sort_order: 2,
  },
  {
    agreement_id: agreementId,
    provider_id: providerId,
    physician_id: physicianId,
    title: 'Upload signed termination documentation',
    description: 'Upload the signed termination agreement or documentation',
    category: 'termination',
    status: 'pending',
    priority: 'high',
    assigned_role: 'admin',
    is_auto_generated: true,
    is_required: true,
    auto_trigger: 'agreement_termination',
    state_abbreviation: stateAbbreviation,
    state_name: stateName,
    task_purpose: 'Termination must be documented for audit trail',
    compliance_risk: 'Missing termination documentation during audit',
    expected_outcome: 'Signed termination document is on file',
    sort_order: 3,
  },
  {
    agreement_id: agreementId,
    provider_id: providerId,
    physician_id: physicianId,
    title: 'Confirm regulatory compliance for termination',
    description: 'Verify all regulatory requirements for termination are met, including replacement coverage if required',
    category: 'termination',
    status: 'pending',
    priority: 'urgent',
    assigned_role: 'admin',
    is_auto_generated: true,
    is_required: true,
    auto_trigger: 'agreement_termination',
    state_abbreviation: stateAbbreviation,
    state_name: stateName,
    task_purpose: 'Ensure termination does not leave provider non-compliant',
    compliance_risk: 'Provider may be practicing without required supervision',
    expected_outcome: 'All regulatory requirements for termination confirmed',
    sort_order: 4,
  },
  {
    agreement_id: agreementId,
    provider_id: providerId,
    physician_id: physicianId,
    title: 'Deactivate provider in EHR system',
    description: 'Confirm the provider has been deactivated in the EHR for this state. Must be completed before termination is finalized.',
    category: 'termination',
    status: 'pending',
    priority: 'urgent',
    assigned_role: 'admin',
    is_auto_generated: true,
    is_required: true,
    auto_trigger: 'agreement_termination',
    state_abbreviation: stateAbbreviation,
    state_name: stateName,
    task_purpose: 'Provider must be removed from EHR to prevent unauthorized practice',
    compliance_risk: 'Provider may continue seeing patients under a terminated agreement',
    expected_outcome: 'Provider deactivated in EHR and confirmation documented',
    sort_order: 5,
  },
];

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
      .eq('auto_trigger', trigger)
      .eq('is_required', true);

    if (error) throw error;

    const total = tasks?.length || 0;
    const completed = tasks?.filter(t => t.status === 'completed').length || 0;
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
          .eq('auto_trigger', 'agreement_creation')
          .eq('is_required', true)
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
    // Step 1: Create agreement in Draft
    const { data: agreement, error: agreementError } = await supabase
      .from('collaborative_agreements')
      .insert({
        ...agreementData,
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

    // Step 3: Generate required tasks
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
        tasks_generated: setupTasks.length,
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
    // Step 1: Set to pending termination
    const { error: statusError } = await supabase
      .from('collaborative_agreements')
      .update({
        workflow_status: 'termination_initiated',
        termination_reason: reason,
      })
      .eq('id', agreementId);

    if (statusError) throw statusError;

    // Step 2: Generate termination tasks
    const terminationTasks = getTerminationTasks(
      agreementId,
      agreement.state_abbreviation,
      agreement.state_name,
      null, // provider_id - will be for all providers
      agreement.physician_id
    );

    const { error: tasksError } = await supabase
      .from('agreement_tasks')
      .insert(terminationTasks);

    if (tasksError) throw tasksError;

    // Step 3: Log
    await supabase.from('agreement_audit_log').insert({
      entity_type: 'agreement',
      entity_id: agreementId,
      action: 'termination_initiated',
      performed_by: adminId || null,
      changes: {
        reason,
        tasks_generated: terminationTasks.length,
      },
    });

    return terminationTasks.length;
  }, []);

  return {
    createAgreementWithTasks,
    advanceStatus,
    checkTasksComplete,
    initiateTermination,
  };
};