export type ProviderKey = string; // normalized lowercase email or name

export interface DemandRow {
  state: string; // 2-letter
  monthlyHours: number;
}

export interface ProviderInfo {
  key: ProviderKey;
  name: string;
  email: string | null;
  profession: string; // 'NP' | 'MD' | 'DO' | 'RN' | 'LPC' | etc, best-effort
  licensedStates: Set<string>; // union of all sources
}

export interface ShiftCandidate {
  providerKey: ProviderKey;
  providerName: string;
  date: string; // YYYY-MM-DD
  startMin: number; // minutes from midnight ET
  endMin: number;
  hours: number;
  source: 'recurring' | 'one_off' | 'in_home';
  rawStart: string;
  rawEnd: string;
}

export type DeclineReason =
  | 'outside_business_hours'
  | 'state_capacity_full'
  | 'provider_unlicensed_in_needed_states'
  | 'np_state_restricted'
  | 'date_blackout'
  | 'invalid_time';

export interface AllocatedShift extends ShiftCandidate {
  acceptedHours: number;
  declinedHours: number;
  assignments: Array<{ state: string; hours: number }>;
  declineReason: DeclineReason | null;
  declineNote: string | null;
}

export interface AllocationResult {
  shifts: AllocatedShift[];
  byProvider: Map<ProviderKey, {
    info: ProviderInfo;
    accepted: AllocatedShift[];
    declined: AllocatedShift[];
    acceptedHours: number;
    declinedHours: number;
  }>;
  stateFill: Array<{ state: string; needed: number; filled: number; remaining: number }>;
  totals: { demandHours: number; acceptedHours: number; declinedHours: number };
}