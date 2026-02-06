import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { GridData, GridCell, LicensureStatus, CredentialingStatus, CellStatus, CredentialingRequirement } from '@/types/grid';

interface RealProvider {
  id: string;
  full_name: string | null;
  email: string;
  credentials: string | null;
  actively_licensed_states: string | null;
}

interface RealStateConfig {
  state_abbreviation: string;
  state_name: string;
  ca_required: boolean | null;
  fpa_status: string | null;
  ca_meeting_cadence: string | null;
}

interface RealLicense {
  profile_id: string;
  state_abbreviation: string;
  license_number: string | null;
  status: string | null;
  expiration_date: string | null;
  requires_collab_agreement: boolean | null;
}

interface RealAgreement {
  id: string;
  state_abbreviation: string;
  workflow_status: string;
  physician_name: string | null;
  next_renewal_date: string | null;
}

interface RealAgreementProvider {
  provider_id: string;
  agreement_id: string;
  is_active: boolean;
  agreement: RealAgreement | null;
}

interface ProviderStateStatus {
  provider_id: string;
  state_abbreviation: string;
  readiness_status: string;
  ehr_activation_status: string;
  readiness_reason: string | null;
  mismatch_type: string | null;
}

// Helper to calculate days until a date
function daysUntil(dateStr: string | null): number | undefined {
  if (!dateStr) return undefined;
  const now = new Date();
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function useRealGridData() {
  return useQuery({
    queryKey: ['real-grid-data'],
    queryFn: async (): Promise<GridData> => {
      // Fetch all data in parallel
      const [
        { data: providers },
        { data: stateConfigs },
        { data: licenses },
        { data: agreementProviders },
        { data: providerStateStatuses }
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, credentials, actively_licensed_states')
          .eq('employment_status', 'active')
          .order('full_name'),
        supabase
          .from('state_compliance_requirements')
          .select('state_abbreviation, state_name, ca_required, fpa_status, ca_meeting_cadence')
          .order('state_name'),
        supabase
          .from('provider_licenses')
          .select('profile_id, state_abbreviation, license_number, status, expiration_date, requires_collab_agreement'),
        supabase
          .from('agreement_providers')
          .select(`
            provider_id,
            agreement_id,
            is_active,
            agreement:agreement_id (
              id,
              state_abbreviation,
              workflow_status,
              physician_name,
              next_renewal_date
            )
          `)
          .eq('is_active', true),
        supabase
          .from('provider_state_status')
          .select('provider_id, state_abbreviation, readiness_status, ehr_activation_status, readiness_reason, mismatch_type')
      ]);

      // Build lookup maps for efficient access
      const licenseMap = new Map<string, RealLicense[]>();
      (licenses || []).forEach(lic => {
        const key = `${lic.profile_id}-${lic.state_abbreviation}`;
        if (!licenseMap.has(key)) licenseMap.set(key, []);
        licenseMap.get(key)!.push(lic as RealLicense);
      });

      const agreementMap = new Map<string, RealAgreementProvider[]>();
      (agreementProviders || []).forEach(ap => {
        const agreement = ap.agreement as unknown as RealAgreement;
        if (!agreement) return;
        const key = `${ap.provider_id}-${agreement.state_abbreviation}`;
        if (!agreementMap.has(key)) agreementMap.set(key, []);
        agreementMap.get(key)!.push({ ...ap, agreement } as RealAgreementProvider);
      });

      const statusMap = new Map<string, ProviderStateStatus>();
      (providerStateStatuses || []).forEach(status => {
        statusMap.set(`${status.provider_id}-${status.state_abbreviation}`, status as ProviderStateStatus);
      });

      // Build grid cells
      const cells = new Map<string, GridCell>();
      const stateList = (stateConfigs || []) as RealStateConfig[];
      const providerList = (providers || []) as RealProvider[];

      providerList.forEach(provider => {
        stateList.forEach(state => {
          const key = `${provider.id}-${state.state_abbreviation}`;
          const stateKey = `${provider.id}-${state.state_abbreviation}`;
          
          // Get license data
          const providerLicenses = licenseMap.get(stateKey) || [];
          const licensure = calculateLicensureStatus(providerLicenses);
          
          // Get agreement data
          const providerAgreements = agreementMap.get(stateKey) || [];
          const existingStatus = statusMap.get(stateKey);
          
          // Calculate credentialing status
          const credentialing = calculateCredentialingStatus(
            licensure,
            state,
            providerAgreements,
            existingStatus
          );

          cells.set(key, {
            providerId: provider.id,
            stateId: state.state_abbreviation,
            licensure,
            credentialing,
          });
        });
      });

      return {
        providers: providerList.map(p => ({
          id: p.id,
          name: p.full_name || p.email,
          email: p.email,
          providerType: 'NP',
          credentials: p.credentials || undefined,
        })),
        states: stateList.map(s => ({
          id: s.state_abbreviation,
          name: s.state_name,
          abbreviation: s.state_abbreviation,
          demandTag: undefined,
          requiresCollaborativeAgreement: s.ca_required ?? false,
          hasFPA: s.fpa_status === 'Autonomous' || s.fpa_status === 'No',
          requiresPrescriptiveAuthority: false,
        })),
        cells,
      };
    },
    staleTime: 30000, // 30 seconds
  });
}

