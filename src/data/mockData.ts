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

// US States with full regulatory intelligence - Enhanced with Notion data
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
      meetingCadence: 'quarterly', // First year quarterly, then annually
      chartReviewRequired: true,
      chartReviewFrequency: '5% of charts quarterly, then annually',
      supervisoryActivities: ['Case consultation', 'Chart review', 'Protocol review', 'Standardized procedure review'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Furnishing license required as separate licensure. Must have standardized procedure with supervising physician. NP:MD ratio is 4.',
    notes: 'Requires furnishing license AND standardized procedure agreement. CA is NOT part of NLC. Board of Registered Nursing processes applications.',
    scopeLimitations: ['Schedule II controlled substances require physician co-signature', 'Standardized procedure must be on file'],
    specialConsiderations: ['License renewal requires 30 CEU hours every 2 years', 'Not part of Nurse Licensure Compact'],
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
      chartReviewFrequency: '10% of charts monthly',
      supervisoryActivities: ['Monthly supervision meetings', 'Chart review', 'Prescriptive delegation review', 'TMB portal verification'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Prescriptive authority specified in collaborative agreement via TMB portal. 30-day waiting period before delegation begins. NP:MD ratio is 7 FTE.',
    notes: 'Collaborative agreement processed through Texas Medical Board (TMB) website. NPs must create TMB account with license number and SSN. Part of NLC.',
    scopeLimitations: ['Cannot prescribe Schedule II without delegation agreement', 'Site-based practice agreement required'],
    specialConsiderations: ['Must notify board of practice site changes within 10 days', 'TMB verification required', 'Part of Nurse Licensure Compact'],
    applicationFeeRange: { min: 186, max: 250 },
    processingTimeWeeks: { min: 6, max: 12 },
    lastUpdated: new Date('2024-01-10'),
  },
  {
    id: 'nc',
    name: 'North Carolina',
    abbreviation: 'NC',
    demandTag: 'at_risk',
    demandNotes: 'Growing demand in Charlotte and Raleigh metros',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'monthly', // Monthly for first 6 months, then every 6 months
      chartReviewRequired: true,
      chartReviewFrequency: 'Monthly for first 6 months, then semi-annually',
      supervisoryActivities: ['Collaborative Practice Agreement review', 'Chart review', 'Case consultation'],
    },
    requiresPrescriptiveAuthority: false,
    prescriptiveAuthorityNotes: 'Prescriptive authority included in collaborative practice agreement.',
    notes: 'Collaborative Practice Agreement (CPA) required. Monthly meetings for first 6 months, then every 6 months thereafter.',
    scopeLimitations: [],
    specialConsiderations: ['Meeting cadence changes after 6 months'],
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'va',
    name: 'Virginia',
    abbreviation: 'VA',
    demandTag: 'watch',
    demandNotes: 'Northern Virginia market monitoring',
    hasFPA: true,
    fpaEligibilityCriteria: ['5 years of full-time clinical experience', 'Or 2 years with practice agreement'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: true, // Unless autonomous
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: true,
      chartReviewFrequency: 'Quarterly chart review sessions',
      supervisoryActivities: ['Quarterly supervision meetings', 'Chart review', 'Quality assurance'],
    },
    requiresPrescriptiveAuthority: false,
    notes: 'Practice agreement required unless provider qualifies for autonomous practice. Quarterly meetings required for non-autonomous NPs.',
    specialConsiderations: ['FPA available after meeting hour requirements'],
    applicationFeeRange: { min: 130, max: 200 },
    processingTimeWeeks: { min: 6, max: 10 },
    lastUpdated: new Date('2024-01-18'),
  },
  {
    id: 'ar',
    name: 'Arkansas',
    abbreviation: 'AR',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: true,
      chartReviewFrequency: 'Quarterly',
      supervisoryActivities: ['Quarterly supervision meetings', 'Chart review'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Prescriptive authority requires collaborative practice agreement.',
    notes: 'Quarterly meetings required. Part of supervision calendar.',
    applicationFeeRange: { min: 75, max: 150 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-12'),
  },
  {
    id: 'oh',
    name: 'Ohio',
    abbreviation: 'OH',
    demandTag: 'watch',
    demandNotes: 'Evaluating Columbus and Cleveland markets',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly', // Periodic - coordinate directly
      chartReviewRequired: true,
      chartReviewFrequency: 'Periodic - coordinate directly',
      supervisoryActivities: ['Standard Care Arrangement review', 'Periodic meetings', 'Chart review'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Standard Care Arrangement (SCA) required. Prescriptive authority application separate.',
    notes: 'Ohio uses Standard Care Arrangements (SCAs). Periodic meetings required - coordinate directly with collaborating physician.',
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 6, max: 12 },
    lastUpdated: new Date('2024-01-15'),
  },
  {
    id: 'wi',
    name: 'Wisconsin',
    abbreviation: 'WI',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly', // Periodic
      chartReviewRequired: false,
      supervisoryActivities: ['Collaborative relationship documentation', 'Periodic consultation'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Advanced Practice Nurse Prescriber (APNP) certification required.',
    notes: 'Wisconsin uses APNP designation. Periodic meetings - coordinate directly. Collaborative agreement uploaded to Modio as state document.',
    applicationFeeRange: { min: 90, max: 150 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-10'),
  },
  {
    id: 'pa',
    name: 'Pennsylvania',
    abbreviation: 'PA',
    demandTag: 'at_risk',
    demandNotes: 'Philadelphia metro expansion underway',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly', // No regularly scheduled meetings required per Notion
      chartReviewRequired: false,
      supervisoryActivities: ['Collaborative agreement on file', 'Available for consultation'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Must apply through PALS portal. Collaborative agreement required.',
    notes: 'No regularly scheduled meetings required per state regulations. Agreement processed via PALS portal.',
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 8, max: 14 },
    lastUpdated: new Date('2024-01-08'),
  },
  {
    id: 'wv',
    name: 'West Virginia',
    abbreviation: 'WV',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['3 years collaborative practice'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: false,
      supervisoryActivities: ['Collaborative practice documentation'],
    },
    requiresPrescriptiveAuthority: false,
    notes: 'No regularly scheduled meetings required. FPA available after 3 years.',
    applicationFeeRange: { min: 75, max: 125 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-05'),
  },
  {
    id: 'nj',
    name: 'New Jersey',
    abbreviation: 'NJ',
    demandTag: 'watch',
    demandNotes: 'Northern NJ market evaluation',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: false,
      supervisoryActivities: ['Joint Protocol agreement', 'Consultation availability', 'Response timeframe defined'],
    },
    requiresPrescriptiveAuthority: false,
    prescriptiveAuthorityNotes: 'Included in Joint Protocol agreement.',
    notes: 'New Jersey uses Joint Protocols. APN (Advanced Practice Nurse) terminology. Protocol must specify methods of contact and response timeframes.',
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 6, max: 12 },
    lastUpdated: new Date('2024-01-10'),
  },
  {
    id: 'ok',
    name: 'Oklahoma',
    abbreviation: 'OK',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: false,
      supervisoryActivities: ['Prescriptive authority agreement', 'Physician supervision documentation'],
    },
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'Apply through OK nursing portal. Physician must be in active practice 20+ hrs/week. Max 6 NPs per physician unless exception granted.',
    notes: 'Supervising physician must have 20+ hours/week direct patient contact. NP:MD ratio is 6. Agreement must be notarized.',
    scopeLimitations: ['Max 6 NPs per physician'],
    applicationFeeRange: { min: 85, max: 150 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-12'),
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
    notes: 'Full Practice Authority state. Streamlined application process. Part of NLC.',
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
  // MD-Only States (from Notion)
  {
    id: 'sc',
    name: 'South Carolina',
    abbreviation: 'SC',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'MD ONLY STATE - Telemedicine services must be provided by licensed physicians only. NPs not permitted for telehealth.',
    mdOnlyRules: ['All telehealth encounters must be conducted by MD/DO'],
    applicationFeeRange: { min: 0, max: 0 },
    processingTimeWeeks: { min: 0, max: 0 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'tn',
    name: 'Tennessee',
    abbreviation: 'TN',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'MD ONLY STATE - Telemedicine services must be provided by licensed physicians only.',
    mdOnlyRules: ['All telehealth encounters must be conducted by MD/DO'],
    applicationFeeRange: { min: 0, max: 0 },
    processingTimeWeeks: { min: 0, max: 0 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'al',
    name: 'Alabama',
    abbreviation: 'AL',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'MD ONLY STATE - Telemedicine services must be provided by licensed physicians only.',
    mdOnlyRules: ['All telehealth encounters must be conducted by MD/DO'],
    applicationFeeRange: { min: 0, max: 0 },
    processingTimeWeeks: { min: 0, max: 0 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'ga',
    name: 'Georgia',
    abbreviation: 'GA',
    demandTag: 'at_risk',
    demandNotes: 'Atlanta metro demand growing',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'MD ONLY STATE - Telemedicine services must be provided by licensed physicians only.',
    mdOnlyRules: ['All telehealth encounters must be conducted by MD/DO'],
    applicationFeeRange: { min: 0, max: 0 },
    processingTimeWeeks: { min: 0, max: 0 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'in',
    name: 'Indiana',
    abbreviation: 'IN',
    demandTag: 'stable',
    hasFPA: false,
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'MD ONLY STATE - Telemedicine services must be provided by licensed physicians only.',
    mdOnlyRules: ['All telehealth encounters must be conducted by MD/DO'],
    applicationFeeRange: { min: 0, max: 0 },
    processingTimeWeeks: { min: 0, max: 0 },
    lastUpdated: new Date('2024-01-20'),
  },
  {
    id: 'ky',
    name: 'Kentucky',
    abbreviation: 'KY',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['Independent practice available', 'Prescriptive authority online application'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: true,
    prescriptiveAuthorityNotes: 'CAPA-NS for non-controlled substances required. Apply through board of nursing.',
    notes: 'Kentucky grants independent practice. Prescriptive authority (CAPA-NS) applied for separately through nursing portal.',
    applicationFeeRange: { min: 100, max: 175 },
    processingTimeWeeks: { min: 4, max: 8 },
    lastUpdated: new Date('2024-01-15'),
  },
  {
    id: 'sd',
    name: 'South Dakota',
    abbreviation: 'SD',
    demandTag: 'stable',
    hasFPA: false,
    fpaEligibilityCriteria: ['1,040 hours of licensed CNP practice'],
    fpaApplicationRequired: true,
    requiresCollaborativeAgreement: true,
    collaborativeAgreementRequirements: {
      meetingCadence: 'quarterly',
      chartReviewRequired: false,
      supervisoryActivities: ['Practice Verification Form submission upon completion'],
    },
    requiresPrescriptiveAuthority: false,
    notes: 'Collaborative agreement required initially. After 1,040 licensed CNP practice hours, can retire agreement via Practice Verification Form 3. Hours on temporary permit do not count.',
    specialConsiderations: ['Transition to autonomous practice after hour requirements met'],
    applicationFeeRange: { min: 75, max: 125 },
    processingTimeWeeks: { min: 4, max: 6 },
    lastUpdated: new Date('2024-01-10'),
  },
  {
    id: 'ut',
    name: 'Utah',
    abbreviation: 'UT',
    demandTag: 'stable',
    hasFPA: true,
    fpaEligibilityCriteria: ['No additional requirements'],
    fpaApplicationRequired: false,
    requiresCollaborativeAgreement: false,
    requiresPrescriptiveAuthority: false,
    notes: 'Utah has transitioned to full practice authority. No collaborative agreement required.',
    applicationFeeRange: { min: 100, max: 150 },
    processingTimeWeeks: { min: 4, max: 6 },
    lastUpdated: new Date('2024-01-08'),
  },
];

// Collaborating Physicians - Enhanced with Notion data
export const collaboratingPhysicians: CollaboratingPhysician[] = [
  {
    id: 'physician-1',
    email: 'dr.dinowitz@vitablehealth.com',
    firstName: 'Seth',
    lastName: 'Dinowitz',
    role: 'physician',
    npiNumber: '1234567890',
    specialty: 'Internal Medicine',
    licenseNumber: 'TX-MD-123456',
    licenseState: 'tx',
    createdAt: new Date('2023-06-01'),
    agreements: [],
  },
  {
    id: 'physician-2',
    email: 'dr.baron@vitablehealth.com',
    firstName: 'Kate',
    lastName: 'Baron',
    role: 'physician',
    npiNumber: '0987654321',
    specialty: 'Family Medicine',
    licenseNumber: 'CA-MD-789012',
    licenseState: 'ca',
    createdAt: new Date('2023-08-15'),
    agreements: [],
  },
];

// Knowledge Base Articles - from Notion SOPs
export interface KnowledgeBaseArticle {
  id: string;
  title: string;
  category: 'state_guides' | 'sop' | 'training' | 'compliance' | 'templates';
  subcategory?: string;
  summary: string;
  content: string;
  stateId?: string;
  lastUpdated: Date;
  tags: string[];
  sourceUrl?: string;
}

export const knowledgeBaseArticles: KnowledgeBaseArticle[] = [
  // State Guides
  {
    id: 'kb-tx-collab',
    title: 'Texas Collaborative Agreements',
    category: 'state_guides',
    subcategory: 'Collaborative Agreements',
    stateId: 'tx',
    summary: 'Complete guide to establishing prescriptive delegation agreements through the Texas Medical Board (TMB).',
    content: `# Texas Collaborative Agreements (Required)

## Background
This protocol outlines the process for establishing and documenting prescriptive delegation agreements between nurse practitioners and supervising physicians in Texas through the Texas Medical Board (TMB).

## Requirements
- **NP:MD Ratio**: No more than 7 APRNs or PAs, or their full-time equivalents
- **Meeting Cadence**: Monthly supervision meetings required
- **Chart Review**: 10% of charts monthly

## Process Overview
1. Provider creates account on TMB website (sso.tmb.state.tx.us)
2. Enter Texas license number, last 4 SSN, DOB
3. Complete prescriptive delegation agreement
4. 30-day waiting period before delegation begins
5. Upload signed agreement to Box and Modio

## Key Systems
- **TMB Portal**: Primary application system
- **Box**: Document storage and e-signatures
- **Modio**: Credentialing record storage`,
    lastUpdated: new Date('2024-01-10'),
    tags: ['texas', 'collaborative', 'tmb', 'prescriptive authority'],
    sourceUrl: 'https://sso.tmb.state.tx.us',
  },
  {
    id: 'kb-ca-collab',
    title: 'California Standardized Procedures & Furnishing',
    category: 'state_guides',
    subcategory: 'Prescriptive Authority',
    stateId: 'ca',
    summary: 'Guide to California furnishing license and standardized procedure requirements.',
    content: `# California Requirements

## Overview
California requires NPs to have both a furnishing license AND a standardized procedure agreement with a supervising physician.

## Requirements
- **Furnishing License**: Separate licensure required for prescriptive authority
- **NP:MD Ratio**: 4 NPs per physician
- **Meeting Cadence**: Quarterly for first year, then annually
- **NOT part of Nurse Licensure Compact (NLC)**

## Steps to Confirm Eligibility
1. Ensure provider has active RN and NP licenses in Modio
2. Ensure provider has furnishing license in Modio
3. If no furnishing license, ensure collaborative agreement is signed and present

## Source
California Board of Registered Nursing: rn.ca.gov/practice/np.shtml`,
    lastUpdated: new Date('2024-01-15'),
    tags: ['california', 'furnishing', 'standardized procedure'],
    sourceUrl: 'https://www.rn.ca.gov/practice/np.shtml',
  },
  {
    id: 'kb-nj-joint',
    title: 'New Jersey Joint Protocols',
    category: 'state_guides',
    subcategory: 'Collaborative Agreements',
    stateId: 'nj',
    summary: 'Guide to establishing Joint Protocol agreements in New Jersey.',
    content: `# New Jersey Joint Protocols (Required)

## Background
New Jersey requires APNs (Advanced Practice Nurses) to practice under a joint protocol with a collaborating physician.

## Key Requirements
- Joint protocol must be in writing and signed by both parties
- Protocol outlines scope of practice and consultation procedures
- Must specify methods of contact, circumstances requiring consultation, and response timeframes

## Physician Supervision
Per N.J.A.C. 13:37-6.3:
- Collaborating physician must be available for consultation
- Availability may be maintained through electronic means (phone, email, video)
- No regularly scheduled meetings required by state regulation

## Process
1. Prepare Joint Protocol document
2. Both parties sign via Box
3. Upload to Modio as state documentation
4. Maintain on file for regulatory review`,
    lastUpdated: new Date('2024-01-10'),
    tags: ['new jersey', 'joint protocol', 'apn'],
  },
  {
    id: 'kb-oh-sca',
    title: 'Ohio Standard Care Arrangements',
    category: 'state_guides',
    subcategory: 'Collaborative Agreements',
    stateId: 'oh',
    summary: 'Guide to establishing Standard Care Arrangements (SCAs) in Ohio.',
    content: `# Ohio Standard Care Arrangements (Required)

## Background
Ohio requires APRNs to have Standard Care Arrangements (SCAs) with collaborating physicians.

## Requirements
- Standard Care Arrangement required
- Prescriptive authority is a separate application
- Periodic meetings required (coordinate directly with physician)

## Key Terms
- **SCA**: Standard Care Arrangement
- **APRN**: Advanced Practice Registered Nurse

## Process
1. Complete SCA documentation
2. Apply separately for prescriptive authority
3. Upload agreement to Modio
4. Coordinate meeting schedule with collaborating physician`,
    lastUpdated: new Date('2024-01-15'),
    tags: ['ohio', 'sca', 'standard care arrangement'],
  },
  {
    id: 'kb-ok-collab',
    title: 'Oklahoma Prescriptive Authority Agreements',
    category: 'state_guides',
    subcategory: 'Prescriptive Authority',
    stateId: 'ok',
    summary: 'Guide to establishing prescriptive authority agreements in Oklahoma.',
    content: `# Oklahoma Collaborative Agreements (Required)

## Requirements
- Prescriptive agreement with physician required
- Supervising physician must be in active clinical practice (20+ hours/week direct patient contact)
- **NP:MD Ratio**: Maximum 6 NPs per physician unless board exception granted
- Agreement must be signed AND notarized by supervising physician

## Application Process
1. Apply for prescriptive authority through OK nursing portal
2. Complete Agreement for Physician Supervising Advanced Practice Prescriptive Authority form
3. Get physician signature and notarization
4. Upload to NP's OK nurse portal

## Document Storage
Upload completed agreement to Google Drive folder for Oklahoma.`,
    lastUpdated: new Date('2024-01-12'),
    tags: ['oklahoma', 'prescriptive authority', 'notarized'],
  },
  // SOPs
  {
    id: 'kb-sop-collab-process',
    title: 'Collaborative Agreement Execution SOP',
    category: 'sop',
    summary: 'Standard operating procedure for initiating and completing collaborative agreements.',
    content: `# Collaborative Agreement Process

## Trigger
Once credentialing audit is completed, provider ops can initiate the collaborative agreement process when required.

## Steps

### 1. Access Box
- Log into Box: app.box.com/sign
- Use Clinical Operations login from 1Password

### 2. Select Template
- Navigate to Sign > Templates
- Select appropriate state template

### 3. Prepare Agreement
- Add signer details (NP first, Physician second)
- Pre-fill required information

### 4. Send for Signatures
1. NP signs first
2. Supervising physician signs second
3. Click "Send Request"

### 5. Notify Provider
Send email notification that they will receive signing request via Box.

### 6. Monitor Completion
- Watch Box for completed signatures
- Download signed agreement

### 7. Upload to Systems
- Upload to Modio as "Collaborative Agreement"
- Update Notion Provider-State Status
- Set expiration date if applicable`,
    lastUpdated: new Date('2024-01-20'),
    tags: ['sop', 'collaborative', 'box', 'modio'],
  },
  {
    id: 'kb-sop-supervision',
    title: 'Monthly Supervision Requirements SOP',
    category: 'sop',
    summary: 'Process for scheduling and conducting supervision meetings and chart reviews.',
    content: `# Monthly Supervision Requirements

## State Meeting Requirements

| State | Cadence | Notes |
|-------|---------|-------|
| Texas | Monthly | Last Monday of each month |
| North Carolina | Monthly → 6 months | First 6 months monthly, then every 6 months |
| Virginia | Quarterly | |
| Arkansas | Quarterly | |
| Ohio | Periodic | Coordinate directly |
| Wisconsin | Periodic | Coordinate directly |
| Pennsylvania | None | No scheduled meetings required |
| West Virginia | None | No scheduled meetings required |

## Process

### Meeting Setup
- All recurring meetings on Collabs/Supervision Calendar
- Add new providers to appropriate state invite
- Create chart review template for new providers

### Chart Pulling (1 week before meeting)
1. Open provider's chart review log
2. Copy Template tab, name with month/year
3. Log into EHR (providers.vitablehealth.com)
4. Filter: Date range, Provider, State, Status=Completed
5. Pull 5 telehealth primary care charts per provider
6. Upload to shared drive

### Communication
**1 Week Before**: Send chart review email to physician and provider
**Day After Meeting**: Send reminder if not acknowledged
**After Meeting**: Confirm completion documented`,
    lastUpdated: new Date('2024-01-25'),
    tags: ['sop', 'supervision', 'chart review', 'meetings'],
  },
  {
    id: 'kb-sop-credentialing',
    title: 'How to Start Credentialing with New Provider',
    category: 'sop',
    summary: 'Complete onboarding credentialing process for new providers.',
    content: `# Credentialing Process for New Providers

## Step 1: Review Provider-State Status
Check the Provider-State Status database in Notion to identify:
- States where provider is licensed
- States requiring collaborative agreements
- Current credentialing status

## Step 2: License Verification
1. Verify licenses in Modio
2. Check expiration dates
3. Confirm NPI number

## Step 3: Determine Requirements
For each state:
- Does it require collaborative agreement?
- Is prescriptive/furnishing authority separate?
- What is the meeting cadence?

## Step 4: Initiate Agreements
If collaborative agreement required:
1. Assign collaborating physician
2. Draft agreement using Box template
3. Send for signatures
4. Upload to Modio and Notion

## Step 5: Complete Credentialing
1. Verify all documents uploaded
2. Update credentialing status
3. Mark provider ready for activation if complete`,
    lastUpdated: new Date('2024-01-20'),
    tags: ['credentialing', 'onboarding', 'new provider'],
  },
  // Training
  {
    id: 'kb-training-np',
    title: 'New Provider Training: Nurse Practitioner',
    category: 'training',
    summary: 'Complete training and onboarding program for new NPs.',
    content: `# NP Training and Onboarding Program

## Overview
Our training program prepares you to start and excel as a provider at Vitable Health.

## Step 1: Onboarding Training
30-minute training session covering:
- Scope of services
- Provider tools
- Provider expectations

## Step 2: Quality Review Preparation
Vitable runs quality reviews at:
- 2-week mark
- 6-week mark

Purpose: Better support new providers and ensure quality standards.

## Step 3: System Access
Ensure you have access to:
- EHR system
- Slack workspace
- Required documentation

## Step 4: Credentialing Completion
Work with Clinical Operations to:
- Verify all licenses are on file
- Complete collaborative agreements if required
- Acknowledge policies and complete attestations

## Resources
- TalentLMS for online modules
- Provider support via Slack
- Clinical Operations contact for credentialing questions`,
    lastUpdated: new Date('2024-01-28'),
    tags: ['training', 'onboarding', 'new provider', 'np'],
  },
  // Compliance
  {
    id: 'kb-compliance-reimbursement',
    title: 'License Reimbursement Process',
    category: 'compliance',
    summary: 'How to request and process license fee reimbursements.',
    content: `# Processing License Reimbursement Requests

## Policy
License reimbursement may be available depending on provider contract terms.

**Note**: No reimbursement for licenses at this time unless explicitly promised in provider's contract.

## Request Process
1. Provider completes licensure task
2. Provider retains receipt
3. Email receipt to providersupport@vitablehealth.com
4. Reference state and license type

## Communication Template
> Hi [Provider],
> 
> Thank you for your [LICENSE TYPE] license application in [STATE]. 
> Please hold onto your receipt(s) and email them to us once payment is complete. 
> We'll process the reimbursement according to your contract terms.

## Processing
1. Review provider contract for reimbursement eligibility
2. Verify receipt matches application
3. Process through payroll if approved
4. Update task status in system`,
    lastUpdated: new Date('2024-01-15'),
    tags: ['reimbursement', 'license', 'finance'],
  },
  // Templates
  {
    id: 'kb-template-collab-email',
    title: 'Collaborative Agreement Communication Templates',
    category: 'templates',
    summary: 'Email templates for collaborative agreement process.',
    content: `# Collaborative Agreement Email Templates

## Initial Signing Request
Subject: [State] Collaborative Agreement - Action Required

Hi [Provider],

Your [State] collaborative agreement is ready for review and signature.

You will receive a separate email from Box with the signing link. Please review and sign at your earliest convenience.

Your collaborating physician, [Physician Name], will also receive the agreement for their signature.

Let me know if you have any questions.

Best,
[Your Name]
Clinical Operations

---

## Chart Review Reminder (1 Week Before Meeting)

Subject: [Month] Chart Reviews Ready - [State] Meeting

Hi [Supervising Physician] and [Provider],

The [Month] chart reviews for [Provider] are ready for review ahead of your upcoming [State] meeting.

[Provider] - Please complete columns E & F (service provided & information shared) ahead of the meeting date.

Please let me know if you need anything else.

Best,
[Your Name]

---

## Meeting Completion Confirmation

Subject: [Month] [State] Meeting - Confirmation Needed

Hi [Supervising Physician] and [Provider],

Please confirm that your [Month] supervision meeting has been completed and documented.

Thank you,
[Your Name]`,
    lastUpdated: new Date('2024-01-20'),
    tags: ['template', 'email', 'collaborative'],
  },
];

// Task templates for different license types (keep existing but add to it)
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
    stateOverrides: {
      'ca': {
        title: 'Apply for California Furnishing License',
        defaultInstructions: [
          'Log into California Board of Registered Nursing portal',
          'Navigate to furnishing license application',
          'Complete application with collaborating physician details',
          'Submit standardized procedure documentation',
          'Pay furnishing license fee',
          'Upload confirmation as evidence',
        ],
      },
      'ok': {
        title: 'Apply for Oklahoma Prescriptive Authority',
        defaultInstructions: [
          'Access Oklahoma nursing portal',
          'Complete prescriptive authority application',
          'Download Agreement for Physician Supervising form',
          'Obtain supervising physician signature AND notarization',
          'Upload notarized agreement to portal',
          'Keep copy for records',
        ],
      },
    },
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
    stateOverrides: {
      'ny': {
        defaultInstructions: [
          'Verify you have completed 3,600 hours of supervised practice',
          'Obtain written certification from collaborating physician',
          'Complete NY FPA application',
          'Submit supporting documentation',
          'Pay application fee',
        ],
      },
      'wa': {
        defaultInstructions: [
          'Verify you have completed 4,000 hours clinical experience',
          'Complete Washington FPA application',
          'Submit documentation of clinical hours',
          'Pay application fee',
        ],
      },
      'il': {
        defaultInstructions: [
          'Verify you have completed 4,000 hours collaborative practice',
          'Complete Illinois FPA transition application',
          'Submit documentation of collaborative practice hours',
          'Pay application fee',
        ],
      },
    },
  },
  // Collaborative Agreement tasks - Enhanced with Notion knowledge
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
    stateOverrides: {
      'tx': {
        title: 'Complete Texas Prescriptive Delegation Agreement',
        defaultInstructions: [
          'Create account on TMB website (sso.tmb.state.tx.us)',
          'Enter Texas license number, last 4 SSN, and DOB',
          'Navigate to prescriptive delegation section',
          'Complete delegation agreement form',
          'Supervising physician completes their section',
          'Wait 30-day period before delegation begins',
          'Download confirmation and upload to Modio',
        ],
      },
      'nj': {
        title: 'Execute New Jersey Joint Protocol',
        defaultInstructions: [
          'Prepare Joint Protocol document',
          'Include scope of practice and consultation procedures',
          'Define methods of contact and response timeframes',
          'Both parties sign via Box',
          'Upload to Modio as state documentation',
        ],
      },
      'oh': {
        title: 'Complete Ohio Standard Care Arrangement',
        defaultInstructions: [
          'Complete Standard Care Arrangement (SCA) documentation',
          'Coordinate meeting schedule with collaborating physician',
          'Apply separately for prescriptive authority',
          'Upload SCA to Modio',
        ],
      },
    },
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
      'Access training through TalentLMS portal',
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
      'Submit acknowledgment via DocuSign',
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
      'Submit attestation form via DocuSign',
      'Upload any required supporting documents',
    ],
    estimatedTimeMinutes: 30,
    order: 3,
    isActive: true,
  },
  {
    id: 'tpl-compliance-vanta',
    category: 'compliance',
    complianceTaskType: 'training_module',
    title: 'Complete Vanta Security Training',
    description: 'Complete required security awareness training through Vanta.',
    defaultInstructions: [
      'Access Vanta training portal',
      'Complete security awareness modules',
      'Pass assessment',
      'Confirm completion status shows in Vanta',
    ],
    estimatedTimeMinutes: 30,
    order: 4,
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
  totalAmount: 271.25,
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
        title: 'Submit CA License Application',
        description: 'Complete and submit the initial NP license application to the California Board of Registered Nursing.',
        instructions: [
          'Navigate to the California BRN website: rn.ca.gov',
          'Create an account or log in',
          'Complete the NP license application',
          'Upload required documents (transcripts, verification)',
          'Pay the $150 application fee',
          'Screenshot the confirmation page',
        ],
        status: 'in_progress',
        estimatedTimeMinutes: 90,
        estimatedFee: 200,
        dueDate: new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000),
        assignedAt: new Date(baseDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        assignedBy: 'admin-1',
        evidence: mockEvidence,
        reimbursement: mockReimbursement,
        notes: [mockNotes[0]],
        order: 1,
        demandReason: 'CA is Critical - High patient volume growth in Bay Area',
      },
      {
        id: `task-${providerId}-${stateId}-2`,
        providerId,
        stateId,
        category: 'licensure',
        licenseType: 'initial',
        title: 'Submit Background Check',
        description: 'Complete fingerprinting and background check for California.',
        instructions: [
          'Schedule fingerprinting at IdentoGO or approved vendor',
          'Bring valid ID and application receipt',
          'Complete fingerprinting',
          'Keep receipt for records',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 60,
        estimatedFee: 49,
        dueDate: new Date(baseDate.getTime() + 21 * 24 * 60 * 60 * 1000),
        evidence: [],
        notes: [mockNotes[1]],
        order: 2,
      },
      {
        id: `task-${providerId}-${stateId}-3`,
        providerId,
        stateId,
        category: 'licensure',
        licenseType: 'prescriptive_authority',
        title: 'Apply for California Furnishing License',
        description: 'Submit furnishing license application for prescriptive authority in California.',
        instructions: [
          'Log into California BRN portal',
          'Navigate to furnishing license application',
          'Complete application with supervising physician details',
          'Submit standardized procedure documentation',
          'Pay furnishing license fee ($50)',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 45,
        estimatedFee: 50,
        dueDate: new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        evidence: [],
        notes: [],
        order: 3,
      },
      {
        id: `task-${providerId}-${stateId}-collab`,
        providerId,
        stateId,
        category: 'collaborative',
        title: 'Execute CA Standardized Procedure Agreement',
        description: 'Complete and sign standardized procedure agreement with supervising physician.',
        instructions: [
          'Review CA standardized procedure requirements',
          'Coordinate with assigned physician (NP:MD ratio is 4)',
          'Complete standardized procedure form',
          'Both parties sign via Box',
          'Upload to Modio as state documentation',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 60,
        estimatedFee: 0,
        evidence: [],
        notes: [],
        order: 4,
        demandReason: 'Required for CA prescriptive authority',
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
        title: 'Submit TX License Application',
        description: 'Complete NP license application through Texas Board of Nursing.',
        instructions: [
          'Navigate to Texas BON website',
          'Create account with TX license number',
          'Complete application form',
          'Pay application fee ($186)',
          'Upload confirmation as evidence',
        ],
        status: 'submitted',
        estimatedTimeMinutes: 60,
        estimatedFee: 186,
        dueDate: new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000),
        assignedAt: new Date(baseDate.getTime() - 14 * 24 * 60 * 60 * 1000),
        evidence: [],
        notes: [],
        order: 1,
        demandReason: 'TX is At Risk - SLA pressure in Houston/DFW',
      },
      {
        id: `task-${providerId}-${stateId}-collab`,
        providerId,
        stateId,
        category: 'collaborative',
        title: 'Complete Texas Prescriptive Delegation Agreement',
        description: 'Execute prescriptive delegation agreement through Texas Medical Board portal.',
        instructions: [
          'Create account on TMB website (sso.tmb.state.tx.us)',
          'Enter Texas license number, last 4 SSN, and DOB',
          'Navigate to prescriptive delegation section',
          'Complete delegation agreement with Dr. Dinowitz',
          'Wait 30-day period before delegation begins',
          'Download confirmation and upload to Modio',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 45,
        estimatedFee: 0,
        evidence: [],
        notes: [],
        order: 2,
        demandReason: 'Required for TX practice - Monthly meetings with Dr. Dinowitz',
      },
    ];
  }
  
  // Default tasks for FPA states
  if (state?.hasFPA && !state?.requiresCollaborativeAgreement) {
    return [
      {
        id: `task-${providerId}-${stateId}-1`,
        providerId,
        stateId,
        category: 'licensure',
        licenseType: 'initial',
        title: `Submit ${state.abbreviation} License Application`,
        description: `Complete NP license application for ${stateName}.`,
        instructions: [
          `Navigate to ${stateName} nursing board website`,
          'Complete license application',
          'Pay application fee',
          'Upload confirmation',
        ],
        status: 'not_started',
        estimatedTimeMinutes: 60,
        estimatedFee: state.applicationFeeRange.max,
        evidence: [],
        notes: [],
        order: 1,
      },
    ];
  }
  
  // Default tasks for collaborative states
  return [
    {
      id: `task-${providerId}-${stateId}-1`,
      providerId,
      stateId,
      category: 'licensure',
      licenseType: 'initial',
      title: `Submit ${state?.abbreviation || stateId.toUpperCase()} License Application`,
      description: `Complete NP license application for ${stateName}.`,
      instructions: [
        `Navigate to ${stateName} nursing board website`,
        'Complete license application',
        'Pay application fee',
        'Upload confirmation',
      ],
      status: 'not_started',
      estimatedTimeMinutes: 60,
      estimatedFee: state?.applicationFeeRange?.max || 150,
      evidence: [],
      notes: [],
      order: 1,
    },
    ...(state?.requiresCollaborativeAgreement ? [{
      id: `task-${providerId}-${stateId}-collab`,
      providerId,
      stateId,
      category: 'collaborative' as const,
      title: `Execute ${state?.abbreviation} Collaborative Agreement`,
      description: `Complete collaborative agreement for ${stateName}.`,
      instructions: [
        'Review state-specific requirements',
        'Coordinate with assigned collaborating physician',
        'Complete agreement form',
        'Both parties sign',
        'Upload to Modio',
      ],
      status: 'not_started' as const,
      estimatedTimeMinutes: 60,
      estimatedFee: 0,
      evidence: [],
      notes: [],
      order: 2,
    }] : []),
  ];
};

// Create mock provider states
const createProviderStates = (providerId: string, stateIds: string[]): ProviderState[] => {
  return stateIds.map(stateId => {
    const state = states.find(s => s.id === stateId)!;
    const tasks = createTasksForState(providerId, stateId, state.name);
    const isLicensed = tasks.some(t => t.category === 'licensure' && t.status === 'verified');
    const collabComplete = !state.requiresCollaborativeAgreement || 
      tasks.some(t => t.category === 'collaborative' && t.status === 'verified');
    
    return {
      id: `ps-${providerId}-${stateId}`,
      providerId,
      stateId,
      state,
      isLicensed,
      isApprovedToPractice: false,
      isReadyForActivation: isLicensed && collabComplete,
      licensureComplete: isLicensed,
      collaborativeComplete: collabComplete,
      complianceComplete: true,
      licenses: [],
      tasks,
    };
  });
};

// Mock self-reported licenses
export const selfReportedLicenses: SelfReportedLicense[] = [
  {
    id: 'srl-1',
    providerId: 'provider-2',
    stateId: 'ny',
    licenseNumber: 'NY-NP-123456',
    expirationDate: new Date('2025-12-31'),
    evidenceUrl: '/uploads/ny_license.pdf',
    submittedAt: new Date('2024-01-10'),
    verificationStatus: 'pending',
  },
  {
    id: 'srl-2',
    providerId: 'provider-2',
    stateId: 'az',
    licenseNumber: 'AZ-NP-789012',
    expirationDate: new Date('2025-06-30'),
    evidenceUrl: '/uploads/az_license.pdf',
    submittedAt: new Date('2024-01-08'),
    verificationStatus: 'verified',
    verifiedBy: 'admin-1',
    verifiedAt: new Date('2024-01-12'),
  },
  {
    id: 'srl-3',
    providerId: 'provider-3',
    stateId: 'co',
    licenseNumber: 'CO-NP-456789',
    expirationDate: new Date('2025-09-15'),
    evidenceUrl: '/uploads/co_license.pdf',
    submittedAt: new Date('2024-01-15'),
    verificationStatus: 'pending',
  },
];

// Mock providers - with provider types
export const providers: Provider[] = [
  {
    id: 'provider-1',
    email: 'emily.johnson@vitablehealth.com',
    firstName: 'Emily',
    lastName: 'Johnson',
    role: 'provider',
    providerType: 'nurse_practitioner',
    npiNumber: '1122334455',
    specialty: 'Family Nurse Practitioner',
    hireDate: new Date('2023-09-01'),
    createdAt: new Date('2023-09-01'),
    states: createProviderStates('provider-1', ['ca', 'tx']),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 5,
      totalTasks: 5,
      overdueTasks: 0,
    },
  },
  {
    id: 'provider-2',
    email: 'michael.chen@vitablehealth.com',
    firstName: 'Michael',
    lastName: 'Chen',
    role: 'provider',
    providerType: 'nurse_practitioner',
    npiNumber: '5566778899',
    specialty: 'Adult-Gerontology Nurse Practitioner',
    hireDate: new Date('2023-11-15'),
    createdAt: new Date('2023-11-15'),
    states: createProviderStates('provider-2', ['ny', 'az', 'il']),
    selfReportedLicenses: selfReportedLicenses.filter(l => l.providerId === 'provider-2'),
    complianceStatus: {
      isCompliant: false,
      completedTasks: 3,
      totalTasks: 5,
      overdueTasks: 2,
      nextDueDate: new Date('2024-02-01'),
    },
  },
  {
    id: 'provider-3',
    email: 'sarah.williams@vitablehealth.com',
    firstName: 'Sarah',
    lastName: 'Williams',
    role: 'provider',
    providerType: 'nurse_practitioner',
    npiNumber: '9988776655',
    specialty: 'Psychiatric Mental Health Nurse Practitioner',
    hireDate: new Date('2024-01-02'),
    createdAt: new Date('2024-01-02'),
    states: createProviderStates('provider-3', ['co', 'wa']),
    selfReportedLicenses: selfReportedLicenses.filter(l => l.providerId === 'provider-3'),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 5,
      totalTasks: 5,
      overdueTasks: 0,
    },
  },
  // RN providers
  {
    id: 'provider-4',
    email: 'jessica.martinez@vitablehealth.com',
    firstName: 'Jessica',
    lastName: 'Martinez',
    role: 'provider',
    providerType: 'registered_nurse',
    specialty: 'Care Coordination',
    hireDate: new Date('2023-06-15'),
    createdAt: new Date('2023-06-15'),
    states: createProviderStates('provider-4', ['ca', 'ny']),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 4,
      totalTasks: 4,
      overdueTasks: 0,
    },
  },
  {
    id: 'provider-5',
    email: 'david.thompson@vitablehealth.com',
    firstName: 'David',
    lastName: 'Thompson',
    role: 'provider',
    providerType: 'registered_nurse',
    specialty: 'Patient Education',
    hireDate: new Date('2024-01-10'),
    createdAt: new Date('2024-01-10'),
    states: createProviderStates('provider-5', ['tx', 'fl']),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 4,
      totalTasks: 4,
      overdueTasks: 0,
    },
  },
  // Physician
  {
    id: 'provider-6',
    email: 'dr.patel@vitablehealth.com',
    firstName: 'Anita',
    lastName: 'Patel',
    role: 'provider',
    providerType: 'physician',
    npiNumber: '1234509876',
    specialty: 'Internal Medicine',
    hireDate: new Date('2022-03-01'),
    createdAt: new Date('2022-03-01'),
    states: createProviderStates('provider-6', ['ca', 'tx', 'ny', 'fl']),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 5,
      totalTasks: 5,
      overdueTasks: 0,
    },
  },
  // LPC
  {
    id: 'provider-7',
    email: 'amanda.roberts@vitablehealth.com',
    firstName: 'Amanda',
    lastName: 'Roberts',
    role: 'provider',
    providerType: 'licensed_counselor',
    npiNumber: '6789012345',
    specialty: 'Anxiety & Depression',
    hireDate: new Date('2023-08-01'),
    createdAt: new Date('2023-08-01'),
    states: createProviderStates('provider-7', ['tx', 'co']),
    complianceStatus: {
      isCompliant: true,
      completedTasks: 4,
      totalTasks: 4,
      overdueTasks: 0,
    },
  },
  // Mental Health Coaches (no licensure)
  {
    id: 'provider-8',
    email: 'jason.lee@vitablehealth.com',
    firstName: 'Jason',
    lastName: 'Lee',
    role: 'provider',
    providerType: 'mental_health_coach',
    specialty: 'Wellness Coaching',
    hireDate: new Date('2024-01-15'),
    createdAt: new Date('2024-01-15'),
    states: [], // No licensure required
    complianceStatus: {
      isCompliant: true,
      completedTasks: 3,
      totalTasks: 3,
      overdueTasks: 0,
    },
  },
  {
    id: 'provider-9',
    email: 'maria.garcia@vitablehealth.com',
    firstName: 'Maria',
    lastName: 'Garcia',
    role: 'provider',
    providerType: 'mental_health_coach',
    specialty: 'Stress Management',
    hireDate: new Date('2023-12-01'),
    createdAt: new Date('2023-12-01'),
    states: [], // No licensure required
    complianceStatus: {
      isCompliant: false,
      completedTasks: 2,
      totalTasks: 3,
      overdueTasks: 1,
      nextDueDate: new Date('2024-02-15'),
    },
  },
];

