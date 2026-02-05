import { useMemo } from 'react';

interface ProviderAgreement {
  providerId: string;
  providerName: string;
  providerEmail: string;
  stateAbbreviation: string;
  meetingMonths: number[];
}

interface StateCompliance {
  stateAbbreviation: string;
  meetingMonths: number[];
  caRequired: boolean;
}

interface InvitationResult {
  providerId: string;
  providerName: string;
  providerEmail: string;
  states: string[];
  reason: string;
}

/**
 * Determines which providers should be invited to a meeting for a given month
 * based on their state agreements and state-specific meeting cadences.
 */
export function useMeetingInvitations(
  agreements: ProviderAgreement[],
  stateCompliance: StateCompliance[],
  meetingMonth: number // 1-12
) {
  const invitations = useMemo(() => {
    // Create a map of state -> meeting months
    const stateMonthMap = new Map<string, number[]>();
    stateCompliance.forEach(sc => {
      stateMonthMap.set(sc.stateAbbreviation, sc.meetingMonths || []);
    });

    // Group agreements by provider
    const providerMap = new Map<string, {
      name: string;
      email: string;
      states: string[];
      requiredStates: string[];
    }>();

    agreements.forEach(agreement => {
      const existing = providerMap.get(agreement.providerEmail);
      const meetingMonths = stateMonthMap.get(agreement.stateAbbreviation) || [];
      const isRequired = meetingMonths.length === 0 || meetingMonths.includes(meetingMonth);

      if (existing) {
        if (!existing.states.includes(agreement.stateAbbreviation)) {
          existing.states.push(agreement.stateAbbreviation);
        }
        if (isRequired && !existing.requiredStates.includes(agreement.stateAbbreviation)) {
          existing.requiredStates.push(agreement.stateAbbreviation);
        }
      } else {
        providerMap.set(agreement.providerEmail, {
          name: agreement.providerName,
          email: agreement.providerEmail,
          states: [agreement.stateAbbreviation],
          requiredStates: isRequired ? [agreement.stateAbbreviation] : [],
        });
      }
    });

    // Build invitation list - only providers with at least one required state
    const invited: InvitationResult[] = [];
    const notInvited: InvitationResult[] = [];

    providerMap.forEach((provider, email) => {
      if (provider.requiredStates.length > 0) {
        invited.push({
          providerId: email, // Use email as ID since we may not have profile ID
          providerName: provider.name,
          providerEmail: email,
          states: provider.requiredStates,
          reason: `Required for: ${provider.requiredStates.join(', ')}`,
        });
      } else {
        notInvited.push({
          providerId: email,
          providerName: provider.name,
          providerEmail: email,
          states: provider.states,
          reason: 'No meetings required this month',
        });
      }
    });

    return { invited, notInvited };
  }, [agreements, stateCompliance, meetingMonth]);

  return invitations;
}

/**
 * Calculates if a provider needs to attend a meeting for a specific month
 * based on all their state agreements and their cadences.
 */
export function isProviderRequiredForMonth(
  providerStates: string[],
  stateMonthMap: Map<string, number[]>,
  month: number
): { required: boolean; states: string[] } {
  const requiredStates: string[] = [];

  providerStates.forEach(state => {
    const months = stateMonthMap.get(state);
    // If no months specified, default to monthly (all months)
    if (!months || months.length === 0 || months.includes(month)) {
      requiredStates.push(state);
    }
  });

  return {
    required: requiredStates.length > 0,
    states: requiredStates,
  };
}

/**
 * Generates a summary of meeting requirements for the next 12 months
 */
export function generateMeetingSchedule(
  providerStates: string[],
  stateMonthMap: Map<string, number[]>
): { month: number; monthName: string; required: boolean; states: string[] }[] {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const result = isProviderRequiredForMonth(providerStates, stateMonthMap, month);
    return {
      month,
      monthName: monthNames[i],
      ...result,
    };
  });
}