function calculateLicensureStatus(licenses: RealLicense[]): LicensureStatus {
  if (licenses.length === 0) {
    return {
      status: 'gray',
      isActive: false,
      isExpiringSoon: false,
      isExpired: false,
      isMissing: true,
    };
  }

  const activeLicense = licenses.find(l => l.status === 'active');
  if (!activeLicense) {
    const expiredLicense = licenses.find(l => l.status === 'expired');
    return {
      status: 'red',
      licenseNumber: expiredLicense?.license_number || undefined,
      expirationDate: expiredLicense?.expiration_date ? new Date(expiredLicense.expiration_date) : undefined,
      daysUntilExpiry: daysUntil(expiredLicense?.expiration_date || null),
      isActive: false,
      isExpiringSoon: false,
      isExpired: true,
      isMissing: false,
    };
  }

  const daysRemaining = daysUntil(activeLicense.expiration_date);
  const isExpiringSoon = daysRemaining !== undefined && daysRemaining <= 60 && daysRemaining > 0;
  const isExpired = daysRemaining !== undefined && daysRemaining <= 0;

  return {
    status: isExpired ? 'red' : isExpiringSoon ? 'yellow' : 'green',
    licenseNumber: activeLicense.license_number || undefined,
    expirationDate: activeLicense.expiration_date ? new Date(activeLicense.expiration_date) : undefined,
    daysUntilExpiry: daysRemaining,
    isActive: !isExpired,
    isExpiringSoon,
    isExpired,
    isMissing: false,
  };
}

function calculateCredentialingStatus(
  licensure: LicensureStatus,
  state: RealStateConfig,
  agreements: RealAgreementProvider[],
  existingStatus?: ProviderStateStatus
): CredentialingStatus {
  const requirements: CredentialingRequirement[] = [];

  // 1. Licensure requirement
  requirements.push({
    id: `licensure`,
    type: 'licensure',
    label: 'State License',
    status: licensure.status,
    statusLabel: licensure.isMissing
      ? 'No license on file'
      : licensure.isExpired
        ? 'License expired'
        : licensure.isExpiringSoon
          ? `Expiring in ${licensure.daysUntilExpiry} days`
          : 'Active',
    detail: licensure.licenseNumber ? `License #${licensure.licenseNumber}` : undefined,
    isBlocker: licensure.status === 'red',
    blockerReason: licensure.isMissing ? 'Missing license' : licensure.isExpired ? 'Expired license' : undefined,
  });

  // 2. Collaborative Agreement (if required)
  if (state.ca_required) {
    const activeAgreement = agreements.find(a => 
      a.agreement?.workflow_status === 'active' && a.is_active
    );
    
    let caStatus: CellStatus = 'red';
    let caStatusLabel = 'No agreement on file';
    let caBlocker = true;
    let caBlockerReason = 'Missing collaborative agreement';
    let caDetail: string | undefined;

    if (activeAgreement?.agreement) {
      const daysToRenewal = daysUntil(activeAgreement.agreement.next_renewal_date);
      if (daysToRenewal !== undefined && daysToRenewal <= 0) {
        caStatus = 'red';
        caStatusLabel = 'Agreement expired';
        caBlocker = true;
        caBlockerReason = 'Expired collaborative agreement';
      } else if (daysToRenewal !== undefined && daysToRenewal <= 30) {
        caStatus = 'yellow';
        caStatusLabel = `Renewal due in ${daysToRenewal} days`;
        caBlocker = false;
      } else {
        caStatus = 'green';
        caStatusLabel = 'Active agreement';
        caBlocker = false;
      }
      caDetail = `With ${activeAgreement.agreement.physician_name || 'Physician'}`;
    } else {
      // Check for pending agreements
      const pendingAgreement = agreements.find(a =>
        a.agreement?.workflow_status && 
        ['draft', 'pending_signatures', 'pending_physician'].includes(a.agreement.workflow_status)
      );
      if (pendingAgreement) {
        caStatus = 'yellow';
        caStatusLabel = 'Agreement pending';
        caBlocker = true;
        caBlockerReason = 'Agreement pending signatures';
      }
    }

    requirements.push({
      id: `ca`,
      type: 'collaborative_agreement',
      label: 'Collaborative Agreement',
      status: caStatus,
      statusLabel: caStatusLabel,
      detail: caDetail,
      isBlocker: caBlocker,
      blockerReason: caBlocker ? caBlockerReason : undefined,
    });
  }

  // 3. FPA status
  if (state.fpa_status && state.fpa_status !== 'No') {
    const hasFPA = state.fpa_status === 'Autonomous' || state.fpa_status === 'No';
    requirements.push({
      id: `fpa`,
      type: 'fpa',
      label: 'Full Practice Authority',
      status: hasFPA ? 'green' : 'yellow',
      statusLabel: state.fpa_status,
      isBlocker: false,
    });
  }

  // Use existing status if available, otherwise calculate
  if (existingStatus) {
    const statusMap: Record<string, CellStatus> = {
      'ready': 'green',
      'not_ready': 'red',
      'at_risk': 'yellow',
      'blocked': 'red',
    };
    
    return {
      status: statusMap[existingStatus.readiness_status] || 'gray',
      requirements,
      blockers: requirements.filter(r => r.isBlocker),
      isReady: existingStatus.readiness_status === 'ready',
    };
  }

  // Calculate overall status
  const blockers = requirements.filter(r => r.isBlocker);
  const hasRed = requirements.some(r => r.status === 'red');
  const hasYellow = requirements.some(r => r.status === 'yellow');

  let overallStatus: CellStatus = 'green';
  if (hasRed || blockers.length > 0) {
    overallStatus = 'red';
  } else if (hasYellow) {
    overallStatus = 'yellow';
  }

  // If no license at all, it's gray (N/A)
  if (licensure.isMissing && !state.ca_required) {
    overallStatus = 'gray';
  }

  return {
    status: overallStatus,
    requirements,
    blockers,
    isReady: overallStatus === 'green' && blockers.length === 0,
  };
}
