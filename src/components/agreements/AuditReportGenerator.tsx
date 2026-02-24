import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;

interface AuditReportData {
  agreement: DbAgreement;
  tasks: Tables<'agreement_tasks'>[];
  providers: Tables<'agreement_providers'>[];
  auditLogs: Tables<'agreement_audit_log'>[];
  documents: Array<{
    id: string;
    task_id: string;
    file_name: string;
    file_size: number | null;
    uploaded_by_name: string | null;
    created_at: string;
    task_title?: string;
  }>;
}

async function fetchReportData(agreementId: string): Promise<AuditReportData | null> {
  const [agreementRes, tasksRes, providersRes, logsRes, docsRes] = await Promise.all([
    supabase.from('collaborative_agreements').select('*').eq('id', agreementId).single(),
    supabase.from('agreement_tasks').select('*').eq('agreement_id', agreementId).order('sort_order'),
    supabase.from('agreement_providers').select('*').eq('agreement_id', agreementId),
    supabase.from('agreement_audit_log').select('*').eq('entity_id', agreementId).order('created_at', { ascending: true }),
    supabase.from('task_documents').select('id, task_id, file_name, file_size, uploaded_by_name, created_at').eq('agreement_id', agreementId).order('created_at', { ascending: true }),
  ]);

  if (!agreementRes.data) return null;

  // Enrich docs with task titles
  const docs = (docsRes.data || []) as AuditReportData['documents'];
  const tasks = tasksRes.data || [];
  const titleMap = new Map(tasks.map(t => [t.id, t.title]));
  docs.forEach(d => { d.task_title = titleMap.get(d.task_id); });

  return {
    agreement: agreementRes.data,
    tasks,
    providers: providersRes.data || [],
    auditLogs: logsRes.data || [],
    documents: docs,
  };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReportHtml(data: AuditReportData): string {
  const { agreement, tasks, providers, auditLogs, documents } = data;
  const now = new Date();
  const activeProviders = providers.filter(p => p.is_active);

  // Group tasks by category
  const tasksByCategory = tasks.reduce((acc, task) => {
    const cat = task.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(task);
    return acc;
  }, {} as Record<string, typeof tasks>);

  // Extract verification check results from audit logs
  const verificationLog = auditLogs.find(l => l.action === 'verification_completed');
  const verificationChecks = verificationLog?.changes && typeof verificationLog.changes === 'object' && 'checks' in (verificationLog.changes as any)
    ? (verificationLog.changes as any).checks as Array<{ label: string; passed: boolean; detail: string }>
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Collaborative Agreement Compliance Report — ${escapeHtml(agreement.state_name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 40px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; }
  .header .subtitle { font-size: 14px; color: #666; margin-top: 4px; }
  .header .meta { font-size: 12px; color: #999; margin-top: 8px; }
  h2 { font-size: 16px; font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 28px 0 14px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .summary-item label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; display: block; }
  .summary-item .value { font-size: 14px; font-weight: 500; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: capitalize; }
  .status-active { background: #dcfce7; color: #166534; }
  .status-terminated { background: #fee2e2; color: #991b1b; }
  .status-default { background: #f3f4f6; color: #374151; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; background: #f9fafb; border-bottom: 2px solid #e5e7eb; padding: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  td { padding: 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .pass { color: #166534; }
  .fail { color: #991b1b; }
  .check-icon::before { content: '✓ '; font-weight: bold; }
  .x-icon::before { content: '✗ '; font-weight: bold; }
  .provider-list { list-style: none; }
  .provider-list li { padding: 4px 0; font-size: 13px; }
  .section-note { font-size: 12px; color: #888; font-style: italic; margin-bottom: 8px; }
  @media print {
    body { padding: 20px; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>Collaborative Agreement Compliance Report</h1>
  <div class="subtitle">${escapeHtml(agreement.state_name)} — ${escapeHtml(agreement.provider_name || 'Provider')} ↔ Dr. ${escapeHtml(agreement.physician_name || 'Physician')}</div>
  <div class="meta">Generated ${format(now, 'MMMM d, yyyy \'at\' h:mm a')} • Agreement ID: ${agreement.id.slice(0, 8)}</div>
</div>

<h2>1. Agreement Summary</h2>
<div class="summary-grid">
  <div class="summary-item"><label>State</label><div class="value">${escapeHtml(agreement.state_name)} (${agreement.state_abbreviation})</div></div>
  <div class="summary-item"><label>Status</label><div class="value"><span class="status-badge ${agreement.workflow_status === 'active' ? 'status-active' : agreement.workflow_status === 'terminated' ? 'status-terminated' : 'status-default'}">${agreement.workflow_status.replace(/_/g, ' ')}</span></div></div>
  <div class="summary-item"><label>Provider</label><div class="value">${escapeHtml(agreement.provider_name || '—')}</div></div>
  <div class="summary-item"><label>Physician</label><div class="value">Dr. ${escapeHtml(agreement.physician_name || '—')}</div></div>
  <div class="summary-item"><label>Start Date</label><div class="value">${formatDateShort(agreement.start_date)}</div></div>
  <div class="summary-item"><label>Renewal Date</label><div class="value">${formatDateShort(agreement.next_renewal_date)}</div></div>
  <div class="summary-item"><label>Meeting Cadence</label><div class="value" style="text-transform: capitalize;">${agreement.meeting_cadence || '—'}</div></div>
  <div class="summary-item"><label>Chart Review</label><div class="value">${agreement.chart_review_required ? (agreement.chart_review_frequency || 'Required') : 'Not required'}</div></div>
</div>

${agreement.agreement_document_url ? `<p style="margin-top: 12px; font-size: 13px;"><strong>Agreement Document:</strong> <a href="${escapeHtml(agreement.agreement_document_url)}" target="_blank" rel="noopener">${escapeHtml(agreement.agreement_document_url)}</a></p>` : ''}

${activeProviders.length > 0 ? `
<h3 style="font-size: 13px; font-weight: 600; margin-top: 16px;">Linked Providers</h3>
<ul class="provider-list">
${activeProviders.map(p => `  <li><strong>${escapeHtml(p.provider_name)}</strong> — ${escapeHtml(p.provider_email)} ${p.signature_status === 'signed' ? '<span class="pass">(Signed)</span>' : `<span class="fail">(${p.signature_status || 'Pending'})</span>`}</li>`).join('\n')}
</ul>
` : ''}

${verificationChecks ? `
<h2>2. Verification Checks</h2>
<p class="section-note">Automated checks performed ${verificationLog ? formatDate(verificationLog.created_at) : ''}${verificationLog?.performed_by_name ? ` by ${escapeHtml(verificationLog.performed_by_name)}` : ''}</p>
<table>
<thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
<tbody>
${verificationChecks.map(c => `<tr>
  <td>${escapeHtml(c.label)}</td>
  <td class="${c.passed ? 'pass' : 'fail'}"><span class="${c.passed ? 'check-icon' : 'x-icon'}">${c.passed ? 'Pass' : 'Fail'}</span></td>
  <td>${escapeHtml(c.detail)}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : ''}

<h2>${verificationChecks ? '3' : '2'}. Complete Task Log</h2>
${Object.keys(tasksByCategory).length > 0 ? Object.entries(tasksByCategory).map(([category, catTasks]) => `
<h3 style="font-size: 13px; font-weight: 600; margin: 12px 0 4px; text-transform: capitalize;">${category.replace(/_/g, ' ')}</h3>
<table>
<thead><tr><th>Task</th><th>Required</th><th>Status</th><th>Completed</th><th>Completed By</th></tr></thead>
<tbody>
${catTasks.map(t => `<tr>
  <td>${escapeHtml(t.title)}</td>
  <td>${t.is_required ? 'Yes' : 'No'}</td>
  <td class="${t.status === 'completed' ? 'pass' : ''}" style="text-transform: capitalize;">${t.status}</td>
  <td>${formatDate(t.completed_at)}</td>
  <td>${t.assigned_to_name ? escapeHtml(t.assigned_to_name) : '—'}</td>
</tr>`).join('\n')}
</tbody>
</table>
`).join('\n') : '<p style="font-size: 13px; color: #888;">No tasks recorded.</p>'}

${documents.length > 0 ? `
<h2>${verificationChecks ? '4' : '3'}. Task Documents</h2>
<table>
<thead><tr><th>File Name</th><th>Task</th><th>Uploaded By</th><th>Date</th><th>Size</th></tr></thead>
<tbody>
${documents.map(d => `<tr>
  <td>${escapeHtml(d.file_name)}</td>
  <td>${d.task_title ? escapeHtml(d.task_title) : '—'}</td>
  <td>${d.uploaded_by_name ? escapeHtml(d.uploaded_by_name) : '—'}</td>
  <td>${formatDate(d.created_at)}</td>
  <td>${d.file_size ? (d.file_size < 1024 * 1024 ? Math.round(d.file_size / 1024) + ' KB' : (d.file_size / (1024 * 1024)).toFixed(1) + ' MB') : '—'}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : ''}

<h2>${verificationChecks ? (documents.length > 0 ? '5' : '4') : (documents.length > 0 ? '4' : '3')}. Full Audit Trail</h2>
${auditLogs.length > 0 ? `
<table>
<thead><tr><th>Timestamp</th><th>Action</th><th>Performed By</th><th>Details</th></tr></thead>
<tbody>
${auditLogs.map(log => `<tr>
  <td style="white-space: nowrap;">${formatDate(log.created_at)}</td>
  <td style="text-transform: capitalize;">${escapeHtml(log.action.replace(/_/g, ' '))}</td>
  <td>${log.performed_by_name ? escapeHtml(log.performed_by_name) : '—'}</td>
  <td style="font-size: 12px; color: #666;">${log.changes ? escapeHtml(JSON.stringify(log.changes)).slice(0, 120) : '—'}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : '<p style="font-size: 13px; color: #888;">No audit entries recorded.</p>'}

<div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center;">
  This report was auto-generated. Print or save as PDF for your records.
</div>
</body>
</html>`;
}

export async function generateAuditReport(agreementId: string) {
  const data = await fetchReportData(agreementId);
  if (!data) {
    throw new Error('Could not load agreement data');
  }

  const html = buildReportHtml(data);
  const newWindow = window.open('', '_blank');
  if (newWindow) {
    newWindow.document.write(html);
    newWindow.document.close();
  }
}
