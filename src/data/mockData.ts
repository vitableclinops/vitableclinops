import type { 
  State, 
  Provider, 
  Task, 
  TaskTemplate,
  ProviderState,
  Evidence,
  TaskNote,
  Reimbursement
} from '@/types';

// US States with licensure information
export const states: State[] = [
  {
    id: 'ca',
    name: 'California',
    abbreviation: 'CA',
    hasFPA: false,
    requiresCollaborativeAgreement: true,
    notes: 'Requires standardized procedure agreement with physician. Board of Registered Nursing processes applications.',
    applicationFeeRange: { min: 150, max: 300 },
    processingTimeWeeks: { min: 8, max: 16 },
  },
  {
    id: 'tx',
    name: 'Texas',
    abbreviation: 'TX',
    hasFPA: false,
    requiresCollaborativeAgreement: true,
    notes: 'Prescriptive authority agreement required. Must have 30-day waiting period before delegation begins.',
    applicationFeeRange: { min: 186, max: 250 },
    processingTimeWeeks: { min: 6, max: 12 },
  },
  {
    id: 'fl',
    name: 'Florida',
    abbreviation: 'FL',
    hasFPA: false,
    requiresCollaborativeAgreement: true,
    notes: 'Supervisory relationship required. Limited prescribing authority for controlled substances.',
    applicationFeeRange: { min: 130, max: 200 },
    processingTimeWeeks: { min: 4, max: 8 },
  },
  {
    id: 'ny',
    name: 'New York',
    abbreviation: 'NY',
    hasFPA: true,
    requiresCollaborativeAgreement: false,
    notes: 'Full Practice Authority granted after 3,600 hours of supervised practice. Modernized in 2022.',
    applicationFeeRange: { min: 143, max: 200 },
    processingTimeWeeks: { min: 6, max: 12 },
  },
  {
    id: 'az',
    name: 'Arizona',
    abbreviation: 'AZ',
    hasFPA: true,
    requiresCollaborativeAgreement: false,
    notes: 'Full Practice Authority state. Streamlined application process.',
    applicationFeeRange: { min: 150, max: 200 },
    processingTimeWeeks: { min: 4, max: 8 },
  },
  {
    id: 'co',
    name: 'Colorado',
    abbreviation: 'CO',
    hasFPA: true,
    requiresCollaborativeAgreement: false,
    notes: 'Full Practice Authority. No physician oversight required.',
    applicationFeeRange: { min: 188, max: 250 },
    processingTimeWeeks: { min: 4, max: 6 },
  },
  {
    id: 'wa',
    name: 'Washington',
    abbreviation: 'WA',
    hasFPA: true,
    requiresCollaborativeAgreement: false,
    notes: 'Full Practice Authority after 4,000 hours clinical experience.',
    applicationFeeRange: { min: 175, max: 225 },
    processingTimeWeeks: { min: 6, max: 10 },
  },
  {
    id: 'il',
    name: 'Illinois',
    abbreviation: 'IL',
    hasFPA: false,
    requiresCollaborativeAgreement: true,
    notes: 'Written collaborative agreement required. 4,000 hours for FPA eligibility.',
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 8, max: 14 },
  },
];

