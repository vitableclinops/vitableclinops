import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type Transfer = Tables<'agreement_transfers'>;
type Task = Tables<'agreement_tasks'>;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTimestamp(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
  } catch {
    return dateStr;
  }
}

function formatLocalDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseLocalDate(dateStr), 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}

interface TransferAuditData {
  transfer: Transfer;
  tasks: Task[];
  activityLog: Array<{
    id: string;
    activity_type: string;
    actor_name: string | null;
    actor_role: string | null;
    description: string;
    created_at: string;
  }>;
  auditLog: Tables<'agreement_audit_log'>[];
  providerNames: string[];
  documents: Array<{
    file_name: string;
    uploaded_by_name: string | null;
    created_at: string;
    file_size: number | null;
    task_title?: string;
  }>;
}

async function fetchTransferAuditData(transferId: string): Promise<TransferAuditData | null> {
  const [transferRes, tasksRes, activityRes, auditRes] = await Promise.all([
    supabase.from('agreement_transfers').select('*').eq('id', transferId).single(),
    supabase.from('agreement_tasks').select('*').eq('transfer_id', transferId).order('sort_order'),
    supabase.from('transfer_activity_log').select('id, activity_type, actor_name, actor_role, description, created_at').eq('transfer_id', transferId).order('created_at', { ascending: true }),
    supabase.from('agreement_audit_log').select('*').eq('entity_id', transferId).eq('entity_type', 'transfer').order('created_at', { ascending: true }),
  ]);

  if (!transferRes.data) return null;

  const transfer = transferRes.data;
  const tasks = tasksRes.data || [];

  // Fetch provider names
  const providerIds = transfer.affected_provider_ids || [];
  let providerNames: string[] = [];
  if (providerIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', providerIds);
    providerNames = (profiles || []).map(p => p.full_name || 'Unknown');
    
    // Fallback to agreement_providers
    if (providerNames.length === 0) {
      const { data: apData } = await supabase.from('agreement_providers').select('provider_name').eq('agreement_id', transfer.source_agreement_id);
      providerNames = (apData || []).map(p => p.provider_name);
    }
  }

  // Fetch documents for transfer tasks
  const taskIds = tasks.map(t => t.id);
  let documents: TransferAuditData['documents'] = [];
  if (taskIds.length > 0) {
    const { data: docs } = await supabase.from('task_documents').select('file_name, uploaded_by_name, created_at, file_size, task_id').in('task_id', taskIds).order('created_at');
    const titleMap = new Map(tasks.map(t => [t.id, t.title]));
    documents = (docs || []).map(d => ({
      file_name: d.file_name,
      uploaded_by_name: d.uploaded_by_name,
      created_at: d.created_at,
      file_size: d.file_size,
      task_title: titleMap.get(d.task_id),
    }));
  }

  return {
    transfer,
    tasks,
    activityLog: (activityRes.data || []) as TransferAuditData['activityLog'],
    auditLog: auditRes.data || [],
    providerNames,
    documents,
  };
}

function buildTaskRows(tasks: Task[], phase: string): string {
  if (tasks.length === 0) return '<tr><td colspan="5" style="color: #888; font-style: italic;">No tasks in this phase.</td></tr>';
  return tasks.map(t => `<tr>
    <td>${escapeHtml(t.title)}</td>
    <td>${t.is_required ? 'Yes' : 'No'}</td>
    <td class="${t.status === 'completed' ? 'pass' : t.status === 'archived' ? 'muted' : ''}" style="text-transform: capitalize;">${t.status}</td>
    <td>${formatTimestamp(t.completed_at)}</td>
    <td>${t.assigned_to_name ? escapeHtml(t.assigned_to_name) : '—'}</td>
  </tr>`).join('\n');
}

