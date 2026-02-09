import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ComplianceStatus = 'compliant' | 'at_risk' | 'non_compliant' | 'active_but_non_compliant' | 'unknown';

export interface ComplianceRecord {
  provider_id: string;
  provider_name: string;
  state_abbreviation: string;
  compliance_status: ComplianceStatus;
  compliance_reason: string | null;
  employment_type: string | null;
  ehr_activation_status: string | null;
  readiness_status: string | null;
  license_status: string | null;
  license_expiration: string | null;
  collab_required: boolean;
  collab_status: string | null;
}

export interface ComplianceRiskSummary {
  total: number;
  compliant: number;
  at_risk: number;
  non_compliant: number;
  active_but_non_compliant: number;
}

// Compute compliance status from existing data
export function useComplianceRiskSummary() {
  return useQuery({
    queryKey: ['compliance-risk-summary'],
    queryFn: async () => {
      // Get W2 providers only (agency providers excluded from compliance tracking)
      const { data: providers } = await supabase
        .from('profiles')
        .select('id, full_name, employment_type, employment_status')
        .or('employment_type.eq.w2,employment_type.is.null')
        .or('employment_status.eq.active,employment_status.is.null');

      const { data: statuses } = await supabase
        .from('provider_state_status')
        .select('*');

      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('profile_id, state_abbreviation, status, expiration_date');

      // Get state compliance rules for collab requirements
      const { data: stateRules } = await supabase
        .from('state_compliance_requirements')
        .select('state_abbreviation, ca_required');

      // Get active collaborative agreements
      const { data: agreements } = await supabase
        .from('collaborative_agreements')
        .select('id, physician_id, state_abbreviation, workflow_status, start_date, end_date, terminated_at')
        .in('workflow_status', ['active', 'pending_renewal']);

      // Get agreement providers to link providers to agreements
      const { data: agreementProviders } = await supabase
        .from('agreement_providers')
        .select('agreement_id, provider_id, is_active');

      if (!providers) return { total: 0, compliant: 0, at_risk: 0, non_compliant: 0, active_but_non_compliant: 0, records: [] } as ComplianceRiskSummary & { records: ComplianceRecord[] };

      const today = new Date().toISOString().split('T')[0];
      const records: ComplianceRecord[] = [];
      const summary: ComplianceRiskSummary = { total: 0, compliant: 0, at_risk: 0, non_compliant: 0, active_but_non_compliant: 0 };

      const providerIds = new Set(providers.map(p => p.id));
      const stateRulesMap = new Map(stateRules?.map(r => [r.state_abbreviation, r]) || []);

      // Build a map of provider+state -> has active collab agreement
      const providerStateCollabMap = new Map<string, boolean>();
      if (agreementProviders && agreements) {
        for (const ap of agreementProviders) {
          if (!ap.is_active || !ap.provider_id) continue;
          const agreement = agreements.find(a => a.id === ap.agreement_id);
          if (!agreement) continue;
          if (agreement.terminated_at) continue;
          if (agreement.workflow_status === 'active' || agreement.workflow_status === 'pending_renewal') {
            const key = `${ap.provider_id}:${agreement.state_abbreviation}`;
            providerStateCollabMap.set(key, true);
          }
        }
      }

      statuses?.forEach(status => {
        if (!providerIds.has(status.provider_id)) return;

        const provider = providers.find(p => p.id === status.provider_id);
        const license = licenses?.find(l => l.profile_id === status.provider_id && l.state_abbreviation === status.state_abbreviation);
        const stateRule = stateRulesMap.get(status.state_abbreviation);

        let complianceStatus: ComplianceStatus = 'unknown';
        const reasons: string[] = [];

        // Check license
        if (!license || (license.status !== 'active' && license.status !== 'verified')) {
          reasons.push('Missing or invalid license');
          complianceStatus = 'non_compliant';
        } else if (license.expiration_date && license.expiration_date < today) {
          reasons.push('License expired');
          complianceStatus = 'non_compliant';
        } else if (license.expiration_date) {
          const daysLeft = Math.ceil((new Date(license.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 30) {
            reasons.push(`License expires in ${daysLeft} days`);
            complianceStatus = 'at_risk';
          }
        }

        // Check collaborative agreement requirement
        const collabRequired = stateRule?.ca_required === true;
        if (collabRequired) {
          const collabKey = `${status.provider_id}:${status.state_abbreviation}`;
          const hasActiveCollab = providerStateCollabMap.get(collabKey) || false;
          if (!hasActiveCollab) {
            reasons.push('Missing collaborative agreement (required by state)');
            if (complianceStatus !== 'non_compliant') {
              complianceStatus = 'non_compliant';
            }
          }
        }

        // Check activation mismatch
        if (status.ehr_activation_status === 'active' && (complianceStatus === 'non_compliant')) {
          complianceStatus = 'active_but_non_compliant';
        }

        if (complianceStatus === 'unknown') complianceStatus = 'compliant';

        summary.total++;
        summary[complianceStatus === 'active_but_non_compliant' ? 'active_but_non_compliant' : complianceStatus]++;

        records.push({
          provider_id: status.provider_id,
          provider_name: provider?.full_name || 'Unknown',
          state_abbreviation: status.state_abbreviation,
          compliance_status: complianceStatus,
          compliance_reason: reasons.join('; ') || null,
          employment_type: provider?.employment_type || null,
          ehr_activation_status: status.ehr_activation_status,
          readiness_status: status.readiness_status,
          license_status: license?.status || null,
          license_expiration: license?.expiration_date || null,
          collab_required: collabRequired,
          collab_status: collabRequired
            ? (providerStateCollabMap.get(`${status.provider_id}:${status.state_abbreviation}`) ? 'active' : 'missing')
            : null,
        });
      });

      // Sort: active_but_non_compliant first
      records.sort((a, b) => {
        const order: Record<ComplianceStatus, number> = { active_but_non_compliant: 0, non_compliant: 1, at_risk: 2, compliant: 3, unknown: 4 };
        return order[a.compliance_status] - order[b.compliance_status];
      });

      return { ...summary, records };
    },
  });
}
