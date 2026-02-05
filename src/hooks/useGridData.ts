import { useMemo } from 'react';
import { providers, states, collaborativeAgreements } from '@/data/mockData';
import type { GridData, GridCell, LicensureStatus, CredentialingStatus, CredentialingRequirement, CellStatus } from '@/types/grid';

// Calculate days until a date
function daysUntil(date: Date): number {
  const now = new Date();
  const target = new Date(date);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Determine licensure status for a provider-state pair
function calculateLicensureStatus(providerId: string, stateId: string): LicensureStatus {
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    return {
      status: 'gray',
      isActive: false,
      isExpiringSoon: false,
      isExpired: false,
      isMissing: true,
    };
  }

  const providerState = provider.states.find(ps => ps.stateId === stateId);
  if (!providerState) {
    return {
      status: 'gray',
      isActive: false,
      isExpiringSoon: false,
      isExpired: false,
      isMissing: true,
    };
  }

  const activeLicense = providerState.licenses.find(l => l.status === 'active');
  if (!activeLicense) {
    const expiredLicense = providerState.licenses.find(l => l.status === 'expired');
    if (expiredLicense) {
      return {
        status: 'red',
        licenseNumber: expiredLicense.licenseNumber,
        expirationDate: expiredLicense.expirationDate,
        daysUntilExpiry: expiredLicense.expirationDate ? daysUntil(expiredLicense.expirationDate) : undefined,
        isActive: false,
        isExpiringSoon: false,
        isExpired: true,
        isMissing: false,
      };
    }
    return {
      status: 'red',
      isActive: false,
      isExpiringSoon: false,
      isExpired: false,
      isMissing: true,
    };
  }

  const daysUntilExpiry = activeLicense.expirationDate ? daysUntil(activeLicense.expirationDate) : undefined;
  const isExpiringSoon = daysUntilExpiry !== undefined && daysUntilExpiry <= 60 && daysUntilExpiry > 0;
  const isExpired = daysUntilExpiry !== undefined && daysUntilExpiry <= 0;

  return {
    status: isExpired ? 'red' : isExpiringSoon ? 'yellow' : 'green',
    licenseNumber: activeLicense.licenseNumber,
    expirationDate: activeLicense.expirationDate,
    daysUntilExpiry,
    isActive: !isExpired,
    isExpiringSoon,
    isExpired,
    isMissing: false,
  };
}