function buildReportHtml(data: TransferAuditData): string {
  const { transfer, tasks, activityLog, auditLog, providerNames, documents } = data;
  const now = new Date();

  const terminationTasks = tasks.filter(t => t.auto_trigger === 'transfer_termination');
  const initiationTasks = tasks.filter(t => t.auto_trigger === 'transfer_initiation');
  const otherTasks = tasks.filter(t => t.auto_trigger !== 'transfer_termination' && t.auto_trigger !== 'transfer_initiation');

  const isCancelled = transfer.status === 'cancelled';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transfer Completion Audit — ${escapeHtml(transfer.state_name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 40px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; }
  .header .subtitle { font-size: 14px; color: #666; margin-top: 4px; }
  .header .meta { font-size: 12px; color: #999; margin-top: 8px; }
  h2 { font-size: 16px; font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 28px 0 14px; }
  h3 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .summary-item label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; display: block; }
  .summary-item .value { font-size: 14px; font-weight: 500; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: capitalize; }
  .status-completed { background: #dcfce7; color: #166534; }
  .status-cancelled { background: #fee2e2; color: #991b1b; }
  .phase-label { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #f3f4f6; color: #374151; margin-right: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; background: #f9fafb; border-bottom: 2px solid #e5e7eb; padding: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  td { padding: 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .pass { color: #166534; }
  .fail { color: #991b1b; }
  .muted { color: #9ca3af; }
  .provider-list { list-style: none; margin-top: 8px; }
  .provider-list li { padding: 3px 0; font-size: 13px; }
  .provider-list li::before { content: '• '; color: #888; }
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
  <h1>Transfer ${isCancelled ? 'Cancellation' : 'Completion'} Audit Report</h1>
  <div class="subtitle">${escapeHtml(transfer.state_name)} (${transfer.state_abbreviation}) — ${escapeHtml(transfer.source_physician_name || 'Source')} → Dr. ${escapeHtml(transfer.target_physician_name)}</div>
  <div class="meta">Generated ${format(now, "MMMM d, yyyy 'at' h:mm a")} • Transfer ID: ${transfer.id.slice(0, 8)}</div>
</div>

<h2>1. Transfer Summary</h2>
<div class="summary-grid">
  <div class="summary-item"><label>State</label><div class="value">${escapeHtml(transfer.state_name)} (${transfer.state_abbreviation})</div></div>
  <div class="summary-item"><label>Status</label><div class="value"><span class="status-badge ${isCancelled ? 'status-cancelled' : 'status-completed'}">${transfer.status}</span></div></div>
  <div class="summary-item"><label>Source Physician</label><div class="value">${escapeHtml(transfer.source_physician_name || '—')}${transfer.source_physician_email ? ` (${escapeHtml(transfer.source_physician_email)})` : ''}</div></div>
  <div class="summary-item"><label>Target Physician</label><div class="value">Dr. ${escapeHtml(transfer.target_physician_name)}${transfer.target_physician_email ? ` (${escapeHtml(transfer.target_physician_email)})` : ''}</div></div>
  <div class="summary-item"><label>Initiated</label><div class="value">${formatTimestamp(transfer.initiated_at)}</div></div>
  <div class="summary-item"><label>${isCancelled ? 'Cancelled' : 'Completed'}</label><div class="value">${formatTimestamp(transfer.completed_at || transfer.updated_at)}</div></div>
  <div class="summary-item"><label>Termination Effective Date</label><div class="value">${formatLocalDate(transfer.termination_effective_date)}</div></div>
  <div class="summary-item"><label>Initiation Effective Date</label><div class="value">${formatLocalDate(transfer.initiation_effective_date || transfer.effective_date)}</div></div>
  <div class="summary-item"><label>Source Agreement</label><div class="value">${transfer.source_agreement_id.slice(0, 8)}</div></div>
  <div class="summary-item"><label>Target Agreement</label><div class="value">${transfer.target_agreement_id ? transfer.target_agreement_id.slice(0, 8) : '—'}</div></div>
  <div class="summary-item"><label>Meeting Cadence</label><div class="value" style="text-transform: capitalize;">${transfer.meeting_cadence || '—'}</div></div>
  <div class="summary-item"><label>Chart Review</label><div class="value">${transfer.chart_review_frequency || '—'}</div></div>
</div>

<h3>Affected Providers (${providerNames.length})</h3>
${providerNames.length > 0 ? `<ul class="provider-list">${providerNames.map(n => `<li>${escapeHtml(n)}</li>`).join('\n')}</ul>` : '<p style="font-size: 13px; color: #888;">No providers recorded.</p>'}

<h2>2. Phase 1 — Termination</h2>
<p style="font-size: 12px; color: #888; margin-bottom: 4px;">Tasks related to termination of the agreement with ${escapeHtml(transfer.source_physician_name || 'source physician')}</p>
<table>
<thead><tr><th>Task</th><th>Required</th><th>Status</th><th>Completed</th><th>Assigned To</th></tr></thead>
<tbody>
${buildTaskRows(terminationTasks, 'termination')}
</tbody>
</table>

<h2>3. Phase 2 — Initiation</h2>
<p style="font-size: 12px; color: #888; margin-bottom: 4px;">Tasks related to initiation of the new agreement with Dr. ${escapeHtml(transfer.target_physician_name)}</p>
<table>
<thead><tr><th>Task</th><th>Required</th><th>Status</th><th>Completed</th><th>Assigned To</th></tr></thead>
<tbody>
${buildTaskRows(initiationTasks, 'initiation')}
</tbody>
</table>

${otherTasks.length > 0 ? `
<h2>4. Other Tasks</h2>
<table>
<thead><tr><th>Task</th><th>Required</th><th>Status</th><th>Completed</th><th>Assigned To</th></tr></thead>
<tbody>
${buildTaskRows(otherTasks, 'other')}
</tbody>
</table>
` : ''}

${documents.length > 0 ? `
<h2>${otherTasks.length > 0 ? '5' : '4'}. Documents</h2>
<table>
<thead><tr><th>File Name</th><th>Task</th><th>Uploaded By</th><th>Date</th><th>Size</th></tr></thead>
<tbody>
${documents.map(d => `<tr>
  <td>${escapeHtml(d.file_name)}</td>
  <td>${d.task_title ? escapeHtml(d.task_title) : '—'}</td>
  <td>${d.uploaded_by_name ? escapeHtml(d.uploaded_by_name) : '—'}</td>
  <td>${formatTimestamp(d.created_at)}</td>
  <td>${d.file_size ? (d.file_size < 1024 * 1024 ? Math.round(d.file_size / 1024) + ' KB' : (d.file_size / (1024 * 1024)).toFixed(1) + ' MB') : '—'}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : ''}

<h2>${(() => { let n = 4; if (otherTasks.length > 0) n++; if (documents.length > 0) n++; return n; })()}. Activity Timeline</h2>
${activityLog.length > 0 ? `
<table>
<thead><tr><th>Timestamp</th><th>Type</th><th>Actor</th><th>Description</th></tr></thead>
<tbody>
${activityLog.map(a => `<tr>
  <td style="white-space: nowrap;">${formatTimestamp(a.created_at)}</td>
  <td style="text-transform: capitalize;">${escapeHtml(a.activity_type.replace(/_/g, ' '))}</td>
  <td>${a.actor_name ? escapeHtml(a.actor_name) : '—'}${a.actor_role ? ` <span style="color: #888;">(${escapeHtml(a.actor_role)})</span>` : ''}</td>
  <td style="font-size: 12px;">${escapeHtml(a.description)}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : '<p style="font-size: 13px; color: #888;">No activity recorded.</p>'}

${auditLog.length > 0 ? `
<h2>${(() => { let n = 5; if (otherTasks.length > 0) n++; if (documents.length > 0) n++; return n; })()}. System Audit Trail</h2>
<table>
<thead><tr><th>Timestamp</th><th>Action</th><th>Performed By</th></tr></thead>
<tbody>
${auditLog.map(log => `<tr>
  <td style="white-space: nowrap;">${formatTimestamp(log.created_at)}</td>
  <td style="text-transform: capitalize;">${escapeHtml(log.action.replace(/_/g, ' '))}</td>
  <td>${log.performed_by_name ? escapeHtml(log.performed_by_name) : '—'}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : ''}

<div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center;">
  This report was auto-generated. Print or save as PDF for your records.
</div>
</body>
</html>`;
}

export async function generateTransferAuditReport(transferId: string) {
  const data = await fetchTransferAuditData(transferId);
  if (!data) {
    throw new Error('Could not load transfer data');
  }

  const html = buildReportHtml(data);
  const newWindow = window.open('', '_blank');
  if (newWindow) {
    newWindow.document.write(html);
    newWindow.document.close();
  }
}
