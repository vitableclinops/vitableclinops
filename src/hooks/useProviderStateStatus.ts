import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables, Enums } from '@/integrations/supabase/types';

export type ProviderStateStatus = Tables<'provider_state_status'>;
export type ReadinessStatus = Enums<'readiness_status'>;
export type EhrActivationStatus = Enums<'ehr_activation_status'>;
export type MismatchType = Enums<'mismatch_type'>;

interface EvaluatedReadiness {
  status: ReadinessStatus;
  reason: string | null;
  mismatchType: MismatchType;
}

// Evaluate readiness based on license and collab agreement status
export async function evaluateReadiness(
  providerId: string,
  stateAbbreviation: string
): Promise<EvaluatedReadiness> {
  const today = new Date().toISOString().split('T')[0];

  // Fetch provider license for this state
  const { data: license } = await supabase
    .from('provider_licenses')
    .select('*')
    .eq('profile_id', providerId)
    .eq('state_abbreviation', stateAbbreviation)
    .maybeSingle();

  // Fetch state compliance requirements
  const { data: stateReqs } = await supabase
    .from('state_compliance_requirements')
    .select('*')
    .eq('state_abbreviation', stateAbbreviation)
    .maybeSingle();

  // Fetch active collab agreement for this provider-state
  const { data: agreements } = await supabase
    .from('agreement_providers')
    .select(`
      *,
      agreement:agreement_id (
        id,
        workflow_status,
        end_date,
        state_abbreviation
      )
    `)
    .eq('provider_id', providerId)
    .eq('is_active', true);

  const stateAgreement = agreements?.find(
    a => a.agreement?.state_abbreviation === stateAbbreviation
  );

  // Check license validity
  const hasValidLicense = license && 
    (license.status === 'active' || license.status === 'verified') &&
    (!license.expiration_date || license.expiration_date >= today);

  const licenseExpired = license?.expiration_date && license.expiration_date < today;

  // Check if collab is required (based on state requirements or license flag)
  const collabRequired = stateReqs?.collab_requirement_type === 'always' || 
    license?.requires_collab_agreement === true;

  // Check collab agreement validity
  const hasValidCollab = stateAgreement?.agreement?.workflow_status === 'active' &&
    (!stateAgreement.agreement.end_date || stateAgreement.agreement.end_date >= today);

  const collabExpired = stateAgreement?.agreement?.end_date && 
    stateAgreement.agreement.end_date < today;

  // Build readiness evaluation
  const reasons: string[] = [];
  let status: ReadinessStatus = 'ready';

  if (!license) {
    reasons.push('No license on file');
    status = 'not_ready';
  } else if (licenseExpired) {
    reasons.push('License expired');
    status = 'not_ready';
  } else if (license.status !== 'active' && license.status !== 'verified') {
    reasons.push(`License status: ${license.status}`);
    status = 'not_ready';
  }

  if (collabRequired) {
    if (!stateAgreement) {
      reasons.push('Missing collaborative agreement');
      status = 'not_ready';
    } else if (collabExpired) {
      reasons.push('Collaborative agreement expired');
      status = 'not_ready';
    } else if (stateAgreement.agreement?.workflow_status !== 'active') {
      reasons.push(`Collab agreement status: ${stateAgreement.agreement?.workflow_status}`);
      status = status === 'ready' ? 'at_risk' : status;
    }
  }

  // Check for approaching expirations (at_risk)
  if (status === 'ready' && license?.expiration_date) {
    const expirationDate = new Date(license.expiration_date);
    const daysUntilExpiration = Math.ceil(
      (expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntilExpiration <= 30) {
      reasons.push(`License expires in ${daysUntilExpiration} days`);
      status = 'at_risk';
    }
  }

  // Determine mismatch type (will be set properly with current activation status)
  let mismatchType: MismatchType = 'none';
  if (licenseExpired) {
    mismatchType = 'expired_license_but_active'; // Will be checked with activation
  } else if (collabRequired && collabExpired) {
    mismatchType = 'expired_collab_but_active'; // Will be checked with activation
  }

  return {
    status,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
    mismatchType,
  };
}

// Hook to fetch all provider state statuses (with optional filters)
export function useProviderStateStatuses(filters?: {
  providerId?: string;
  stateAbbreviation?: string;
  mismatchOnly?: boolean;
  activationStatus?: EhrActivationStatus;
}) {
  return useQuery({
    queryKey: ['provider-state-status', filters],
    queryFn: async () => {
      let query = supabase.from('provider_state_status').select('*');

      if (filters?.providerId) {
        query = query.eq('provider_id', filters.providerId);
      }
      if (filters?.stateAbbreviation) {
        query = query.eq('state_abbreviation', filters.stateAbbreviation);
      }
      if (filters?.mismatchOnly) {
        query = query.neq('mismatch_type', 'none');
      }
      if (filters?.activationStatus) {
        query = query.eq('ehr_activation_status', filters.activationStatus);
      }

      const { data, error } = await query.order('updated_at', { ascending: false });
      if (error) throw error;
      return data as ProviderStateStatus[];
    },
  });
}

// Hook to update activation status with audit trail
export function useUpdateActivationStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      providerId,
      stateAbbreviation,
      newStatus,
      notes,
      effectiveDate,
      evidenceLink,
    }: {
      providerId: string;
      stateAbbreviation: string;
      newStatus: EhrActivationStatus;
      notes: string;
      effectiveDate?: string;
      evidenceLink?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id)
        .maybeSingle();

      // Get current status
      const { data: current } = await supabase
        .from('provider_state_status')
        .select('*')
        .eq('provider_id', providerId)
        .eq('state_abbreviation', stateAbbreviation)
        .maybeSingle();

      const previousStatus = current?.ehr_activation_status || 'inactive';

      // Evaluate readiness
      const readinessEval = await evaluateReadiness(providerId, stateAbbreviation);

      // Determine mismatch
      let mismatchType: MismatchType = 'none';
      if (newStatus === 'active' && readinessEval.status === 'not_ready') {
        if (readinessEval.reason?.includes('License expired')) {
          mismatchType = 'expired_license_but_active';
        } else if (readinessEval.reason?.includes('agreement expired')) {
          mismatchType = 'expired_collab_but_active';
        } else {
          mismatchType = 'active_but_not_ready';
        }
      } else if (
        (newStatus === 'inactive' || newStatus === 'deactivated') && 
        readinessEval.status === 'ready'
      ) {
        mismatchType = 'ready_but_inactive';
      }

      const updateData: Partial<Tables<'provider_state_status'>> = {
        ehr_activation_status: newStatus,
        activation_notes: notes,
        readiness_status: readinessEval.status,
        readiness_reason: readinessEval.reason,
        readiness_last_evaluated_at: new Date().toISOString(),
        mismatch_type: mismatchType,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'active') {
        updateData.ehr_activated_at = new Date().toISOString();
        updateData.ehr_activated_by = user?.id;
        if (effectiveDate) updateData.activation_effective_date = effectiveDate;
      } else if (newStatus === 'deactivated') {
        updateData.ehr_deactivated_at = new Date().toISOString();
        updateData.ehr_deactivated_by = user?.id;
        if (effectiveDate) updateData.deactivation_effective_date = effectiveDate;
      }

      // Upsert the status
      const { error: upsertError } = await supabase
        .from('provider_state_status')
        .upsert({
          provider_id: providerId,
          state_abbreviation: stateAbbreviation,
          ...updateData,
        }, {
          onConflict: 'provider_id,state_abbreviation',
        });

      if (upsertError) throw upsertError;

      // Log the event
      const eventType = newStatus === 'active' ? 'activated' :
        newStatus === 'deactivated' ? 'deactivated' :
        newStatus === 'activation_requested' ? 'requested_activation' :
        newStatus === 'deactivation_requested' ? 'requested_deactivation' : 'status_changed';

      await supabase.from('ehr_activation_events').insert({
        provider_id: providerId,
        state_abbreviation: stateAbbreviation,
        event_type: eventType,
        previous_status: previousStatus,
        new_status: newStatus,
        actor_id: user?.id,
        actor_name: profile?.full_name || user?.email || 'Unknown',
        notes,
        evidence_link: evidenceLink,
      });

      return { providerId, stateAbbreviation, newStatus };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-state-status'] });
      toast({ title: 'Activation status updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating status',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Hook to set readiness override
export function useSetReadinessOverride() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      providerId,
      stateAbbreviation,
      override,
      reason,
      expiresAt,
    }: {
      providerId: string;
      stateAbbreviation: string;
      override: boolean;
      reason?: string;
      expiresAt?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id)
        .maybeSingle();

      const { error } = await supabase
        .from('provider_state_status')
        .upsert({
          provider_id: providerId,
          state_abbreviation: stateAbbreviation,
          readiness_override: override,
          override_reason: reason,
          override_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'provider_id,state_abbreviation',
        });

      if (error) throw error;

      // Log the override event
      await supabase.from('ehr_activation_events').insert({
        provider_id: providerId,
        state_abbreviation: stateAbbreviation,
        event_type: 'override_readiness',
        previous_status: null,
        new_status: override ? 'override_active' : 'override_removed',
        actor_id: user?.id,
        actor_name: profile?.full_name || user?.email || 'Unknown',
        notes: reason,
      });

      return { providerId, stateAbbreviation, override };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-state-status'] });
      toast({ title: 'Readiness override updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error setting override',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Hook to fetch activation events for audit trail
export function useActivationEvents(providerId?: string, stateAbbreviation?: string) {
  return useQuery({
    queryKey: ['ehr-activation-events', providerId, stateAbbreviation],
    queryFn: async () => {
      let query = supabase
        .from('ehr_activation_events')
        .select('*')
        .order('created_at', { ascending: false });

      if (providerId) {
        query = query.eq('provider_id', providerId);
      }
      if (stateAbbreviation) {
        query = query.eq('state_abbreviation', stateAbbreviation);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!providerId || !!stateAbbreviation,
  });
}

// Hook to get aggregated stats for dashboard
export function useActivationStats() {
  return useQuery({
    queryKey: ['activation-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_state_status')
        .select('readiness_status, ehr_activation_status, mismatch_type');

      if (error) throw error;

      const stats = {
        activeAndReady: 0,
        activeButNotReady: 0,
        inactiveAndReady: 0,
        activationRequested: 0,
        deactivationRequested: 0,
        overridesExpiringSoon: 0,
        total: data?.length || 0,
        byMismatch: {} as Record<string, number>,
        byReadinessReason: {} as Record<string, number>,
      };

      data?.forEach(row => {
        if (row.ehr_activation_status === 'active' && row.readiness_status === 'ready') {
          stats.activeAndReady++;
        }
        if (row.ehr_activation_status === 'active' && row.readiness_status !== 'ready') {
          stats.activeButNotReady++;
        }
        if ((row.ehr_activation_status === 'inactive' || row.ehr_activation_status === 'deactivated') && row.readiness_status === 'ready') {
          stats.inactiveAndReady++;
        }
        if (row.ehr_activation_status === 'activation_requested') {
          stats.activationRequested++;
        }
        if (row.ehr_activation_status === 'deactivation_requested') {
          stats.deactivationRequested++;
        }
        if (row.mismatch_type && row.mismatch_type !== 'none') {
          stats.byMismatch[row.mismatch_type] = (stats.byMismatch[row.mismatch_type] || 0) + 1;
        }
      });

      return stats;
    },
  });
}
