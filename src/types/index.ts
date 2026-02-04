// Core domain types for the licensure platform

export type UserRole = 'provider' | 'admin' | 'leadership' | 'physician';

// Provider type defines the credential/license category
export type ProviderType = 
  | 'nurse_practitioner'    // NP - Full licensure and collaborative requirements
  | 'registered_nurse'      // RN - Nursing license, no prescriptive authority
  | 'physician'             // MD/DO - Full independent practice
  | 'licensed_counselor'    // LPC - Mental health licensure
  | 'mental_health_coach';  // Unlicensed - compliance only, no licensure

export const PROVIDER_TYPE_CONFIG: Record<ProviderType, {
  label: string;
  shortLabel: string;
  requiresLicensure: boolean;
  requiresNPI: boolean;
  requiresCollaborativeAgreement: boolean;
  requiresPrescriptiveAuthority: boolean;
  licenseTypes: string[];
  description: string;
}> = {
  nurse_practitioner: {
    label: 'Nurse Practitioner',
    shortLabel: 'NP',
    requiresLicensure: true,
    requiresNPI: true,
    requiresCollaborativeAgreement: true, // State-dependent
    requiresPrescriptiveAuthority: true,  // State-dependent
    licenseTypes: ['RN', 'APRN', 'Prescriptive Authority', 'DEA', 'State Controlled Substance'],
    description: 'Advanced practice registered nurse with prescriptive authority',
  },
  registered_nurse: {
    label: 'Registered Nurse',
    shortLabel: 'RN',
    requiresLicensure: true,
    requiresNPI: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    licenseTypes: ['RN'],
    description: 'Licensed registered nurse',
  },
  physician: {
    label: 'Physician',
    shortLabel: 'MD/DO',
    requiresLicensure: true,
    requiresNPI: true,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false, // Inherent to license
    licenseTypes: ['MD/DO', 'DEA', 'State Controlled Substance'],
    description: 'Licensed physician (MD or DO)',
  },
  licensed_counselor: {
    label: 'Licensed Professional Counselor',
    shortLabel: 'LPC',
    requiresLicensure: true,
    requiresNPI: true,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    licenseTypes: ['LPC', 'LMHC', 'LCPC'],
    description: 'Licensed mental health counselor',
  },
  mental_health_coach: {
    label: 'Mental Health Coach',
    shortLabel: 'Coach',
    requiresLicensure: false,
    requiresNPI: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    licenseTypes: [],
    description: 'Unlicensed mental health coach - compliance requirements only',
  },
};

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
  providerType: ProviderType;
  npiNumber?: string; // Not required for coaches
  specialty?: string;
  hireDate: Date;
  states: ProviderState[];
  selfReportedLicenses?: SelfReportedLicense[];
  complianceStatus?: ComplianceStatus;
}

// Collaborating Physician
export interface CollaboratingPhysician extends User {
  role: 'physician';
  npiNumber: string;
  specialty: string;
  licenseNumber: string;
  licenseState: string;
  agreements: CollaborativeAgreement[];
}

// Demand context for states
export type DemandTag = 'critical' | 'at_risk' | 'watch' | 'stable';

export type LicenseType = 'initial' | 'telehealth' | 'fpa' | 'renewal' | 'prescriptive_authority';

export type TaskStatus = 
  | 'not_started' 
  | 'in_progress' 
  | 'submitted' 
  | 'verified' 
  | 'approved' 
  | 'blocked';

export type TaskCategory = 'licensure' | 'collaborative' | 'compliance';

// Enhanced State with full regulatory intelligence
export interface State {
  id: string;
  name: string;
  abbreviation: string;
  // Demand context
  demandTag?: DemandTag;
  demandNotes?: string;
  // Regulatory requirements
  hasFPA: boolean;
  fpaEligibilityCriteria?: string[];
  fpaApplicationRequired: boolean;
  requiresCollaborativeAgreement: boolean;
  collaborativeAgreementRequirements?: CollabRequirements;
  requiresPrescriptiveAuthority: boolean;
  prescriptiveAuthorityNotes?: string;
  // General notes and constraints
  notes?: string;
  scopeLimitations?: string[];
  mdOnlyRules?: string[];
  specialConsiderations?: string[];
  applicationProcessNotes?: string;
  // Cost and timing
  applicationFeeRange: {
    min: number;
    max: number;
  };
  processingTimeWeeks: {
    min: number;
    max: number;
  };
  // Audit
  lastUpdated?: Date;
  updatedBy?: string;
}

export interface CollabRequirements {
  meetingCadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  chartReviewRequired: boolean;
  chartReviewFrequency?: string;
  supervisoryActivities: string[];
}

