import { isDocumentExemptPhysician } from './directShiftsPhysicians';

export function agreementMissingDocument(agreement: {
  physician_name?: string | null;
  workflow_status?: string | null;
  agreement_document_url?: string | null;
  medallion_document_url?: string | null;
}, participantDocument?: string | null, hasTaskDocuments = false) {
  return ['active', 'fully_executed'].includes(agreement.workflow_status ?? '')
    && !isDocumentExemptPhysician(agreement.physician_name)
    && !agreement.agreement_document_url?.trim()
    && !agreement.medallion_document_url?.trim()
    && !participantDocument?.trim()
    && !hasTaskDocuments;
}