// Mock collaborative agreements
export const collaborativeAgreements: CollaborativeAgreement[] = [
  {
    id: 'ca-1',
    stateId: 'tx',
    state: states.find(s => s.id === 'tx'),
    physicianId: 'physician-1',
    physician: collaboratingPhysicians[0],
    providerIds: ['provider-1'],
    providers: [providers[0]],
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-01-01'),
    renewalCadence: 'annual',
    nextRenewalDate: new Date('2024-12-01'),
    status: 'active',
    meetingCadence: 'monthly',
    chartReviewRequired: true,
    chartReviewFrequency: '10% of charts monthly',
    supervisoryActivities: ['Monthly supervision meeting', 'Chart review', 'Prescriptive delegation review'],
    documentUrl: '/documents/tx_collab_agreement.pdf',
    signedAt: new Date('2024-01-05'),
    tasks: [],
  },
  {
    id: 'ca-2',
    stateId: 'ca',
    state: states.find(s => s.id === 'ca'),
    physicianId: 'physician-2',
    physician: collaboratingPhysicians[1],
    providerIds: ['provider-1'],
    providers: [providers[0]],
    startDate: new Date('2024-02-01'),
    endDate: new Date('2025-02-01'),
    renewalCadence: 'annual',
    nextRenewalDate: new Date('2025-01-01'),
    status: 'pending_renewal',
    meetingCadence: 'quarterly',
    chartReviewRequired: true,
    chartReviewFrequency: '5% of charts quarterly',
    supervisoryActivities: ['Quarterly supervision meeting', 'Chart review', 'Standardized procedure review'],
    tasks: [],
  },
];