export interface ProviderState {
  id: string;
  providerId: string;
  stateId: string;
  state: State;
  isLicensed: boolean;
  isApprovedToPractice: boolean;
  isReadyForActivation: boolean;
  // Unified readiness signals
  licensureComplete: boolean;
  collaborativeComplete: boolean;
  complianceComplete: boolean;
  // Agreements
  collaborativeAgreementId?: string;
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

// Self-reported license from provider intake
export interface SelfReportedLicense {
  id: string;
  providerId: string;
  stateId: string;
  licenseNumber: string;
  expirationDate: Date;
  evidenceUrl?: string;
  submittedAt: Date;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedBy?: string;
  verifiedAt?: Date;
  rejectionReason?: string;
}

// Task with extended category support
export interface Task {
  id: string;
  providerId: string;
  stateId: string;
  category: TaskCategory;
  licenseType?: LicenseType;
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
  // Demand context display
  demandReason?: string;
  // Compliance-specific
  complianceTaskType?: ComplianceTaskType;
  externalContentUrl?: string;
  requiresAttestation?: boolean;
}

// Compliance task types
export type ComplianceTaskType = 
  | 'training_module'
  | 'policy_acknowledgment'
  | 'newsletter_acknowledgment'
  | 'annual_attestation'
  | 'ad_hoc_attestation'
  | 'background_check'
  | 'credential_verification';

export interface ComplianceStatus {
  isCompliant: boolean;
  completedTasks: number;
  totalTasks: number;
  overdueTasks: number;
  nextDueDate?: Date;
}

// Collaborative Agreement as first-class entity
export interface CollaborativeAgreement {
  id: string;
  stateId: string;
  state?: State;
  // Parties
  physicianId: string;
  physician?: CollaboratingPhysician;
  providerIds: string[];
  providers?: Provider[];
  // Agreement details
  startDate: Date;
  endDate: Date;
  renewalCadence: 'annual' | 'biennial';
  nextRenewalDate: Date;
  status: 'draft' | 'active' | 'pending_renewal' | 'expired' | 'terminated';
  // Supervision requirements
  meetingCadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  chartReviewRequired: boolean;
  chartReviewFrequency?: string;
  supervisoryActivities: string[];
  // Document
  documentUrl?: string;
  signedAt?: Date;
  // Tasks
  tasks: Task[];
}

// Supervision meeting/calendar
export interface SupervisionMeeting {
  id: string;
  agreementId: string;
  agreement?: CollaborativeAgreement;
  scheduledDate: Date;
  duration: number; // minutes
  type: 'collaborative_meeting' | 'chart_review' | 'case_discussion';
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  attendees: {
    physicianId: string;
    providerIds: string[];
  };
  // Chart review specific
  chartReviewMaterials?: string[];
  chartCount?: number;
  // Completion
  completedAt?: Date;
  notes?: string;
  followUpRequired?: boolean;
}

export interface Evidence {
  id: string;
  taskId: string;
  type: 'confirmation' | 'receipt' | 'license' | 'document' | 'screenshot' | 'attestation';
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
  hourlyRate: number;
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
  isInternal: boolean;
}

export interface AuditLogEntry {
  id: string;
  entityType: 'task' | 'license' | 'reimbursement' | 'provider' | 'agreement' | 'state' | 'compliance';
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
  category: TaskCategory;
  licenseType?: LicenseType;
  complianceTaskType?: ComplianceTaskType;
  title: string;
  description: string;
  defaultInstructions: string[];
  estimatedTimeMinutes: number;
  order: number;
  isActive: boolean;
  // State-specific override capability
  stateOverrides?: Record<string, Partial<TaskTemplate>>;
}

// Dashboard stats
export interface ProviderStats {
  totalStates: number;
  licensedStates: number;
  approvedStates: number;
  pendingTasks: number;
  blockedTasks: number;
  pendingReimbursements: number;
  complianceComplete: boolean;
  overdueComplianceTasks: number;
}

export interface AdminStats {
  totalProviders: number;
  totalActiveTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByCategory: Record<TaskCategory, number>;
  pendingReimbursements: number;
  providersReadyForActivation: number;
  blockedProviders: number;
  pendingLicenseVerifications: number;
  agreementsPendingRenewal: number;
  complianceOverdueCount: number;
}

// Filter and sort options
export interface TaskFilters {
  status?: TaskStatus[];
  category?: TaskCategory[];
  licenseType?: LicenseType[];
  stateId?: string;
  providerId?: string;
  hasBlockers?: boolean;
  demandTag?: DemandTag[];
}

export interface ProviderFilters {
  hasActiveTasks?: boolean;
  isReadyForActivation?: boolean;
  stateId?: string;
  hasBlockers?: boolean;
  complianceStatus?: 'compliant' | 'non_compliant' | 'overdue';
}

// Activation readiness unified signal
export interface ActivationReadiness {
  providerId: string;
  stateId: string;
  isReady: boolean;
  blockers: ActivationBlocker[];
  licensureStatus: 'complete' | 'in_progress' | 'not_started' | 'blocked';
  collaborativeStatus: 'complete' | 'in_progress' | 'not_required' | 'blocked';
  complianceStatus: 'complete' | 'in_progress' | 'overdue';
}

export interface ActivationBlocker {
  type: 'licensure' | 'collaborative' | 'compliance';
  reason: string;
  taskId?: string;
  severity: 'critical' | 'warning';
}
