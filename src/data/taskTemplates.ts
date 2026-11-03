import type { TablesInsert } from '@/integrations/supabase/types';
import { stripDrPrefix } from '@/lib/directShiftsPhysicians';

type AgreementTaskInsert = TablesInsert<'agreement_tasks'>;

/**
 * Canonical termination task templates.
 * Used by both standalone agreement termination and transfer termination phase.
 *
 * Parameters like physician name and provider count are interpolated at generation time.
 */
export const getTerminationTaskTemplates = (
  physicianName: string,
  providerCount: number
) => [
  {
    title: 'Send termination agreement via BoxSign',
    description: `Route termination agreement to ${physicianName} for signature. When completed, record the Box Sign request ID, date signed, and confirming admin name.`,
    category: 'signature' as const,
    priority: 'high',
    is_required: true,
    sort_order: 1,
  },
  {
    title: 'Email NP + physician confirming termination initiated',
    description: `Send notification email to ${providerCount} provider(s) and Dr. ${stripDrPrefix(physicianName)} about the pending termination`,
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 2,
  },
  {
    title: 'Upload executed termination agreement',
    description: 'Confirm executed termination document received. Record the Box Sign document reference and date completed.',
    category: 'document' as const,
    priority: 'high',
    is_required: true,
    sort_order: 3,
  },
  {
    title: 'Confirm termination effective date recorded',
    description: 'Verify the effective date of termination is captured in the system',
    category: 'compliance' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 4,
  },
  {
    title: 'Update meeting/cadence records as needed',
    description: 'Cancel or reschedule any pending meetings with the outgoing physician',
    category: 'supervision_meeting' as const,
    priority: 'medium',
    is_required: false,
    sort_order: 5,
  },
  {
    title: 'Update chart review linkage/tracking references',
    description: 'Ensure chart review records are updated to reflect the termination',
    category: 'chart_review' as const,
    priority: 'medium',
    is_required: false,
    sort_order: 6,
  },
];

/**
 * Canonical initiation task templates.
 * Used by both standalone agreement creation and transfer initiation phase.
 */
export const getInitiationTaskTemplates = (
  physicianName: string,
  providerCount: number
) => [
  {
    title: 'Initiate new collaborative agreement record',
    description: `Create new agreement record for ${providerCount} provider(s) with ${physicianName}. The system will auto-populate from existing provider data.`,
    category: 'agreement_creation' as const,
    priority: 'high',
    is_required: true,
    sort_order: 1,
  },
  {
    title: `Assign collaborating physician (${physicianName})`,
    description: 'Confirm physician assignment and update all provider records',
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 2,
  },
  {
    title: 'Send new agreement via BoxSign',
    description: 'Route new collaborative agreement to physician and all affected providers for signature. When completed, record the Box Sign request ID, date sent, and confirming admin name.',
    category: 'signature' as const,
    priority: 'high',
    is_required: true,
    sort_order: 3,
  },
  {
    title: 'Confirm NP + physician notification email sent',
    description: 'Verify all parties received email confirmation of the new agreement',
    category: 'custom' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 4,
  },
  {
    title: 'Upload executed new agreement',
    description: 'Confirm executed agreement document received. Record the Box Sign document reference and date completed.',
    category: 'document' as const,
    priority: 'high',
    is_required: true,
    sort_order: 5,
  },
  {
    title: 'Schedule first collaboration meeting + record cadence',
    description: 'Set up initial collaborative meeting and establish meeting schedule',
    category: 'supervision_meeting' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 6,
  },
  {
    title: 'Link chart review calendar/tracker',
    description: 'Set up chart review schedule and store reference URL/tracker link',
    category: 'chart_review' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 7,
  },
  {
    title: 'Upload executed agreement to Medallion',
    description: 'Upload the executed collaborative agreement to Medallion as a provider-supervision relationship record',
    category: 'document' as const,
    priority: 'high',
    is_required: true,
    sort_order: 8,
  },
  {
    title: 'Add to Kate Baron collab sheet',
    description: "Add the executed collaborative agreement details to Kate Baron's tracking spreadsheet",
    category: 'custom' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 9,
  },
  {
    title: 'Set renewal date',
    description: 'Set the agreement renewal date. Upon completion, the system will auto-calculate the renewal date as 1 year from the agreement start date.',
    category: 'custom' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 10,
  },
];

