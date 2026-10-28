export interface MeetingProviderLink {
  state: string;
  physician: string;
  chartUrl: string | null;
}

/** Saved attendee selections are the only source of event state scope. */
export function selectedMeetingStates(notes: string | null | undefined): string[] {
  const match = notes?.match(/^States:\s*([^\r\n]*)/m);
  if (!match) return [];
  return [...new Set(match[1].split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{2}$/.test(s)))].sort();
}

export function meetingStateGroups(notes: string | null | undefined, links: MeetingProviderLink[]) {
  const states = selectedMeetingStates(notes);
  const groups = new Map<string, { states: string[]; chartUrl: string | null }>();
  for (const state of states) {
    const matches = links.filter(link => link.state === state);
    for (const link of matches.length ? matches : [{ state, physician: 'Unassigned MD', chartUrl: null }]) {
      const group = groups.get(link.physician) || { states: [], chartUrl: null };
      if (!group.states.includes(state)) group.states.push(state);
      group.chartUrl ||= link.chartUrl;
      groups.set(link.physician, group);
    }
  }
  if (!states.length) groups.set('States not selected', { states: [], chartUrl: null });
  return [...groups.entries()];
}

export function selectMeetingProviders(providers: { email: string; states: string[] }[], filter: Set<string> = new Set()) {
  return Object.fromEntries(providers.map(p => [p.email, p.states.filter(s => !filter.size || filter.has(s))]));
}