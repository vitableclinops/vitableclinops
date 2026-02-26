import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TaskDocumentUpload, useTaskDocumentCount } from './TaskDocumentUpload';
import { ArchiveTaskDialog } from '@/components/admin/ArchiveTaskDialog';
import { LinkedProviderEditor, type LinkedProviderItem } from '@/components/admin/LinkedProviderEditor';
import { cn, parseLocalDate } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';
import {
  FileText, Calendar, Bell, ClipboardCheck, Clock, Star, Flag,
  AlertCircle, Lock, PenTool, Paperclip, ExternalLink, User, MapPin,
  CheckCircle2, RotateCcw, Loader2, Users, Pencil, X, Archive,

  Copy, Search, Cake, Trophy,
} from 'lucide-react';

type TaskCategory = Database['public']['Enums']['agreement_task_category'];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'agreement_creation', label: 'Agreement Creation' },
  { value: 'signature', label: 'Signature' },
  { value: 'supervision_meeting', label: 'Supervision Meeting' },
  { value: 'chart_review', label: 'Chart Review' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'termination', label: 'Termination' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'document', label: 'Document' },
  { value: 'communication', label: 'Communication' },
  { value: 'all_hands_attestation', label: 'All-Hands Attestation' },
  { value: 'custom', label: 'Custom' },
];

/* ─── Shared task shape ─── */
export interface TaskDialogTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  category: string;
  priority?: string | null;
  due_date?: string | null;
  notes?: string | null;
  external_url?: string | null;
  is_required?: boolean | null;
  requires_upload?: boolean;
  escalated?: boolean | null;
  blocked_reason?: string | null;
  blocked_until?: string | null;
  assigned_to_name?: string | null;
  assigned_to?: string | null;
  completed_at?: string | null;
  created_at?: string;
  agreement_id?: string | null;
  state_name?: string | null;
  state_abbreviation?: string | null;
  provider_name?: string | null;
  provider_id?: string | null;
  physician_id?: string | null;
  transfer_id?: string | null;
  archived_reason?: string | null;
  archived_at?: string | null;
  source?: string;
  milestone_type?: string | null;
  slack_template?: string | null;
  document_count?: number;
}

interface TaskDialogProps {
  task: TaskDialogTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin?: boolean;
  onTaskUpdated?: () => void;
}

