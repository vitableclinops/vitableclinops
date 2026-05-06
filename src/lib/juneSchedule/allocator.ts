import { clipToWindow } from './businessHours';
import type {
  AllocatedShift,
  AllocationResult,
  DemandRow,
  ProviderInfo,
  ShiftCandidate,
} from './types';

const NP_RESTRICTED = new Set(['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA']);

function isNp(profession: string): boolean {
  const p = profession.toUpperCase().trim();
  return p === 'NP' || p === 'APRN' || p === 'CRNP';
}

function eligibleStatesFor(p: ProviderInfo): Set<string> {
  if (!isNp(p.profession)) return p.licensedStates;
  const out = new Set<string>();
  for (const s of p.licensedStates) if (!NP_RESTRICTED.has(s)) out.add(s);
  return out;
}

export function allocate(
  candidates: ShiftCandidate[],
  providers: Map<string, ProviderInfo>,
  demand: DemandRow[],
): AllocationResult {
  // Remaining capacity per state
  const remaining = new Map<string, number>();
  for (const d of demand) remaining.set(d.state, d.monthlyHours);

  const allocated: AllocatedShift[] = [];

  // Process shifts in deterministic input order; for each, assign greedily to
  // the provider's eligible state with the smallest positive remaining demand.
  for (const c of candidates) {
    const provider = providers.get(c.providerKey);
    const window = clipToWindow(c.date, c.startMin, c.endMin);
    const usableHours = (window.endMin - window.startMin) / 60;

    if (usableHours <= 0) {
      allocated.push({
        ...c,
        startMin: window.startMin,
        endMin: window.endMin,
        hours: c.hours,
        acceptedHours: 0,
        declinedHours: c.hours,
        assignments: [],
        declineReason: 'outside_business_hours',
        declineNote: `Shift falls outside operating hours for ${c.date}.`,
      });
      continue;
    }

    if (!provider) {
      allocated.push({
        ...c,
        acceptedHours: 0,
        declinedHours: usableHours,
        assignments: [],
        declineReason: 'provider_unlicensed_in_needed_states',
        declineNote: 'Provider not found in licensure data.',
      });
      continue;
    }

    const eligible = eligibleStatesFor(provider);
    if (eligible.size === 0) {
      allocated.push({
        ...c,
        acceptedHours: 0,
        declinedHours: usableHours,
        assignments: [],
        declineReason: isNp(provider.profession) ? 'np_state_restricted' : 'provider_unlicensed_in_needed_states',
        declineNote: isNp(provider.profession)
          ? 'NP-restricted in all licensed states.'
          : 'No licensed states recorded.',
      });
      continue;
    }

    // Greedy assignment
    let left = usableHours;
    const assigns: Array<{ state: string; hours: number }> = [];
    while (left > 0.001) {
      const candidates: Array<{ state: string; rem: number }> = [];
      for (const st of eligible) {
        const rem = remaining.get(st) ?? 0;
        if (rem > 0.001) candidates.push({ state: st, rem });
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => a.rem - b.rem);
      const pick = candidates[0];
      const give = Math.min(left, pick.rem);
      assigns.push({ state: pick.state, hours: give });
      remaining.set(pick.state, pick.rem - give);
      left -= give;
    }

    const acceptedHours = usableHours - left;
    allocated.push({
      ...c,
      startMin: window.startMin,
      endMin: window.endMin,
      hours: usableHours,
      acceptedHours,
      declinedHours: left,
      assignments: assigns,
      declineReason: left > 0.001
        ? acceptedHours > 0
          ? 'state_capacity_full'
          : 'state_capacity_full'
        : null,
      declineNote: left > 0.001
        ? acceptedHours > 0
          ? `Partial accept: ${acceptedHours.toFixed(1)}h placed, ${left.toFixed(1)}h declined (no remaining state demand).`
          : 'No remaining demand in any of this provider\'s eligible states.'
        : null,
    });
  }

  // Aggregate per provider
  const byProvider: AllocationResult['byProvider'] = new Map();
  for (const sh of allocated) {
    const info = providers.get(sh.providerKey) ?? {
      key: sh.providerKey,
      name: sh.providerName,
      email: null,
      profession: 'Unknown',
      licensedStates: new Set<string>(),
    };
    let bucket = byProvider.get(sh.providerKey);
    if (!bucket) {
      bucket = { info, accepted: [], declined: [], acceptedHours: 0, declinedHours: 0 };
      byProvider.set(sh.providerKey, bucket);
    }
    if (sh.acceptedHours > 0) {
      bucket.accepted.push(sh);
      bucket.acceptedHours += sh.acceptedHours;
    }
    if (sh.declinedHours > 0) {
      bucket.declined.push(sh);
      bucket.declinedHours += sh.declinedHours;
    }
  }

  const stateFill = demand
    .map(d => ({
      state: d.state,
      needed: d.monthlyHours,
      remaining: remaining.get(d.state) ?? d.monthlyHours,
      filled: d.monthlyHours - (remaining.get(d.state) ?? d.monthlyHours),
    }))
    .sort((a, b) => b.needed - a.needed);

  const totals = {
    demandHours: demand.reduce((s, d) => s + d.monthlyHours, 0),
    acceptedHours: allocated.reduce((s, x) => s + x.acceptedHours, 0),
    declinedHours: allocated.reduce((s, x) => s + x.declinedHours, 0),
  };

  return { shifts: allocated, byProvider, stateFill, totals };
}

export function mergeProviders(sources: Array<{
  key: string;
  name: string;
  email?: string | null;
  profession?: string;
  states: Set<string>;
}>): Map<string, ProviderInfo> {
  // Merge by name (lowercased) so the three CSVs that use slightly different keying
  // (email vs name) collapse into one provider.
  const byNameKey = new Map<string, ProviderInfo>();
  for (const s of sources) {
    const nameKey = s.name.trim().toLowerCase().replace(/\s+/g, ' ');
    let info = byNameKey.get(nameKey);
    if (!info) {
      info = {
        key: s.email ? s.email.toLowerCase() : nameKey,
        name: s.name.trim(),
        email: s.email ?? null,
        profession: s.profession ?? 'NP',
        licensedStates: new Set<string>(),
      };
      byNameKey.set(nameKey, info);
    }
    if (!info.email && s.email) info.email = s.email;
    if (s.profession && info.profession === 'NP') info.profession = s.profession;
    for (const st of s.states) info.licensedStates.add(st);
  }
  // Re-key by canonical key (email if present, else name)
  const byKey = new Map<string, ProviderInfo>();
  for (const info of byNameKey.values()) {
    const k = info.email ? info.email.toLowerCase() : info.name.trim().toLowerCase().replace(/\s+/g, ' ');
    info.key = k;
    byKey.set(k, info);
  }
  return byKey;
}