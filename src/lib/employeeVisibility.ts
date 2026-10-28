/** Both stored termination labels describe the same offboarded lifecycle. */
export function isOffboarded(status: string | null | undefined): boolean {
  return ['termed', 'terminated'].includes((status ?? '').trim().toLowerCase());
}

export function employeeVisibleIn(status: string | null | undefined, view: 'current' | 'offboarded'): boolean {
  return view === 'offboarded' ? isOffboarded(status) : !isOffboarded(status);
}

/** Preserve unknown/onboarding status while excluding both stored termination aliases. */
export const CURRENT_EMPLOYEE_FILTER = 'employment_status.is.null,and(employment_status.not.ilike.termed,employment_status.not.ilike.terminated)';