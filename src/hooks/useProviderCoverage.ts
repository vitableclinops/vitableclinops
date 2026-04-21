import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isNPProhibitedState } from '@/constants/stateRestrictions';

const PHYSICIAN_PROFESSIONS = new Set(['MD', 'DO']);
function canPracticeInState(profession: string | null | undefined, state: string): boolean {
  if (!isNPProhibitedState(state)) return true;
  return profession ? PHYSICIAN_PROFESSIONS.has(profession.toUpperCase()) : false;
}

export interface ProviderStateAllocation {
  state: string;
  allocatedHours: number;
  projectedSlots: number;
}

export interface ProviderCoverageRow {
  profileId: string;
  providerName: string;
  totalHours: number;
  totalSlots: number;
  eligibleStates: string[];
  hoursPerState: number;
  slotsPerState: number;
  stateAllocations: ProviderStateAllocation[];
}

export function useProviderCoverage(date: string) {
  return useQuery({
    queryKey: ['provider_coverage', date],
    queryFn: async (): Promise<ProviderCoverageRow[]> => {
      // 1. Get shifts for the date, joined to employees → profiles
      const dayStart = `${date}T00:00:00`;
      const dayEnd = `${date}T23:59:59`;

      const [shiftsRes, licensesRes, activeStatesRes] = await Promise.all([
        supabase
          .from('homebase_shifts')
          .select('scheduled_hours, homebase_employee_id, homebase_employees!inner(profile_id, normalized_name)')
          .gte('start_at', dayStart)
          .lte('start_at', dayEnd)
          .not('homebase_employee_id', 'is', null),
        supabase
          .from('provider_licenses')
          .select('profile_id, state_abbreviation')
          .eq('status', 'active'),
        supabase
          .from('state_activation')
          .select('state_abbreviation')
          .eq('is_active', true),
      ]);

      const shifts = (shiftsRes.data ?? []) as any[];
      const licenses = licensesRes.data ?? [];
      const activeStates = new Set((activeStatesRes.data ?? []).map((s: any) => s.state_abbreviation));

      // 2. Build license map: profileId → Set<state>
      const licenseMap = new Map<string, Set<string>>();
      for (const lic of licenses) {
        if (!lic.profile_id) continue;
        if (!licenseMap.has(lic.profile_id)) licenseMap.set(lic.profile_id, new Set());
        licenseMap.get(lic.profile_id)!.add(lic.state_abbreviation);
      }

      // 3. Aggregate hours per profile
      const profileHours = new Map<string, { totalHours: number; name: string }>();
      for (const s of shifts) {
        const emp = s.homebase_employees;
        if (!emp?.profile_id) continue;
        const hours = Number(s.scheduled_hours) || 0;
        const existing = profileHours.get(emp.profile_id);
        if (existing) {
          existing.totalHours += hours;
        } else {
          // Get profile name
          profileHours.set(emp.profile_id, {
            totalHours: hours,
            name: emp.normalized_name || 'Unknown',
          });
        }
      }

      // 4. Fetch actual names from profiles for matched providers
      const profileIds = [...profileHours.keys()];
      let nameMap = new Map<string, string>();
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', profileIds);
        for (const p of profiles ?? []) {
          if (p.full_name) nameMap.set(p.id, p.full_name);
        }
      }

      // 5. Compute allocations
      const rows: ProviderCoverageRow[] = [];
      for (const [profileId, info] of profileHours) {
        const providerLicenses = licenseMap.get(profileId) ?? new Set();
        const eligibleStates = [...providerLicenses].filter((s) => activeStates.has(s)).sort();
        const stateCount = eligibleStates.length || 1;
        const hoursPerState = info.totalHours / stateCount;
        const slotsPerState = hoursPerState * 2;

        rows.push({
          profileId,
          providerName: nameMap.get(profileId) || info.name || 'Unknown',
          totalHours: info.totalHours,
          totalSlots: info.totalHours * 2,
          eligibleStates,
          hoursPerState: Math.round(hoursPerState * 100) / 100,
          slotsPerState: Math.round(slotsPerState * 100) / 100,
          stateAllocations: eligibleStates.map((state) => ({
            state,
            allocatedHours: Math.round(hoursPerState * 100) / 100,
            projectedSlots: Math.round(slotsPerState * 100) / 100,
          })),
        });
      }

      return rows.sort((a, b) => a.providerName.localeCompare(b.providerName));
    },
    staleTime: 5 * 60_000,
  });
}