// Task templates for different license types
export const taskTemplates: TaskTemplate[] = [
  {
    id: 'tpl-initial-1',
    licenseType: 'initial',
    title: 'Submit License Application',
    description: 'Complete and submit the initial NP license application to the state board.',
    defaultInstructions: [
      'Navigate to the state nursing board website',
      'Create an account or log in to existing account',
      'Complete all required sections of the application form',
      'Upload required documents (transcripts, verification, etc.)',
      'Pay the application fee',
      'Take a screenshot of the confirmation page',
      'Save the confirmation/reference number',
    ],
    estimatedTimeMinutes: 90,
    order: 1,
    isActive: true,
  },
  {
    id: 'tpl-initial-2',
    licenseType: 'initial',
    title: 'Submit Background Check',
    description: 'Complete fingerprinting and background check as required by the state.',
    defaultInstructions: [
      'Schedule fingerprinting appointment at approved vendor',
      'Bring required identification documents',
      'Complete fingerprinting',
      'Keep receipt as proof of completion',
      'Background check results are typically sent directly to the board',
    ],
    estimatedTimeMinutes: 60,
    order: 2,
    isActive: true,
  },
  {
    id: 'tpl-initial-3',
    licenseType: 'initial',
    title: 'Verify License Issuance',
    description: 'Confirm license has been issued and download official documentation.',
    defaultInstructions: [
      'Check state board portal for license status',
      'Once approved, download the official license document',
      'Verify all information is correct',
      'Upload license document as evidence',
    ],
    estimatedTimeMinutes: 15,
    order: 3,
    isActive: true,
  },
  {
    id: 'tpl-telehealth-1',
    licenseType: 'telehealth',
    title: 'Complete Telehealth Registration',
    description: 'Register for telehealth practice authorization in the state.',
    defaultInstructions: [
      'Verify state has telehealth-specific registration requirements',
      'Complete telehealth registration form if required',
      'Submit any additional documentation',
      'Pay registration fee if applicable',
    ],
    estimatedTimeMinutes: 30,
    order: 1,
    isActive: true,
  },
  {
    id: 'tpl-fpa-1',
    licenseType: 'fpa',
    title: 'Apply for Full Practice Authority',
    description: 'Submit documentation to transition to Full Practice Authority status.',
    defaultInstructions: [
      'Verify you meet hour requirements for FPA',
      'Gather documentation of supervised practice hours',
      'Complete FPA transition application',
      'Submit supporting documentation',
      'Pay any required fees',
    ],
    estimatedTimeMinutes: 60,
    order: 1,
    isActive: true,
  },
  {
    id: 'tpl-renewal-1',
    licenseType: 'renewal',
    title: 'Complete License Renewal',
    description: 'Renew existing state license before expiration.',
    defaultInstructions: [
      'Log in to state board portal',
      'Navigate to license renewal section',
      'Verify continuing education requirements are met',
      'Complete renewal application',
      'Pay renewal fee',
      'Download renewed license',
    ],
    estimatedTimeMinutes: 45,
    order: 1,
    isActive: true,
  },
];

// Mock evidence
const mockEvidence: Evidence[] = [
  {
    id: 'ev-1',
    taskId: 'task-1',
    type: 'confirmation',
    fileName: 'ca_application_confirmation.pdf',
    fileUrl: '/uploads/ca_application_confirmation.pdf',
    fileSize: 245000,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2024-01-15'),
    uploadedBy: 'provider-1',
    description: 'California Board confirmation page',
  },
  {
    id: 'ev-2',
    taskId: 'task-1',
    type: 'receipt',
    fileName: 'ca_fee_receipt.pdf',
    fileUrl: '/uploads/ca_fee_receipt.pdf',
    fileSize: 125000,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2024-01-15'),
    uploadedBy: 'provider-1',
    description: 'Application fee payment receipt - $200',
  },
];

// Mock task notes
const mockNotes: TaskNote[] = [
  {
    id: 'note-1',
    taskId: 'task-1',
    authorId: 'admin-1',
    authorName: 'Sarah Chen',
    content: 'Verified confirmation number matches board records. Application is in queue.',
    createdAt: new Date('2024-01-16'),
    isInternal: false,
  },
  {
    id: 'note-2',
    taskId: 'task-2',
    authorId: 'provider-1',
    authorName: 'Emily Johnson',
    content: 'Scheduled fingerprinting for January 20th at IdentoGO location.',
    createdAt: new Date('2024-01-17'),
    isInternal: false,
  },
];

// Mock reimbursement
const mockReimbursement: Reimbursement = {
  id: 'reimb-1',
  taskId: 'task-1',
  providerId: 'provider-1',
  applicationFee: 200,
  adminTimeMinutes: 95,
  hourlyRate: 45,
  totalAmount: 271.25, // 200 + (95/60 * 45)
  status: 'pending',
  submittedAt: new Date('2024-01-15'),
};