export const NC_NCBON_TASK_TITLE = 'Send NP instructions for uploading agreement to NCBON portal';

export const NC_NCBON_INSTRUCTIONS = `1. Log in to the North Carolina Board of Nursing portal (https://portal.ncbon.com)

2. Navigate to "Nurse Practitioner Approval to Practice" application section

3. Complete the application with required information:
   - NP's personal and license information
   - Supervising physician's name, license number, and contact information
   - Practice site location(s) and contact details
   - Description of practice setting and patient population

4. Upload a copy of the signed agreement

5. Pay the $100 application fee`;

const NOTIFICATION_TASK_TITLE = 'Confirm NP + physician notification email sent';

/** North Carolina-only steps inserted right after the notification email task. */
const getNorthCarolinaInitiationSteps = () => [
  {
    title: NC_NCBON_TASK_TITLE,
    description: 'Send the NP the NCBON portal instructions below (expand to copy).',
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 0,
  },
  {
    title: 'Remind physician to watch for NCBON approval email',
    description: 'Remind the physician to keep an eye out for an email from NCBON to approve the agreement.',
    category: 'custom' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 0,
  },
  {
    title: 'Monitor NCBON for approved collab agreement status',
    description: 'Check the NCBON portal until the collaborative agreement shows as approved.',
    category: 'compliance' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 0,
  },
  {
    title: 'Activate in EHR',
    description: 'Once NCBON approval is confirmed, activate the NP in the EHR for North Carolina.',
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 0,
  },
];

/** Insert state-specific steps into initiation templates and renumber. */
export const applyStateSpecificSteps = <T extends { title: string; sort_order: number }>(
  templates: T[],
  stateAbbreviation: string,
): T[] => {
  if (stateAbbreviation?.toUpperCase() !== 'NC') return templates;
  const idx = templates.findIndex(t => t.title === NOTIFICATION_TASK_TITLE);
  if (idx === -1) return templates;
  const out = [
    ...templates.slice(0, idx + 1),
    ...(getNorthCarolinaInitiationSteps() as unknown as T[]),
    ...templates.slice(idx + 1),
  ];
  return out.map((t, i) => ({ ...t, sort_order: i + 1 }));
};

/**
 * Hydrate task templates with agreement/transfer context for DB insertion.
 */
export const hydrateTaskTemplates = (
  templates: ReturnType<typeof getTerminationTaskTemplates | typeof getInitiationTaskTemplates>,
  context: {
    agreementId?: string | null;
    transferId?: string | null;
    providerId?: string | null;
    physicianId?: string | null;
    stateAbbreviation: string;
    stateName: string;
    autoTrigger: string;
    assignedRole?: string;
  }
): AgreementTaskInsert[] => {
  return applyStateSpecificSteps(templates as Array<(typeof templates)[number]>, context.stateAbbreviation).map(template => ({
    agreement_id: context.agreementId || null,
    transfer_id: context.transferId || null,
    provider_id: context.providerId || null,
    physician_id: context.physicianId || null,
    title: template.title,
    description: template.description,
    category: template.category,
    status: 'pending' as const,
    priority: template.priority,
    assigned_role: context.assignedRole || 'admin',
    is_auto_generated: true,
    is_required: template.is_required,
    auto_trigger: context.autoTrigger,
    state_abbreviation: context.stateAbbreviation,
    state_name: context.stateName,
    sort_order: template.sort_order,
  }));
};
