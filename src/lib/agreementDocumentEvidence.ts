/** Resolve existing uploads only through saved agreement and participant IDs. */
export function agreementDocumentEvidence(
  agreementId: string, providerId: string | null,
  topLevel: string | null,
  participants: { agreement_id: string; provider_id: string | null; is_active: boolean | null; medallion_document_url: string | null }[],
  documents: { agreement_id: string | null; task_id: string | null; file_path: string }[],
  tasks: { id: string; agreement_id: string | null }[],
): string | null {
  if (topLevel?.trim()) return topLevel;
  const participant = participants.find(p => p.agreement_id === agreementId && p.provider_id === providerId && p.is_active && p.medallion_document_url?.trim());
  if (participant?.medallion_document_url) return participant.medallion_document_url;
  const taskIds = new Set(tasks.filter(t => t.agreement_id === agreementId).map(t => t.id));
  return documents.find(d => d.file_path?.trim() && (d.agreement_id === agreementId || (!d.agreement_id && d.task_id && taskIds.has(d.task_id))))?.file_path ?? null;
}