// Mock supervision meetings
export const supervisionMeetings: SupervisionMeeting[] = [
  {
    id: 'meeting-1',
    agreementId: 'ca-1',
    agreement: collaborativeAgreements[0],
    scheduledDate: new Date('2024-01-29'),
    duration: 60,
    type: 'collaborative_meeting',
    status: 'scheduled',
    attendees: {
      physicianId: 'physician-1',
      providerIds: ['provider-1'],
    },
    chartReviewMaterials: ['January 2024 Chart Review Log'],
    chartCount: 5,
  },
  {
    id: 'meeting-2',
    agreementId: 'ca-1',
    agreement: collaborativeAgreements[0],
    scheduledDate: new Date('2024-02-26'),
    duration: 60,
    type: 'collaborative_meeting',
    status: 'scheduled',
    attendees: {
      physicianId: 'physician-1',
      providerIds: ['provider-1'],
    },
    chartCount: 5,
  },
  {
    id: 'meeting-3',
    agreementId: 'ca-1',
    agreement: collaborativeAgreements[0],
    scheduledDate: new Date('2023-12-28'),
    duration: 60,
    type: 'collaborative_meeting',
    status: 'completed',
    attendees: {
      physicianId: 'physician-1',
      providerIds: ['provider-1'],
    },
    chartCount: 5,
    completedAt: new Date('2023-12-28'),
    notes: 'December monthly meeting completed. All charts reviewed, no issues identified.',
  },
];

