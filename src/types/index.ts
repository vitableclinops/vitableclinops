// Core domain types for the licensure platform

export type UserRole = 'provider' | 'admin' | 'leadership';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: Date;
}

export interface Provider extends User {
  role: 'provider';
  npiNumber: string;
  specialty: string;
  hireDate: Date;
  states: ProviderState[];
}

export type LicenseType = 'initial' | 'telehealth' | 'fpa' | 'renewal';

export type TaskStatus = 
  | 'not_started' 
  | 'in_progress' 
  | 'submitted' 
  | 'verified' 
  | 'approved' 
  | 'blocked';

export interface State {
  id: string;
  name: string;
  abbreviation: string;
  hasFPA: boolean; // Full Practice Authority
  requiresCollaborativeAgreement: boolean;
  notes?: string;
  applicationFeeRange: {
    min: number;
    max: number;
  };
  processingTimeWeeks: {
    min: number;
    max: number;
  };
}

export interface ProviderState {
  id: string;
  providerId: string;
  stateId: string;
  state: State;
  isLicensed: boolean;
  isApprovedToPractice: boolean;
  isReadyForActivation: boolean;
  licenses: License[];
  tasks: Task[];
}

export interface License {
  id: string;
  providerId: string;
  stateId: string;
  type: LicenseType;
  licenseNumber?: string;
  issueDate?: Date;
  expirationDate?: Date;
  status: 'pending' | 'active' | 'expired' | 'revoked';
}

export interface Task {
  id: string;
  providerId: string;
  stateId: string;
  licenseType: LicenseType;
  title: string;
  description: string;
  instructions: string[];
  status: TaskStatus;
  estimatedTimeMinutes: number;
  estimatedFee: number;
  actualTimeMinutes?: number;
  actualFee?: number;
  dueDate?: Date;
  assignedAt?: Date;
  assignedBy?: string;
  completedAt?: Date;
  verifiedAt?: Date;
  verifiedBy?: string;
  evidence: Evidence[];
  reimbursement?: Reimbursement;
  notes: TaskNote[];
  order: number;
}

export interface Evidence {
  id: string;
  taskId: string;
  type: 'confirmation' | 'receipt' | 'license' | 'document' | 'screenshot';
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedBy: string;
  description?: string;
}

export type ReimbursementStatus = 'pending' | 'approved' | 'processed' | 'rejected';

export interface Reimbursement {
  id: string;
  taskId: string;
  providerId: string;
  applicationFee: number;
  adminTimeMinutes: number;
  hourlyRate: number; // For calculating admin time compensation
  totalAmount: number;
  receiptEvidence?: Evidence;
  status: ReimbursementStatus;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  processedAt?: Date;
  notes?: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
  isInternal: boolean; // Visible only to ops/admin
}

export interface AuditLogEntry {
  id: string;
  entityType: 'task' | 'license' | 'reimbursement' | 'provider';
  entityId: string;
  action: string;
  performedBy: string;
  performedByName: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

// Task template for creating consistent tasks across states
export interface TaskTemplate {
  id: string;
  licenseType: LicenseType;
  title: string;
  description: string;
  defaultInstructions: string[];
  estimatedTimeMinutes: number;
  order: number;
  isActive: boolean;
}

// Dashboard stats
export interface ProviderStats {
  totalStates: number;
  licensedStates: number;
  approvedStates: number;
  pendingTasks: number;
  blockedTasks: number;
  pendingReimbursements: number;
}

export interface AdminStats {
  totalProviders: number;
  totalActiveTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  pendingReimbursements: number;
  providersReadyForActivation: number;
  blockedProviders: number;
}

// Filter and sort options
export interface TaskFilters {
  status?: TaskStatus[];
  licenseType?: LicenseType[];
  stateId?: string;
  providerId?: string;
  hasBlockers?: boolean;
}

export interface ProviderFilters {
  hasActiveTasks?: boolean;
  isReadyForActivation?: boolean;
  stateId?: string;
  hasBlockers?: boolean;
}
