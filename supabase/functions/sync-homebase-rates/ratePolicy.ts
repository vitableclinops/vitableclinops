import type { HBEmployee } from '../_shared/homebaseClient.ts';

export type RatePick = { ok: true; role: string; rate: number; source: string } | { ok: false; reason: string };
const excludedRole = (name: string) => /collaborat|supervis|in.home|clinic|train|admin|education/i.test(name);
export const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export const isAgency = (provider: { source?: string | null; employment_type?: string | null }) =>
  /directshifts|agency|externally/i.test(`${provider.source ?? ''} ${provider.employment_type ?? ''}`);
export const isProtectedRate = (source: string) => !['homebase', 'homebase_job_hourly'].includes(source);

export function pickRate(employee: HBEmployee, profession: string | null): RatePick {
  if (employee.job?.archived_at) return { ok: false, reason: 'Archived Homebase job' };
  if (employee.job?.wage_type !== 'hourly') return { ok: false, reason: 'Salary or unknown wage basis — kept separately' };
  const prof = (profession ?? '').toLowerCase();
  const matches = (name: string) => {
    if (/^(np|nurse practitioner)$/.test(prof)) return /\bnp\b|nurse practitioner/i.test(name) && /tele/i.test(name);
    if (/^(md|do|physician)$/.test(prof)) return /\b(md|do|physician)\b/i.test(name) && /tele/i.test(name);
    if (/lpc|lcsw|therapist|counselor/.test(prof)) return /lpc|lcsw|therap|counsel/i.test(name);
    if (/coach/.test(prof)) return /coach/i.test(name);
    return false;
  };
  const validRate = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 500;
  const candidates = (employee.job?.roles ?? []).filter(role => matches(role.name) && !excludedRole(role.name) && validRate(role.wage_rate));
  const preferred = candidates.filter(role => /telemedicine|telehealth/i.test(role.name));
  const selected = preferred.length ? preferred : candidates;
  if (new Set(selected.map(role => Number(role.wage_rate))).size > 1) return { ok: false, reason: 'Conflicting clinical role rates — review required' };
  if (selected[0]) return { ok: true, role: selected[0].name, rate: Number(selected[0].wage_rate), source: 'homebase' };
  const defaultRole = employee.job?.default_role ?? '';
  if (!matches(defaultRole) || excludedRole(defaultRole)) return { ok: false, reason: 'No matching clinical default role' };
  if (!validRate(employee.job?.wage_rate)) return { ok: false, reason: 'No valid hourly wage in Homebase' };
  return { ok: true, role: defaultRole, rate: Number(employee.job.wage_rate), source: 'homebase_job_hourly' };
}

export function uniqueMatch<T>(rows: T[], predicate: (row: T) => boolean): T | undefined {
  const matches = rows.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}