// Helper functions
export const getProviderById = (id: string): Provider | undefined => {
  return providers.find(p => p.id === id);
};

export const getStateById = (id: string): State | undefined => {
  return states.find(s => s.id === id);
};

export const getTaskById = (taskId: string): Task | undefined => {
  for (const provider of providers) {
    for (const state of provider.states) {
      const task = state.tasks.find(t => t.id === taskId);
      if (task) return task;
    }
  }
  return undefined;
};

export const getProviderTasks = (providerId: string): Task[] => {
  const provider = getProviderById(providerId);
  if (!provider) return [];
  return provider.states.flatMap(s => s.tasks);
};

export const getAllTasks = (): Task[] => {
  return providers.flatMap(p => p.states.flatMap(s => s.tasks));
};

export const getTasksByStatus = (status: Task['status']): Task[] => {
  return getAllTasks().filter(t => t.status === status);
};

export const getAgreementById = (id: string): CollaborativeAgreement | undefined => {
  return collaborativeAgreements.find(a => a.id === id);
};

export const getMeetingsByAgreement = (agreementId: string): SupervisionMeeting[] => {
  return supervisionMeetings.filter(m => m.agreementId === agreementId);
};

export const getKnowledgeBaseByCategory = (category: KnowledgeBaseArticle['category']): KnowledgeBaseArticle[] => {
  return knowledgeBaseArticles.filter(a => a.category === category);
};