// Determine credentialing status for a provider-state pair
function calculateCredentialingStatus(providerId: string, stateId: string): CredentialingStatus {
  const state = states.find(s => s.id === stateId);
  const provider = providers.find(p => p.id === providerId);
  const requirements: CredentialingRequirement[] = [];
  
  if (!state || !provider) {
    return {
      status: 'gray',
      requirements: [],
      blockers: [],
      isReady: false,
    };
  }

  // 1. Licensure requirement
  const licensure = calculateLicensureStatus(providerId, stateId);
  requirements.push({
    id: `${providerId}-${stateId}-licensure`,
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
  if (state.requiresCollaborativeAgreement) {
    const agreement = collaborativeAgreements.find(
      a => a.stateId === stateId && a.providerIds.includes(providerId)
    );
    
    let caStatus: CellStatus = 'red';
    let caStatusLabel = 'No agreement on file';
    let caBlocker = true;
    let caBlockerReason = 'Missing collaborative agreement';
    
    if (agreement) {
      if (agreement.status === 'active') {
        const daysToRenewal = daysUntil(agreement.nextRenewalDate);
        if (daysToRenewal <= 30) {
          caStatus = 'yellow';
          caStatusLabel = `Renewal due in ${daysToRenewal} days`;
          caBlocker = false;
        } else {
          caStatus = 'green';
          caStatusLabel = 'Active agreement';
          caBlocker = false;
        }
      } else if (agreement.status === 'pending_renewal') {
        caStatus = 'yellow';
        caStatusLabel = 'Pending renewal';
        caBlocker = false;
      } else if (agreement.status === 'draft') {
        caStatus = 'yellow';
        caStatusLabel = 'Draft - pending signatures';
        caBlocker = true;
        caBlockerReason = 'Agreement pending signatures';
      }
    }

    requirements.push({
      id: `${providerId}-${stateId}-ca`,
      type: 'collaborative_agreement',
      label: 'Collaborative Agreement',
      status: caStatus,
      statusLabel: caStatusLabel,
      detail: agreement ? `With Dr. ${agreement.physician?.firstName || 'Unknown'}` : undefined,
      isBlocker: caBlocker,
      blockerReason: caBlocker ? caBlockerReason : undefined,
    });
  }

  // 3. Full Practice Authority (if available and applicable)
  if (state.hasFPA) {
    const providerState = provider.states.find(ps => ps.stateId === stateId);
    // Simulate FPA status based on provider state data
    const hasFPA = providerState?.licenses.some(l => l.type === 'fpa' && l.status === 'active');
    
    requirements.push({
      id: `${providerId}-${stateId}-fpa`,
      type: 'fpa',
      label: 'Full Practice Authority',
      status: hasFPA ? 'green' : 'yellow',
      statusLabel: hasFPA ? 'FPA granted' : 'FPA not yet obtained',
      detail: state.fpaEligibilityCriteria?.[0],
      isBlocker: false, // FPA is optional if CA is in place
    });
  }

  // 4. Prescriptive Authority (if required)
  if (state.requiresPrescriptiveAuthority) {
    const providerState = provider.states.find(ps => ps.stateId === stateId);
    const hasPrescriptive = providerState?.licenses.some(
      l => l.type === 'prescriptive_authority' && l.status === 'active'
    );

    requirements.push({
      id: `${providerId}-${stateId}-prescriptive`,
      type: 'prescriptive_authority',
      label: 'Prescriptive Authority',
      status: hasPrescriptive ? 'green' : 'red',
      statusLabel: hasPrescriptive ? 'Active' : 'Not obtained',
      detail: state.prescriptiveAuthorityNotes,
      isBlocker: !hasPrescriptive,
      blockerReason: !hasPrescriptive ? 'Missing prescriptive authority' : undefined,
    });
  }

  // 5. Compliance tasks
  const complianceComplete = provider.complianceStatus?.isCompliant ?? false;
  const overdueCount = provider.complianceStatus?.overdueTasks ?? 0;

  requirements.push({
    id: `${providerId}-${stateId}-compliance`,
    type: 'compliance',
    label: 'Compliance Tasks',
    status: complianceComplete ? 'green' : overdueCount > 0 ? 'red' : 'yellow',
    statusLabel: complianceComplete 
      ? 'All complete' 
      : overdueCount > 0 
        ? `${overdueCount} overdue` 
        : 'In progress',
    isBlocker: overdueCount > 0,
    blockerReason: overdueCount > 0 ? `${overdueCount} overdue compliance tasks` : undefined,
  });

  // 6. Supervision (if agreement requires meetings)
  if (state.requiresCollaborativeAgreement && state.collaborativeAgreementRequirements) {
    const cadence = state.collaborativeAgreementRequirements.meetingCadence;
    // Simulate meeting status - in real app this would come from supervision_meetings table
    const meetingStatusRandom = Math.random();
    const meetingStatus: CellStatus = meetingStatusRandom > 0.85 ? 'red' : meetingStatusRandom > 0.7 ? 'yellow' : 'green';
    
    requirements.push({
      id: `${providerId}-${stateId}-supervision`,
      type: 'supervision',
      label: 'Supervision Meetings',
      status: meetingStatus,
      statusLabel: meetingStatus === 'green' ? 'Up to date' : meetingStatus === 'yellow' ? 'Meeting due soon' : 'Meeting overdue',
      detail: `Required: ${cadence}`,
      isBlocker: meetingStatus === 'red',
      blockerReason: meetingStatus === 'red' ? 'Supervision meeting overdue' : undefined,
    });
  }

  // Calculate overall status - most restrictive
  const blockers = requirements.filter(r => r.isBlocker);
  const hasRed = requirements.some(r => r.status === 'red');
  const hasYellow = requirements.some(r => r.status === 'yellow');
  
  let overallStatus: CellStatus = 'green';
  if (hasRed || blockers.length > 0) {
    overallStatus = 'red';
  } else if (hasYellow) {
    overallStatus = 'yellow';
  }

  return {
    status: overallStatus,
    requirements,
    blockers,
    isReady: overallStatus === 'green' && blockers.length === 0,
  };
}

export function useGridData(): GridData {
  return useMemo(() => {
    const cells = new Map<string, GridCell>();

    // Build cells for each provider-state combination
    providers.forEach((provider) => {
      states.forEach((state) => {
        const key = `${provider.id}-${state.id}`;
        cells.set(key, {
          providerId: provider.id,
          stateId: state.id,
          licensure: calculateLicensureStatus(provider.id, state.id),
          credentialing: calculateCredentialingStatus(provider.id, state.id),
        });
      });
    });

    return {
      providers: providers.map(p => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        email: p.email,
        providerType: p.providerType,
        credentials: p.specialty,
      })),
      states: states.map(s => ({
        id: s.id,
        name: s.name,
        abbreviation: s.abbreviation,
        demandTag: s.demandTag,
        requiresCollaborativeAgreement: s.requiresCollaborativeAgreement,
        hasFPA: s.hasFPA,
        requiresPrescriptiveAuthority: s.requiresPrescriptiveAuthority,
      })),
      cells,
    };
  }, []);
}
