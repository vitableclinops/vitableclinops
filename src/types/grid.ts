// Grid view types for provider-state matrix

export type CellStatus = 'green' | 'yellow' | 'red' | 'gray';

export type GridViewMode = 'licensure' | 'credentialing';

export interface LicensureStatus {
  status: CellStatus;
  licenseNumber?: string;
  expirationDate?: Date;
  daysUntilExpiry?: number;
  isActive: boolean;
  isExpiringSoon: boolean;
  isExpired: boolean;
  isMissing: boolean;
}

export interface CredentialingRequirement {
  id: string;
  type: 'licensure' | 'collaborative_agreement' | 'fpa' | 'prescriptive_authority' | 'compliance' | 'supervision';
  label: string;
  status: CellStatus;
  statusLabel: string;
  detail?: string;
  isBlocker: boolean;
  blockerReason?: string;
}

export interface CredentialingStatus {
  status: CellStatus;
  requirements: CredentialingRequirement[];
  blockers: CredentialingRequirement[];
  isReady: boolean;
}

export interface GridCell {
  providerId: string;
  stateId: string;
  licensure: LicensureStatus;
  credentialing: CredentialingStatus;
}

export interface GridProvider {
  id: string;
  name: string;
  email: string;
  providerType: string;
  credentials?: string;
}

export interface GridState {
  id: string;
  name: string;
  abbreviation: string;
  demandTag?: string;
  requiresCollaborativeAgreement: boolean;
  hasFPA: boolean;
  requiresPrescriptiveAuthority: boolean;
}

export interface GridData {
  providers: GridProvider[];
  states: GridState[];
  cells: Map<string, GridCell>; // key: `${providerId}-${stateId}`
}