export const getKnowledgeBaseByState = (stateId: string): KnowledgeBaseArticle[] => {
  return knowledgeBaseArticles.filter(a => a.stateId === stateId);
};

export const searchKnowledgeBase = (query: string): KnowledgeBaseArticle[] => {
  const lowerQuery = query.toLowerCase();
  return knowledgeBaseArticles.filter(a => 
    a.title.toLowerCase().includes(lowerQuery) ||
    a.summary.toLowerCase().includes(lowerQuery) ||
    a.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
};

// Current user for Provider Dashboard (mock logged in user)
export const currentUser = providers[0];

// Provider stats helper
export const getProviderStats = (provider: Provider) => {
  const allTasks = provider.states.flatMap(s => s.tasks);
  const licensedStates = provider.states.filter(s => s.isLicensed).length;
  const totalStates = provider.states.length;
  const pendingTasks = allTasks.filter(t => 
    t.status === 'not_started' || t.status === 'in_progress' || t.status === 'submitted'
  ).length;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;
  const complianceTasks = allTasks.filter(t => t.category === 'compliance');
  const overdueComplianceTasks = complianceTasks.filter(t => 
    t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved'
  ).length;
  const complianceComplete = overdueComplianceTasks === 0;
  const pendingReimbursements = allTasks.filter(t => 
    t.reimbursement?.status === 'pending'
  ).length;

  return {
    licensedStates,
    totalStates,
    pendingTasks,
    blockedTasks,
    complianceComplete,
    overdueComplianceTasks,
    pendingReimbursements,
  };
};

// Pending license verifications helper
export const getPendingLicenseVerifications = (): SelfReportedLicense[] => {
  return selfReportedLicenses.filter(l => l.verificationStatus === 'pending');
};
