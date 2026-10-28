/** Both stored termination labels describe the same offboarded lifecycle. */
export function isOffboarded(status: string | null | undefined): boolean {
  return ['termed', 'terminated'].includes((status ?? '').trim().toLowerCase());
}

export function employeeVisibleIn(status: string | null | undefined, view: 'current' | 'offboarded'): boolean {
  return view === 'offboarded' ? isOffboarded(status) : !isOffboarded(status);
}