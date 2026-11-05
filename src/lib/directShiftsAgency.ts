/** DirectShifts agency record. Its providers' state licensure is verified from the DirectShifts licensed-states spreadsheet. */
export const DIRECTSHIFTS_AGENCY_ID = '8d67db2a-ebed-425f-a344-1d18b5f91b64';

export function isDirectShiftsAgencyProvider(provider: { agency_id?: string | null } | null | undefined): boolean {
  return provider?.agency_id === DIRECTSHIFTS_AGENCY_ID;
}