// Mock tasks for providers
const createTasksForState = (providerId: string, stateId: string, stateName: string): Task[] => {
  const baseDate = new Date();
  
  if (stateId === 'ca') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Submit License Application',
        description: `Complete and submit the initial NP license application to the ${stateName} board.`,
        instructions: [
          `Navigate to the ${stateName} nursing board website`,
          'Create an account or log in to existing account',
          'Complete all required sections of the application form',
          'Upload required documents (transcripts, verification, etc.)',
          'Pay the application fee ($200)',
          'Take a screenshot of the confirmation page',
          'Save the confirmation/reference number',
        ],
        status: 'verified',
        estimatedTimeMinutes: 90,
        estimatedFee: 200,
        actualTimeMinutes: 95,
        actualFee: 200,
        assignedAt: new Date('2024-01-10'),
        completedAt: new Date('2024-01-15'),
        verifiedAt: new Date('2024-01-16'),
        verifiedBy: 'admin-1',
        evidence: mockEvidence,
        reimbursement: mockReimbursement,
        notes: [mockNotes[0]],
        order: 1,
      },
      {
        id: `task-${providerId}-${stateId}-2`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Submit Background Check',
        description: 'Complete fingerprinting and background check as required by the state.',
        instructions: [
          'Schedule fingerprinting appointment at approved vendor (IdentoGO)',
          'Bring valid government-issued photo ID',
          'Complete fingerprinting',
          'Keep receipt as proof of completion',
          'Background check results are sent directly to the board',
        ],
        status: 'in_progress',
        estimatedTimeMinutes: 60,
        estimatedFee: 75,
        assignedAt: new Date('2024-01-16'),
        evidence: [],
        notes: [mockNotes[1]],
        order: 2,
      },
      {
        id: `task-${providerId}-${stateId}-3`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Verify License Issuance',
        description: 'Confirm license has been issued and download official documentation.',
        instructions: [
          'Check state board portal for license status',
          'Once approved, download the official license document',
          'Verify all information is correct (name, license number, expiration)',
          'Upload license document as evidence',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 15,
        estimatedFee: 0,
        evidence: [],
        notes: [],
        order: 3,
      },
    ];
  }
  
  if (stateId === 'tx') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Submit License Application',
        description: `Complete and submit the initial NP license application to the ${stateName} board.`,
        instructions: [
          'Navigate to Texas Board of Nursing website',
          'Create a new application account',
          'Complete all application sections',
          'Upload required documentation',
          'Pay application fee ($186)',
        ],
        status: 'submitted',
        estimatedTimeMinutes: 90,
        estimatedFee: 186,
        actualTimeMinutes: 85,
        actualFee: 186,
        assignedAt: new Date('2024-01-08'),
        completedAt: new Date('2024-01-12'),
        evidence: [],
        notes: [],
        order: 1,
      },
    ];
  }
  
  if (stateId === 'az') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Submit License Application',
        description: `Complete and submit the initial NP license application to the ${stateName} board.`,
        instructions: [
          'Navigate to Arizona State Board of Nursing',
          'Complete online application',
          'Pay fee ($150)',
        ],
        status: 'approved',
        estimatedTimeMinutes: 60,
        estimatedFee: 150,
        actualTimeMinutes: 55,
        actualFee: 150,
        assignedAt: new Date('2023-12-01'),
        completedAt: new Date('2023-12-05'),
        verifiedAt: new Date('2024-01-02'),
        verifiedBy: 'admin-1',
        evidence: [],
        notes: [],
        order: 1,
      },
    ];
  }

  if (stateId === 'fl') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        licenseType: 'initial',
        title: 'Submit License Application',
        description: 'Complete Florida NP license application.',
        instructions: [
          'Apply through Florida Department of Health portal',
          'Complete all sections',
          'Pay fee ($130)',
        ],
        status: 'blocked',
        estimatedTimeMinutes: 75,
        estimatedFee: 130,
        assignedAt: new Date('2024-01-05'),
        evidence: [],
        notes: [{
          id: 'note-blocked',
          taskId: `task-${providerId}-${stateId}-1`,
          authorId: 'admin-1',
          authorName: 'Sarah Chen',
          content: 'Blocked: Missing transcript from nursing program. Provider needs to request official transcript.',
          createdAt: new Date('2024-01-08'),
          isInternal: false,
        }],
        order: 1,
      },
    ];
  }
  
  return [];
};

