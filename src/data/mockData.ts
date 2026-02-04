import type { 
  State, 
  Provider, 
  Task, 
  TaskTemplate,
  ProviderState,
  Evidence,
  TaskNote,
  Reimbursement,
  CollaboratingPhysician,
  CollaborativeAgreement,
  SupervisionMeeting,
  SelfReportedLicense
} from '@/types';

// US States with full regulatory intelligence
export const states: State[] = [
  {
    id: 'ca',
    name: 'California',
    abbreviation: 'CA',
    demandTag: 'critical',
    demandNotes: 'High patient volume growth in Bay Area and LA markets',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'monthly',
      chartReviewRequired: true,
      chartReviewFrequency: '5% of charts monthly',
      supervisoryActivities: ['Case consultation', 'Chart review', 'Protocol review'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Furnishing license required. Must have standardized procedure with supervising physician.',
    notes: 'Requires standardized procedure agreement with physician. Board of Registered Nursing processes applications.',
    scopeLimitations: ['Schedule II controlled substances require physician co-signature'],
    specialConsiderations: ['License renewal requires 30 CEU hours every 2 years'],
    applicationFeeRange: { min: 150, max: 300 },
    processingTimeWeeks: { min: 8, max: 16 },
    lastUpdated: new Date('2024-01-15'),
  },
  {
    id: 'tx',
    name: 'Texas',
    abbreviation: 'TX',
    demandTag: 'at_risk',
    demandNotes: 'Projected SLA pressure in Houston and Dallas-Fort Worth',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'monthly',
      chartReviewRequired: true,
      chartReviewFrequency: '10% of charts',
      supervisoryActivities: ['Prescriptive authority agreement review', 'Chart review', 'Quality assurance meetings'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Prescriptive authority agreement required. 30-day waiting period before delegation begins.',
    notes: 'Prescriptive authority agreement required. Must have 30-day waiting period before delegation begins.',
    scopeLimitations: ['Cannot prescribe Schedule II without delegation agreement', 'Site-based practice agreement required'],
    specialConsiderations: ['Must notify board of practice site changes within 10 days'],
    applicationFeeRange: { min: 186, max: 250 },
    processingTimeWeeks: { min: 6, max: 12 },
    lastUpdated: new Date('2024-01-10'),
  },
  {
    id: 'fl',
    name: 'Florida',
    abbreviation: 'FL',
    demandTag: 'watch',
    demandNotes: 'Monitoring seasonal demand fluctuations',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'monthly',
      chartReviewRequired: true,
      chartReviewFrequency: 'Monthly chart audits required',
      supervisoryActivities: ['Supervision meetings', 'Chart audits', 'Outcome reviews'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Controlled substance prescribing requires additional DEA registration and protocol.',
    notes: 'Supervisory relationship required. Limited prescribing authority for controlled substances.',
    scopeLimitations: ['Limited controlled substance prescribing', 'Supervision protocol must be on file'],
    mdOnlyRules: ['Certain procedures require direct physician involvement'],
    applicationFeeRange: { min: 130, max: 200 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-08'),
  },
  {
    id: 'ny',
    name: 'New York',
    abbreviation: 'NY',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['3,600 hours of supervised practice', 'Written certification from collaborating physician'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'Full Practice Authority granted after 3,600 hours of supervised practice. Modernized in 2022.',
    specialConsiderations: ['Transition period collaboration required before FPA'],
    applicationFeeRange: { min: 143, max: 200 },
    processingTimeWeeks: { min: 6, max: 12 },
    lastUpdated: new Date('2024-01-05'),
  },
  {
    id: 'az',
    name: 'Arizona',
    abbreviation: 'AZ',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['No hour requirement for FPA'],
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'Full Practice Authority state. Streamlined application process.',
    applicationFeeRange: { min: 150, max: 200 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-03'),
  },
  {
    id: 'co',
    name: 'Colorado',
    abbreviation: 'CO',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['No additional requirements beyond initial licensure'],
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'Full Practice Authority. No physician oversight required.',
    applicationFeeRange: { min: 188, max: 250 },
    processingTimeWeeks: { min: 4, max: 6 },
    lastUpdated: new Date('2024-01-02'),
  },
  {
    id: 'wa',
    name: 'Washington',
    abbreviation: 'WA',
    demandTag: 'watch',
    demandNotes: 'Expanding into Seattle metro area',
    hasFPA: true,
    fpaEligibilityCriteria: ['4,000 hours clinical experience'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'Full Practice Authority after 4,000 hours clinical experience.',
    applicationFeeRange: { min: 175, max: 225 },
    processingTimeWeeks: { min: 6, max: 10 },
    lastUpdated: new Date('2024-01-01'),
  },
  {
    id: 'il',
    name: 'Illinois',
    abbreviation: 'IL',
    demandTag: 'at_risk',
    demandNotes: 'Chicago market expansion planned Q2',
    hasFPA: true,
    fpaEligibilityCriteria: ['4,000 hours collaborative practice experience'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: false,
      supervisoryActivities: ['Periodic consultation availability'],
    },
    requiresPrescriptiveAuthority: false,
    notes: 'Written collaborative agreement required initially. 4,000 hours for FPA eligibility.',
    specialConsiderations: ['Transitioning to FPA model - verify current requirements'],
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 8, max: 14 },
    lastUpdated: new Date('2023-12-20'),
  },
];

// Collaborating Physicians
export const collaboratingPhysicians: CollaboratingPhysician[] = [
  {
    id: 'physician-1',
    email: 'dr.martinez@example.com',
    firstName: 'Robert',
    lastName: 'Martinez',
    role: 'physician',
    npiNumber: '1234567890',
    specialty: 'Internal Medicine',
    licenseNumber: 'CA-MD-123456',
    licenseState: 'ca',
    createdAt: new Date('2023-06-01'),
    agreements: [],
  },
  {
    id: 'physician-2',
    email: 'dr.patel@example.com',
    firstName: 'Priya',
    lastName: 'Patel',
    role: 'physician',
    npiNumber: '0987654321',
    specialty: 'Family Medicine',
    licenseNumber: 'TX-MD-789012',
    licenseState: 'tx',
    createdAt: new Date('2023-08-15'),
    agreements: [],
  },
];

// Task templates for different license types
export const taskTemplates: TaskTemplate[] = [
  // Licensure tasks
  {
    id: 'tpl-initial-1',
    category: 'licensure',
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
    category: 'licensure',
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
    category: 'licensure',
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
    id: 'tpl-prescriptive-1',
    category: 'licensure',
    licenseType: 'prescriptive_authority',
    title: 'Apply for Prescriptive/Furnishing Authority',
    description: 'Submit application for prescriptive or furnishing authority in states that require separate licensure.',
    defaultInstructions: [
      'Verify you have met prerequisites for prescriptive authority',
      'Complete prescriptive authority application',
      'Submit collaborating physician information if required',
      'Pay applicable fees',
      'Upload confirmation of submission',
    ],
    estimatedTimeMinutes: 45,
    order: 4,
    isActive: true,
  },
  {
    id: 'tpl-telehealth-1',
    category: 'licensure',
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
    order: 5,
    isActive: true,
  },
  {
    id: 'tpl-fpa-1',
    category: 'licensure',
    licenseType: 'fpa',
    title: 'Apply for Full Practice Authority',
    description: 'Submit documentation to transition to Full Practice Authority status.',
    defaultInstructions: [
      'Verify you meet hour requirements for FPA',
      'Gather documentation of supervised practice hours',
      'Obtain certification letter from collaborating physician',
      'Complete FPA transition application',
      'Submit supporting documentation',
      'Pay any required fees',
    ],
    estimatedTimeMinutes: 60,
    order: 6,
    isActive: true,
  },
  // Collaborative Agreement tasks
  {
    id: 'tpl-collab-1',
    category: 'collaborative',
    title: 'Execute Collaborative Agreement',
    description: 'Complete and sign collaborative agreement with supervising physician.',
    defaultInstructions: [
      'Review state-specific collaborative agreement requirements',
      'Coordinate with assigned collaborating physician',
      'Complete collaborative agreement form',
      'Both parties sign the agreement',
      'Submit to state board if required',
      'Upload signed agreement as evidence',
    ],
    estimatedTimeMinutes: 60,
    order: 1,
    isActive: true,
  },
  {
    id: 'tpl-collab-2',
    category: 'collaborative',
    title: 'Complete Initial Supervision Meeting',
    description: 'Complete first supervision meeting with collaborating physician.',
    defaultInstructions: [
      'Schedule meeting with collaborating physician',
      'Prepare discussion topics and questions',
      'Complete supervision meeting',
      'Document meeting notes',
      'Mark meeting as complete in system',
    ],
    estimatedTimeMinutes: 45,
    order: 2,
    isActive: true,
  },
  {
    id: 'tpl-collab-renewal',
    category: 'collaborative',
    title: 'Renew Collaborative Agreement',
    description: 'Renew collaborative agreement before expiration.',
    defaultInstructions: [
      'Review current agreement terms',
      'Discuss any needed changes with collaborating physician',
      'Complete renewal documentation',
      'Both parties sign renewal',
      'Upload renewed agreement',
    ],
    estimatedTimeMinutes: 45,
    order: 3,
    isActive: true,
  },
  // Compliance tasks
  {
    id: 'tpl-compliance-1',
    category: 'compliance',
    complianceTaskType: 'training_module',
    title: 'Complete HIPAA Training',
    description: 'Annual HIPAA compliance training module.',
    defaultInstructions: [
      'Access training through company learning portal',
      'Complete all training modules',
      'Pass the assessment with minimum 80% score',
      'Download completion certificate',
      'Upload certificate as evidence',
    ],
    estimatedTimeMinutes: 45,
    order: 1,
    isActive: true,
  },
  {
    id: 'tpl-compliance-2',
    category: 'compliance',
    complianceTaskType: 'policy_acknowledgment',
    title: 'Acknowledge Clinical Policies',
    description: 'Review and acknowledge updated clinical policies.',
    defaultInstructions: [
      'Review the attached policy documents',
      'Complete attestation that you have read and understood policies',
      'Submit acknowledgment',
    ],
    estimatedTimeMinutes: 20,
    order: 2,
    isActive: true,
  },
  {
    id: 'tpl-compliance-3',
    category: 'compliance',
    complianceTaskType: 'annual_attestation',
    title: 'Annual Compliance Attestation',
    description: 'Complete annual compliance and credentialing attestation.',
    defaultInstructions: [
      'Review attestation questions',
      'Verify all information is current and accurate',
      'Submit attestation form',
      'Upload any required supporting documents',
    ],
    estimatedTimeMinutes: 30,
    order: 3,
    isActive: true,
  },
  {
    id: 'tpl-renewal-1',
    category: 'licensure',
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
  const state = states.find(s => s.id === stateId);
  const baseDate = new Date();
  
  if (stateId === 'ca') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        category: 'licensure',
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
        demandReason: state?.demandTag === 'critical' ? `${state.abbreviation} is Critical: ${state.demandNotes}` : undefined,
      },
      {
        id: `task-${providerId}-${stateId}-2`,
        providerId,
        stateId,
        category: 'licensure',
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
        demandReason: state?.demandTag === 'critical' ? `${state.abbreviation} is Critical: ${state.demandNotes}` : undefined,
      },
      {
        id: `task-${providerId}-${stateId}-3`,
        providerId,
        stateId,
        category: 'licensure',
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
      {
        id: `task-${providerId}-${stateId}-4`,
        providerId,
        stateId,
        category: 'licensure',
        licenseType: 'prescriptive_authority',
        title: 'Apply for Furnishing License',
        description: 'Submit application for furnishing (prescriptive) authority in California.',
        instructions: [
          'Complete CA furnishing number application',
          'Submit standardized procedure with supervising physician',
          'Pay furnishing license fee',
          'Upload confirmation',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 45,
        estimatedFee: 50,
        evidence: [],
        notes: [],
        order: 4,
      },
      {
        id: `task-${providerId}-${stateId}-5`,
        providerId,
        stateId,
        category: 'collaborative',
        title: 'Execute Collaborative Agreement',
        description: 'Complete and sign standardized procedure agreement with supervising physician.',
        instructions: [
          'Review California standardized procedure requirements',
          'Coordinate with Dr. Robert Martinez (assigned collaborating physician)',
          'Complete standardized procedure agreement form',
          'Both parties sign the agreement',
          'Submit to California Board of Registered Nursing',
          'Upload signed agreement as evidence',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 60,
        estimatedFee: 0,
        evidence: [],
        notes: [],
        order: 5,
        demandReason: state?.demandTag === 'critical' ? `${state.abbreviation} is Critical: ${state.demandNotes}` : undefined,
      },
      // Compliance tasks
      {
        id: `task-${providerId}-${stateId}-compliance-1`,
        providerId,
        stateId,
        category: 'compliance',
        complianceTaskType: 'training_module',
        title: 'Complete HIPAA Training',
        description: 'Annual HIPAA compliance training module.',
        instructions: [
          'Access training through company learning portal',
          'Complete all training modules',
          'Pass the assessment with minimum 80% score',
          'Download completion certificate',
          'Upload certificate as evidence',
        ],
        status: 'approved',
        estimatedTimeMinutes: 45,
        estimatedFee: 0,
        completedAt: new Date('2024-01-05'),
        evidence: [],
        notes: [],
        order: 10,
        externalContentUrl: 'https://learning.example.com/hipaa',
        requiresAttestation: true,
      },
      {
        id: `task-${providerId}-${stateId}-compliance-2`,
        providerId,
        stateId,
        category: 'compliance',
        complianceTaskType: 'policy_acknowledgment',
        title: 'Acknowledge Clinical Policies',
        description: 'Review and acknowledge updated clinical policies.',
        instructions: [
          'Review the attached policy documents',
          'Complete attestation that you have read and understood policies',
          'Submit acknowledgment',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 20,
        estimatedFee: 0,
        dueDate: new Date('2024-02-15'),
        evidence: [],
        notes: [],
        order: 11,
        externalContentUrl: 'https://policies.example.com/clinical',
        requiresAttestation: true,
      },
    ];
  }
  
  if (stateId === 'tx') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        category: 'licensure',
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
        demandReason: state?.demandTag === 'at_risk' ? `${state.abbreviation} is At Risk: ${state.demandNotes}` : undefined,
      },
      {
        id: `task-${providerId}-${stateId}-2`,
        providerId,
        stateId,
        category: 'collaborative',
        title: 'Execute Prescriptive Authority Agreement',
        description: 'Complete prescriptive authority agreement with supervising physician.',
        instructions: [
          'Review Texas prescriptive authority agreement requirements',
          'Coordinate with assigned collaborating physician',
          'Complete prescriptive authority agreement form',
          'Note: 30-day waiting period applies before delegation begins',
          'Both parties sign the agreement',
          'Submit to Texas Board of Nursing',
          'Upload signed agreement as evidence',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 60,
        estimatedFee: 0,
        evidence: [],
        notes: [],
        order: 2,
        demandReason: state?.demandTag === 'at_risk' ? `${state.abbreviation} is At Risk: ${state.demandNotes}` : undefined,
      },
    ];
  }
  
  if (stateId === 'az') {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        category: 'licensure',
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
        category: 'licensure',
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

// Create provider states with unified readiness
const createProviderStates = (providerId: string): ProviderState[] => {
  const providerStates: ProviderState[] = [];
  
  // California - in progress
  const caState = states.find(s => s.id === 'ca')!;
  const caTasks = createTasksForState(providerId, 'ca', 'California');
  providerStates.push({
    id: `ps-${providerId}-ca`,
    providerId,
    stateId: 'ca',
    state: caState,
    isLicensed: false,
    isApprovedToPractice: false,
    isReadyForActivation: false,
    licensureComplete: false,
    collaborativeComplete: false,
    complianceComplete: false,
    licenses: [],
    tasks: caTasks,
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
    licensureComplete: false,
    collaborativeComplete: false,
    complianceComplete: true,
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
    licensureComplete: true,
    collaborativeComplete: true, // Not required for FPA state
    complianceComplete: true,
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
    licensureComplete: false,
    collaborativeComplete: false,
    complianceComplete: true,
    licenses: [],
    tasks: createTasksForState(providerId, 'fl', 'Florida'),
  });
  
  return providerStates;
};

// Mock providers with compliance status
export const providers: Provider[] = [
  {
    id: 'provider-1',
    email: 'emily.johnson@example.com',
    firstName: 'Emily',
    lastName: 'Johnson',
    role: 'provider',
    npiNumber: '1234567890',
    specialty: 'Family Nurse Practitioner',
    hireDate: new Date('2023-06-15'),
    createdAt: new Date('2023-06-15'),
    states: createProviderStates('provider-1'),
    complianceStatus: {
      isCompliant: false,
      completedTasks: 3,
      totalTasks: 5,
      overdueTasks: 1,
      nextDueDate: new Date('2024-02-15'),
    },
  },
  {
    id: 'provider-2',
    email: 'michael.chen@example.com',
    firstName: 'Michael',
    lastName: 'Chen',
    role: 'provider',
    npiNumber: '0987654321',
    specialty: 'Adult-Gerontology Nurse Practitioner',
    hireDate: new Date('2023-08-01'),
    createdAt: new Date('2023-08-01'),
    states: createProviderStates('provider-2'),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 5,
      totalTasks: 5,
      overdueTasks: 0,
    },
  },
  {
    id: 'provider-3',
    email: 'sarah.williams@example.com',
    firstName: 'Sarah',
    lastName: 'Williams',
    role: 'provider',
    npiNumber: '5678901234',
    specialty: 'Psychiatric Mental Health Nurse Practitioner',
    hireDate: new Date('2023-09-15'),
    createdAt: new Date('2023-09-15'),
    states: createProviderStates('provider-3'),
    complianceStatus: {
      isCompliant: false,
      completedTasks: 2,
      totalTasks: 5,
      overdueTasks: 2,
      nextDueDate: new Date('2024-01-30'),
    },
  },
];

// Collaborative Agreements
export const collaborativeAgreements: CollaborativeAgreement[] = [
  {
    id: 'agreement-1',
    stateId: 'ca',
    physicianId: 'physician-1',
    providerIds: ['provider-1'],
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-01-01'),
    renewalCadence: 'annual',
    nextRenewalDate: new Date('2024-12-01'),
    status: 'active',
    meetingCadence: 'monthly',
    chartReviewRequired: true,
    chartReviewFrequency: '5% of charts monthly',
    supervisoryActivities: ['Case consultation', 'Chart review', 'Protocol review'],
    documentUrl: '/agreements/ca-agreement-1.pdf',
    signedAt: new Date('2024-01-01'),
    tasks: [],
  },
  {
    id: 'agreement-2',
    stateId: 'tx',
    physicianId: 'physician-2',
    providerIds: ['provider-1', 'provider-2'],
    startDate: new Date('2023-11-01'),
    endDate: new Date('2024-11-01'),
    renewalCadence: 'annual',
    nextRenewalDate: new Date('2024-10-01'),
    status: 'pending_renewal',
    meetingCadence: 'monthly',
    chartReviewRequired: true,
    chartReviewFrequency: '10% of charts',
    supervisoryActivities: ['Prescriptive authority agreement review', 'Chart review', 'Quality assurance meetings'],
    documentUrl: '/agreements/tx-agreement-2.pdf',
    signedAt: new Date('2023-11-01'),
    tasks: [],
  },
];

// Supervision Meetings
export const supervisionMeetings: SupervisionMeeting[] = [
  {
    id: 'meeting-1',
    agreementId: 'agreement-1',
    scheduledDate: new Date('2024-02-15T14:00:00'),
    duration: 60,
    type: 'collaborative_meeting',
    status: 'scheduled',
    attendees: {
      physicianId: 'physician-1',
      providerIds: ['provider-1'],
    },
  },
  {
    id: 'meeting-2',
    agreementId: 'agreement-1',
    scheduledDate: new Date('2024-01-15T14:00:00'),
    duration: 30,
    type: 'chart_review',
    status: 'completed',
    attendees: {
      physicianId: 'physician-1',
      providerIds: ['provider-1'],
    },
    chartReviewMaterials: ['/charts/review-jan-2024.pdf'],
    chartCount: 12,
    completedAt: new Date('2024-01-15T14:45:00'),
    notes: 'Reviewed 12 charts. All documentation satisfactory. Discussed complex case management.',
  },
  {
    id: 'meeting-3',
    agreementId: 'agreement-2',
    scheduledDate: new Date('2024-02-20T10:00:00'),
    duration: 60,
    type: 'collaborative_meeting',
    status: 'scheduled',
    attendees: {
      physicianId: 'physician-2',
      providerIds: ['provider-1', 'provider-2'],
    },
  },
];

// Self-reported licenses pending verification
export const selfReportedLicenses: SelfReportedLicense[] = [
  {
    id: 'srl-1',
    providerId: 'provider-2',
    stateId: 'ny',
    licenseNumber: 'NY-NP-2023-98765',
    expirationDate: new Date('2025-06-30'),
    evidenceUrl: '/uploads/ny-license-provider-2.pdf',
    submittedAt: new Date('2024-01-20'),
    verificationStatus: 'pending',
  },
  {
    id: 'srl-2',
    providerId: 'provider-3',
    stateId: 'co',
    licenseNumber: 'CO-NP-2022-54321',
    expirationDate: new Date('2024-12-31'),
    evidenceUrl: '/uploads/co-license-provider-3.pdf',
    submittedAt: new Date('2024-01-18'),
    verificationStatus: 'verified',
    verifiedBy: 'admin-1',
    verifiedAt: new Date('2024-01-19'),
  },
];

// Set current user for demo
export const currentUser: Provider = providers[0];

// Helper functions
export function getProviderStats(provider: Provider) {
  const totalStates = provider.states.length;
  const licensedStates = provider.states.filter(s => s.isLicensed).length;
  const approvedStates = provider.states.filter(s => s.isApprovedToPractice).length;
  
  const allTasks = provider.states.flatMap(s => s.tasks);
  const pendingTasks = allTasks.filter(t => 
    ['not_started', 'in_progress', 'submitted'].includes(t.status)
  ).length;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;
  
  const pendingReimbursements = allTasks.filter(t => 
    t.reimbursement?.status === 'pending'
  ).length;
  
  const complianceTasks = allTasks.filter(t => t.category === 'compliance');
  const overdueComplianceTasks = complianceTasks.filter(t => 
    t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved'
  ).length;

  return {
    totalStates,
    licensedStates,
    approvedStates,
    pendingTasks,
    blockedTasks,
    pendingReimbursements,
    complianceComplete: provider.complianceStatus?.isCompliant ?? false,
    overdueComplianceTasks,
  };
}

export function getAllTasks(): Task[] {
  return providers.flatMap(p => p.states.flatMap(s => s.tasks));
}

export function getTasksByCategory(category: 'licensure' | 'collaborative' | 'compliance'): Task[] {
  return getAllTasks().filter(t => t.category === category);
}

export function getAgreementsByPhysician(physicianId: string): CollaborativeAgreement[] {
  return collaborativeAgreements.filter(a => a.physicianId === physicianId);
}

export function getUpcomingMeetings(days: number = 30): SupervisionMeeting[] {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return supervisionMeetings.filter(m => 
    m.status === 'scheduled' && 
    new Date(m.scheduledDate) >= now && 
    new Date(m.scheduledDate) <= futureDate
  );
}

export function getPendingLicenseVerifications(): SelfReportedLicense[] {
  return selfReportedLicenses.filter(l => l.verificationStatus === 'pending');
}

export function getStatesByDemandTag(tag: 'critical' | 'at_risk' | 'watch' | 'stable'): State[] {
  return states.filter(s => s.demandTag === tag);
}