/* ─── Helpers ─── */
function getCategoryLabel(category: string) {
  const map: Record<string, string> = {
    document: 'Document', signature: 'Signature', supervision_meeting: 'Supervision Meeting',
    chart_review: 'Chart Review', compliance: 'Compliance', termination: 'Termination',
    communication: 'Communication', custom: 'Custom', renewal: 'Renewal',
    agreement_creation: 'Agreement Creation', all_hands_attestation: 'All-Hands Attestation',
    onboarding: 'Onboarding', transfer: 'Transfer', milestone: 'Milestone', outreach: 'Outreach',
  };
  return map[category] || category.replace(/_/g, ' ');
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'document': return <FileText className="h-4 w-4" />;
    case 'supervision_meeting': return <Calendar className="h-4 w-4" />;
    case 'notification': case 'communication': return <Bell className="h-4 w-4" />;
    case 'chart_review': return <ClipboardCheck className="h-4 w-4" />;
    case 'signature': return <PenTool className="h-4 w-4" />;
    default: return <Clock className="h-4 w-4" />;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-primary/10 text-primary border-primary/20">Completed</Badge>;
    case 'in_progress':
      return <Badge className="bg-accent text-accent-foreground">In Progress</Badge>;
    case 'blocked':
      return <Badge className="bg-warning/10 text-warning border-warning/20"><Lock className="h-3 w-3 mr-1" />Blocked</Badge>;
    case 'waiting_on_signature':
      return <Badge className="bg-warning/10 text-warning border-warning/20"><PenTool className="h-3 w-3 mr-1" />Waiting Signature</Badge>;
    case 'archived':
      return <Badge variant="secondary"><Archive className="h-3 w-3 mr-1" />Archived</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

/* ─── Related People Hook ─── */
interface RelatedPerson { id: string; full_name: string | null; role_label: string; }

function useRelatedPeople(task: TaskDialogTask | null, active: boolean, version: number) {
  const [people, setPeople] = useState<RelatedPerson[]>([]);
  useEffect(() => {
    if (!task || !active) { setPeople([]); return; }
    const resolve = async () => {
      const peopleMap = new Map<string, RelatedPerson>();

      // Check for explicitly linked providers first — if any exist, use ONLY those
      const { data: linked } = await supabase.from('task_linked_providers').select('provider_id, role_label').eq('task_id', task.id);
      if (linked && linked.length > 0) {
        for (const lp of linked) peopleMap.set(lp.provider_id, { id: lp.provider_id, full_name: null, role_label: lp.role_label });
      } else {
        // Fall back to auto-discovery from task context
        if (task.provider_id) peopleMap.set(task.provider_id, { id: task.provider_id, full_name: null, role_label: 'Provider' });
        if (task.physician_id) peopleMap.set(task.physician_id, { id: task.physician_id, full_name: null, role_label: 'Physician' });
        if (task.agreement_id) {
          const { data: agr } = await supabase.from('collaborative_agreements').select('provider_id, physician_id').eq('id', task.agreement_id).single();
          if (agr?.provider_id && !peopleMap.has(agr.provider_id)) peopleMap.set(agr.provider_id, { id: agr.provider_id, full_name: null, role_label: 'Provider' });
          if (agr?.physician_id && !peopleMap.has(agr.physician_id)) peopleMap.set(agr.physician_id, { id: agr.physician_id, full_name: null, role_label: 'Physician' });
        }
      }

      if (peopleMap.size === 0) { setPeople([]); return; }
      const ids = [...peopleMap.keys()];
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      if (profiles) for (const p of profiles) { const e = peopleMap.get(p.id); if (e) e.full_name = p.full_name; }
      setPeople([...peopleMap.values()]);
    };
    resolve();
  }, [task?.id, active, version]);
  return people;
}

/* ─── Linked providers loader for edit mode ─── */
function useLinkedProviders(task: TaskDialogTask | null, editing: boolean) {
  const [linkedProviders, setLinkedProviders] = useState<LinkedProviderItem[]>([]);
  const [initialLinkedIds, setInitialLinkedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!task || !editing) { setLinkedProviders([]); setInitialLinkedIds(new Set()); return; }

    supabase.from('task_linked_providers').select('id, provider_id, role_label').eq('task_id', task.id)
      .then(async ({ data: links }) => {
        if (links && links.length > 0) {
          const providerIds = links.map(l => l.provider_id);
          const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', providerIds);
          const profileMap = new Map((profiles || []).map(p => [p.id, p]));
          const items: LinkedProviderItem[] = links.map(l => ({
            id: l.id, provider_id: l.provider_id, role_label: l.role_label,
            full_name: profileMap.get(l.provider_id)?.full_name || null,
            email: profileMap.get(l.provider_id)?.email || null,
          }));
          setLinkedProviders(items);
          setInitialLinkedIds(new Set(providerIds));
          return;
        }

        // Auto-resolve from context
        const contextIds = new Map<string, string>();
        if (task.provider_id) contextIds.set(task.provider_id, 'NP');
        if (task.physician_id) contextIds.set(task.physician_id, 'Physician');
        if (task.agreement_id) {
          const { data: agr } = await supabase.from('collaborative_agreements').select('provider_id, physician_id').eq('id', task.agreement_id).single();
          if (agr?.provider_id && !contextIds.has(agr.provider_id)) contextIds.set(agr.provider_id, 'NP');
          if (agr?.physician_id && !contextIds.has(agr.physician_id)) contextIds.set(agr.physician_id, 'Physician');
        }
        if (contextIds.size === 0) { setLinkedProviders([]); setInitialLinkedIds(new Set()); return; }
        const ids = [...contextIds.keys()];
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
        const items: LinkedProviderItem[] = ids.map((id, i) => {
          const prof = (profiles || []).find(p => p.id === id);
          return { id: `context-${i}`, provider_id: id, role_label: contextIds.get(id) || 'NP', full_name: prof?.full_name || null, email: prof?.email || null };
        });
        setLinkedProviders(items);
        setInitialLinkedIds(new Set());
      });
  }, [task?.id, editing]);

  return { linkedProviders, setLinkedProviders, initialLinkedIds };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Main Component
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export function TaskDialog({ task, open, onOpenChange, isAdmin = false, onTaskUpdated }: TaskDialogProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [relatedPeopleVersion, setRelatedPeopleVersion] = useState(0);
  const relatedPeople = useRelatedPeople(task, open && !editing, relatedPeopleVersion);

  // Edit mode state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [editStatus, setEditStatus] = useState('pending');
  const [category, setCategory] = useState<string>('custom');
  const [dueDate, setDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [requiresUpload, setRequiresUpload] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadGateError, setUploadGateError] = useState(false);

  const [docCount, setDocCount] = useState<number | null>(null);
  const initialDocCount = useTaskDocumentCount(task?.id || '');
  useEffect(() => { if (initialDocCount !== null) setDocCount(initialDocCount); }, [initialDocCount]);
  const { linkedProviders, setLinkedProviders, initialLinkedIds } = useLinkedProviders(task, editing);

  // Reset editing on close or task change
  useEffect(() => { if (!open) setEditing(false); }, [open]);

  // Populate edit fields when entering edit mode
  useEffect(() => {
    if (editing && task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setEditStatus(task.status || 'pending');
      setCategory(task.category || 'custom');
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '');
      setEditNotes('');
      setRequiresUpload(task.requires_upload === true);
      setUploadGateError(false);
    }
  }, [editing, task?.id]);

  if (!task) return null;

  const isMilestone = task.category === 'milestone' || task.source === 'milestone';
  const isArchived = task.status === 'archived';
  const isCompleted = task.status === 'completed';
  const isBlocked = task.status === 'blocked' || task.status === 'waiting_on_signature';
  const canComplete = isAdmin && !isArchived && !isMilestone;

  const handleClose = () => {
    setEditing(false);
    onOpenChange(false);
  };

  /* ─── View mode: toggle complete ─── */
  const handleToggleComplete = async () => {
    // Block completion if requires_upload and no documents attached
    if (!isCompleted && task.requires_upload && (docCount === null || docCount === 0)) {
      toast({ title: 'Upload required', description: 'This task requires a document upload before it can be completed.', variant: 'destructive' });
      return;
    }
    setCompleting(true);
    try {
      const newStatus = isCompleted ? 'pending' : 'completed';
      const { data: { user } } = await supabase.auth.getUser();
      let profileId: string | null = null;
      if (newStatus === 'completed' && user) {
        const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', user.id).maybeSingle();
        profileId = prof?.id ?? null;
      }
      const { error } = await supabase.from('agreement_tasks').update({
        status: newStatus as any,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        completed_by: profileId,
        blocked_reason: null, blocked_until: null,
      }).eq('id', task.id);
      if (error) throw error;

      // Auto-link document to agreement when completing document upload tasks
      if (newStatus === 'completed' && task.agreement_id) {
        const titleLower = task.title?.toLowerCase() || '';
        const isExecutedAgreementTask = titleLower.includes('upload executed new agreement') || titleLower.includes('upload executed collaborative agreement');
        const isTerminationDocTask = titleLower.includes('upload executed termination');

        if (isExecutedAgreementTask || isTerminationDocTask) {
          const { data: docs } = await supabase
            .from('task_documents')
            .select('file_path')
            .eq('task_id', task.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (docs && docs.length > 0) {
            const docPath = docs[0].file_path;
            const { data: urlData } = await supabase.storage
              .from('task-documents')
              .createSignedUrl(docPath, 60 * 60 * 24 * 365 * 10); // 10-year URL

            const docUrl = urlData?.signedUrl || docPath;
            const updateField = isTerminationDocTask
              ? { termination_document_url: docUrl }
              : { agreement_document_url: docUrl };

            await supabase
              .from('collaborative_agreements')
              .update(updateField)
              .eq('id', task.agreement_id);
          }
        }
      }

      toast({ title: newStatus === 'completed' ? '✅ Task completed' : 'Task reopened', description: task.title });
      onTaskUpdated?.();
      handleClose();
    } catch (err: any) {
      console.error('Task completion error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to update task.', variant: 'destructive' });
    } finally { setCompleting(false); }
  };

  /* ─── Edit mode: save ─── */
  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    setUploadGateError(false);
    try {
      if (editStatus === 'completed' && requiresUpload && (docCount === null || docCount === 0)) {
        setUploadGateError(true);
        setSaving(false);
        return;
      }

      if (isMilestone) {
        await supabase.from('milestone_tasks').update({
          title, description: description || null,
          due_date: dueDate || task.due_date || new Date().toISOString().split('T')[0],
          status: editStatus,
        }).eq('id', task.id);
      } else {
        const updatePayload: Record<string, any> = {
          title, description: description || null, priority,
          status: editStatus as any, category: category as any,
          due_date: dueDate || null, requires_upload: requiresUpload,
        };
        if (editNotes.trim()) updatePayload.notes = editNotes.trim();
        if (editStatus === 'completed') {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', user.id).maybeSingle();
            updatePayload.completed_by = prof?.id ?? null;
          }
          updatePayload.completed_at = new Date().toISOString();
        }
        const { error } = await supabase.from('agreement_tasks').update(updatePayload).eq('id', task.id);
        if (error) throw error;

        // Sync linked providers
        const currentIds = new Set(linkedProviders.map(lp => lp.provider_id));
        const toRemove = [...initialLinkedIds].filter(id => !currentIds.has(id));
        if (toRemove.length > 0) await supabase.from('task_linked_providers').delete().eq('task_id', task.id).in('provider_id', toRemove);
        const toAdd = linkedProviders.filter(lp => !initialLinkedIds.has(lp.provider_id));
        if (toAdd.length > 0) await supabase.from('task_linked_providers').insert(toAdd.map(lp => ({ task_id: task.id, provider_id: lp.provider_id, role_label: lp.role_label })));
        const toUpdate = linkedProviders.filter(lp => initialLinkedIds.has(lp.provider_id) && !lp.id.startsWith('new-'));
        for (const lp of toUpdate) await supabase.from('task_linked_providers').update({ role_label: lp.role_label }).eq('task_id', task.id).eq('provider_id', lp.provider_id);
      }

      toast({ title: 'Task updated', description: 'Changes saved successfully.' });
      setRelatedPeopleVersion(v => v + 1);
      onTaskUpdated?.();
      handleClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  /* ━━━ EDIT MODE ━━━ */
  if (editing) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit Task
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 flex-wrap">
              {task.state_abbreviation && (
                <Badge variant="outline" className="gap-1 text-xs"><MapPin className="h-3 w-3" />{task.state_abbreviation}</Badge>
              )}
              {task.assigned_to_name && (
                <Badge variant="secondary" className="text-xs">Assigned: {task.assigned_to_name}</Badge>
              )}
              {isArchived && (
                <Badge variant="destructive" className="gap-1 text-xs"><Archive className="h-3 w-3" />Archived</Badge>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!isMilestone && (
              <>
                <LinkedProviderEditor value={linkedProviders} onChange={setLinkedProviders} disabled={isArchived} />
                <Separator />
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={isArchived} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description">Description</Label>
              <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Task details…" disabled={isArchived} />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus} disabled={isArchived}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="waiting_on_signature">Waiting on Signature</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isMilestone && (
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority} disabled={isArchived}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!isMilestone && (
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory} disabled={isArchived}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="task-due-date">Due Date</Label>
              <Input id="task-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isArchived} />
            </div>

            {isMilestone && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    {task.milestone_type === 'birthday' ? <Cake className="h-3.5 w-3.5 text-pink-500" /> : <Trophy className="h-3.5 w-3.5 text-amber-500" />}
                    Celebration Helper
                  </Label>
                  {task.slack_template && (
                    <div className="bg-muted/40 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-line">{task.slack_template}</div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { navigator.clipboard.writeText(task.slack_template || task.title); toast({ title: 'Copied to clipboard' }); }}>
                          <Copy className="h-3 w-3" />Copy Message
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy celebration message</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { const term = task.milestone_type === 'birthday' ? 'happy birthday celebration' : 'work anniversary congratulations'; window.open(`https://giphy.com/search/${encodeURIComponent(term)}`, '_blank'); }}>
                          <Search className="h-3 w-3" />Find GIF
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Search for a celebration GIF</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </>
            )}

            {!isMilestone && !isArchived && (
              <>
                <div className="flex items-center gap-2">
                  <Switch id="requires-upload" checked={requiresUpload} onCheckedChange={setRequiresUpload} />
                  <Label htmlFor="requires-upload" className="text-sm">Requires document upload to complete</Label>
                </div>
                {task && (
                  <div className="space-y-2">
                    <Label>Documents</Label>
                    <TaskDocumentUpload taskId={task.id} agreementId={task.agreement_id} requiresUpload={requiresUpload} onDocumentCountChange={setDocCount} />
                  </div>
                )}
                {uploadGateError && (
                  <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>This task requires a document upload before it can be marked as completed.</span>
                  </div>
                )}
              </>
            )}

            {!isMilestone && !isArchived && (
              <div className="space-y-2">
                <Label htmlFor="task-notes">Add Note</Label>
                <Textarea id="task-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} placeholder="Optional note to append…" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              {isArchived ? 'Back' : 'Cancel'}
            </Button>
            {!isArchived && (
              <Button onClick={handleSave} disabled={saving || !title.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /* ━━━ VIEW MODE ━━━ */
  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[75vh] overflow-hidden flex flex-col p-4 gap-2">
        <DialogHeader className="pb-0">
          <div className="flex items-start gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold flex-1 leading-tight">
              {getCategoryIcon(task.category)}
              {task.title}
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {getStatusBadge(task.status)}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{getCategoryLabel(task.category)}</Badge>
              {task.priority && task.priority !== 'medium' && (
                <Badge variant={task.priority === 'critical' || task.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px] px-1.5 py-0 gap-0.5">
                  <Flag className="h-2.5 w-2.5" />{task.priority}
                </Badge>
              )}
              {task.state_abbreviation && <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5"><MapPin className="h-2.5 w-2.5" />{task.state_abbreviation}</Badge>}
              {task.is_required && <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5"><Star className="h-2.5 w-2.5 fill-current" />Required</Badge>}
              {task.requires_upload && (docCount === null || docCount === 0) && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-0.5"><AlertCircle className="h-2.5 w-2.5" />Needs doc</Badge>
              )}
              {isAdmin && !isMilestone && (
                <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px] gap-1 ml-auto" onClick={() => setEditing(true)}>
                  <Pencil className="h-2.5 w-2.5" />
                  Edit
                </Button>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-4 px-4">
          <div className="space-y-3 py-2">
            {/* Description */}
            {task.description && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Description</Label>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {task.assigned_to_name && (
                <div className="flex items-center gap-1.5">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Assigned:</span>
                  <span className="font-medium">{task.assigned_to_name}</span>
                </div>
              )}
              {task.due_date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Due:</span>
                  <span className="font-medium">{format(parseLocalDate(task.due_date), 'MMM d, yyyy')}</span>
                </div>
              )}
              {task.completed_at && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  <span className="text-muted-foreground">Completed:</span>
                  <span className="font-medium">{formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })}</span>
                </div>
              )}
              {task.created_at && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Created:</span>
                  <span className="font-medium">{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</span>
                </div>
              )}
            </div>

            {/* Related people */}
            {relatedPeople.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Related People</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {relatedPeople.map((p) => (
                      <Badge key={p.id} variant="secondary" className="text-[10px] gap-1">
                        <User className="h-2.5 w-2.5" />{p.full_name || 'Unknown'} · {p.role_label}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            {task.notes && (
              <>
                <Separator />
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Notes</Label>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{task.notes}</p>
                </div>
              </>
            )}

            {/* External URL */}
            {task.external_url && (
              <div>
                <a href={task.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> Open Link
                </a>
              </div>
            )}

            {/* Blocked info */}
            {isBlocked && (task.blocked_reason || task.blocked_until) && (
              <>
                <Separator />
                <div className="bg-warning/10 text-warning rounded-md p-2 text-xs space-y-1">
                  <div className="flex items-center gap-1 font-medium"><Lock className="h-3 w-3" /> Blocked</div>
                  {task.blocked_reason && <p>{task.blocked_reason}</p>}
                  {task.blocked_until && <p>Until: {format(parseLocalDate(task.blocked_until), 'MMM d, yyyy')}</p>}
                </div>
              </>
            )}

            {/* Archived info */}
            {isArchived && (
              <>
                <Separator />
                <div className="bg-muted rounded-md p-2 text-xs space-y-1">
                  <div className="flex items-center gap-1 font-medium"><Archive className="h-3 w-3" /> Archived</div>
                  {task.archived_reason && <p className="text-muted-foreground">{task.archived_reason}</p>}
                  {task.archived_at && <p className="text-muted-foreground">Archived {formatDistanceToNow(new Date(task.archived_at), { addSuffix: true })}</p>}
                </div>
              </>
            )}

            <Separator />

            {/* Documents */}
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1"><Paperclip className="h-3 w-3" /> Documents</Label>
              <TaskDocumentUpload taskId={task.id} agreementId={task.agreement_id} requiresUpload={task.requires_upload === true} disabled={!isAdmin} onDocumentCountChange={setDocCount} />
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        {isAdmin && !isMilestone && (
          <DialogFooter className="pt-1.5 border-t flex gap-2">
            {!isArchived && !isCompleted && (
              <Button variant="outline" size="sm" onClick={() => setShowArchiveDialog(true)} className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive">
                <Archive className="h-3.5 w-3.5" />
                Archive
              </Button>
            )}
            {canComplete && (
              <Button variant={isCompleted ? 'outline' : 'default'} size="sm" onClick={handleToggleComplete} disabled={completing} className="gap-1.5 h-8 text-xs">
                {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isCompleted ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {isCompleted ? 'Reopen Task' : 'Mark Complete'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    {task && (
      <ArchiveTaskDialog
        taskId={showArchiveDialog ? task.id : null}
        taskTitle={task.title}
        onClose={() => setShowArchiveDialog(false)}
        onSuccess={() => { setShowArchiveDialog(false); onTaskUpdated?.(); }}
      />
    )}
    </>
  );
}