// Create provider states
const createProviderStates = (providerId: string): ProviderState[] => {
  const providerStates: ProviderState[] = [];
  
  // California - in progress
  const caState = states.find(s => s.id === 'ca')!;
  providerStates.push({
    id: `ps-${providerId}-ca`,
    providerId,
    stateId: 'ca',
    state: caState,
    isLicensed: false,
    isApprovedToPractice: false,
    isReadyForActivation: false,
    licenses: [],
    tasks: createTasksForState(providerId, 'ca', 'California'),
  });
  
  // Texas - submitted
  const txState = states.find(s => s.id === 'tx')!;
  providerStates.push({
    id: `ps-${providerId}-tx`,
    providerId,
    stateId: 'tx',
    state: txState,
    isLicensed: false,
    isApprovedToPractice: false,
    isReadyForActivation: false,
    licenses: [],
    tasks: createTasksForState(providerId, 'tx', 'Texas'),
  });
  
  // Arizona - complete and ready
  const azState = states.find(s => s.id === 'az')!;
  providerStates.push({
    id: `ps-${providerId}-az`,
    providerId,
    stateId: 'az',
    state: azState,
    isLicensed: true,
    isApprovedToPractice: true,
    isReadyForActivation: true,
    licenses: [{
      id: `lic-${providerId}-az`,
      providerId,
      stateId: 'az',
      type: 'initial',
      licenseNumber: 'AZ-NP-2024-12345',
      issueDate: new Date('2024-01-02'),
      expirationDate: new Date('2026-01-02'),
      status: 'active',
    }],
    tasks: createTasksForState(providerId, 'az', 'Arizona'),
  });

  // Florida - blocked
  const flState = states.find(s => s.id === 'fl')!;
  providerStates.push({
    id: `ps-${providerId}-fl`,
    providerId,
    stateId: 'fl',
    state: flState,
    isLicensed: false,
    isApprovedToPractice: false,
    isReadyForActivation: false,
    licenses: [],
    tasks: createTasksForState(providerId, 'fl', 'Florida'),
  });
  
  return providerStates;
};

// Mock providers
export const providers: Provider[] = [
  {
    id: 'provider-1',
    email: 'emily.johnson@example.com',
    firstName: 'Emily',
    lastName: 'Johnson',
    role: 'provider',
    npiNumber: '1234567890',
    specialty: 'Family Nurse Practitioner',
    hireDate: new Date('2023-11-15'),
    createdAt: new Date('2023-11-15'),
    states: createProviderStates('provider-1'),
  },
  {
    id: 'provider-2',
    email: 'michael.chen@example.com',
    firstName: 'Michael',
    lastName: 'Chen',
    role: 'provider',
    npiNumber: '0987654321',
    specialty: 'Adult-Gerontology Nurse Practitioner',
    hireDate: new Date('2023-10-01'),
    createdAt: new Date('2023-10-01'),
    states: [],
  },
  {
    id: 'provider-3',
    email: 'sarah.williams@example.com',
    firstName: 'Sarah',
    lastName: 'Williams',
    role: 'provider',
    npiNumber: '5678901234',
    specialty: 'Psychiatric Mental Health Nurse Practitioner',
    hireDate: new Date('2024-01-02'),
    createdAt: new Date('2024-01-02'),
    states: [],
  },
];

// Current user mock (for demo purposes)
export const currentUser = providers[0];

// Get all tasks across all providers
export const getAllTasks = (): Task[] => {
  return providers.flatMap(p => 
    p.states.flatMap(s => s.tasks)
  );
};

// Get provider stats
export const getProviderStats = (provider: Provider) => {
  const allTasks = provider.states.flatMap(s => s.tasks);
  return {
    totalStates: provider.states.length,
    licensedStates: provider.states.filter(s => s.isLicensed).length,
    approvedStates: provider.states.filter(s => s.isApprovedToPractice).length,
    pendingTasks: allTasks.filter(t => 
      ['not_started', 'in_progress', 'submitted'].includes(t.status)
    ).length,
    blockedTasks: allTasks.filter(t => t.status === 'blocked').length,
    pendingReimbursements: allTasks.filter(t => 
      t.reimbursement?.status === 'pending'
    ).length,
  };
};
