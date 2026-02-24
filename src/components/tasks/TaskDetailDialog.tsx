import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskDocumentUpload, useTaskDocumentCount } from './TaskDocumentUpload';
import { cn, parseLocalDate } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  FileText, Calendar, Bell, ClipboardCheck, Clock, Star, Flag,
  AlertCircle, Lock, PenTool, Paperclip, ExternalLink, User, MapPin,
  CheckCircle2, RotateCcw, Loader2, Users,
} from 'lucide-react';

interface TaskForDetail {
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
  completed_at?: string | null;
  created_at?: string;
  agreement_id?: string | null;
  state_name?: string | null;
  state_abbreviation?: string | null;
  provider_name?: string | null;
  provider_id?: string | null;
  physician_id?: string | null;
  source?: string; // 'agreement' | 'milestone'
}

interface TaskDetailDialogProps {
  task: TaskForDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin?: boolean;
  onTaskUpdated?: () => void;
}

interface RelatedPerson {
  id: string;
  full_name: string | null;
  role_label: string;
}

function getCategoryLabel(category: string) {
  const map: Record<string, string> = {
    document: 'Document',
    signature: 'Signature',
    supervision_meeting: 'Supervision Meeting',
    chart_review: 'Chart Review',
    compliance: 'Compliance',
    termination: 'Termination',
    communication: 'Communication',
    custom: 'Custom',
    renewal: 'Renewal',
    agreement_creation: 'Agreement Creation',
    all_hands_attestation: 'All-Hands Attestation',
    onboarding: 'Onboarding',
    transfer: 'Transfer',
    milestone: 'Milestone',
    outreach: 'Outreach',
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
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

function useRelatedPeople(task: TaskForDetail | null, open: boolean) {
  const [people, setPeople] = useState<RelatedPerson[]>([]);

  useEffect(() => {
    if (!task || !open) { setPeople([]); return; }

    const resolve = async () => {
      const peopleMap = new Map<string, RelatedPerson>();

      // 1. Direct provider_id on the task
      if (task.provider_id) {
        peopleMap.set(task.provider_id, { id: task.provider_id, full_name: null, role_label: 'Provider' });
      }

      // 2. Direct physician_id on the task
      if (task.physician_id) {
        peopleMap.set(task.physician_id, { id: task.physician_id, full_name: null, role_label: 'Physician' });
      }

      // 3. From agreement context — get both provider and physician
      if (task.agreement_id) {
        const { data: agr } = await supabase
          .from('collaborative_agreements')
          .select('provider_id, physician_id')
          .eq('id', task.agreement_id)
          .single();
        if (agr?.provider_id && !peopleMap.has(agr.provider_id)) {
          peopleMap.set(agr.provider_id, { id: agr.provider_id, full_name: null, role_label: 'Provider' });
        }
        if (agr?.physician_id && !peopleMap.has(agr.physician_id)) {
          peopleMap.set(agr.physician_id, { id: agr.physician_id, full_name: null, role_label: 'Physician' });
        }
      }

      // 4. From task_linked_providers junction
      const { data: linked } = await supabase
        .from('task_linked_providers')
        .select('provider_id, role_label')
        .eq('task_id', task.id);
      if (linked) {
        for (const lp of linked) {
          if (!peopleMap.has(lp.provider_id)) {
            peopleMap.set(lp.provider_id, { id: lp.provider_id, full_name: null, role_label: lp.role_label });
          }
        }
      }

      if (peopleMap.size === 0) { setPeople([]); return; }

      // Fetch names
      const ids = [...peopleMap.keys()];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);

      if (profiles) {
        for (const p of profiles) {
          const existing = peopleMap.get(p.id);
          if (existing) existing.full_name = p.full_name;
        }
      }

      setPeople([...peopleMap.values()]);
    };

    resolve();
  }, [task?.id, open]);

  return people;
}

export function TaskDetailDialog({ task, open, onOpenChange, isAdmin = false, onTaskUpdated }: TaskDetailDialogProps) {
  const { toast } = useToast();
  const [completing, setCompleting] = useState(false);
  const relatedPeople = useRelatedPeople(task, open);

  if (!task) return null;

  const requiresUpload = task.requires_upload === true;
  const isBlocked = task.status === 'blocked' || task.status === 'waiting_on_signature';
  const isCompleted = task.status === 'completed';
  const isArchived = task.status === 'archived';
  const isMilestone = task.source === 'milestone';
  const canComplete = isAdmin && !isArchived && !isMilestone;

  const handleToggleComplete = async () => {
    setCompleting(true);
    try {
      const newStatus = isCompleted ? 'pending' : 'completed';
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          status: newStatus as any,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
          completed_by: newStatus === 'completed' ? user?.id : null,
          blocked_reason: null,
          blocked_until: null,
        })
        .eq('id', task.id);

      if (error) throw error;

      toast({
        title: newStatus === 'completed' ? 'Task completed' : 'Task reopened',
        description: task.title,
      });

      onTaskUpdated?.();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to update task.', variant: 'destructive' });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">{getCategoryIcon(task.category)}</span>
            {task.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-4">
            {/* Status & meta badges */}
            <div className="flex items-center gap-2 flex-wrap">
              {getStatusBadge(task.status)}
              {task.is_required && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Star className="h-3 w-3 text-warning fill-warning" /> Required
                </Badge>
              )}
              {task.escalated && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <Flag className="h-3 w-3" /> Escalated
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">{getCategoryLabel(task.category)}</Badge>
              {task.priority && task.priority !== 'medium' && (
                <Badge variant="outline" className={cn(
                  "text-xs",
                  task.priority === 'critical' && "border-destructive/30 text-destructive",
                  task.priority === 'high' && "border-warning/30 text-warning",
                )}>
                  {task.priority}
                </Badge>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm">{task.description}</p>
              </div>
            )}

            <Separator />

            {/* Related People */}
            {relatedPeople.length > 0 && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Related People
                  </Label>
                  <div className="space-y-1">
                    {relatedPeople.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
                      >
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium flex-1 truncate">{person.full_name || 'Unknown'}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                          {person.role_label}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {task.assigned_to_name && (
                <div className="space-y-0.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Assigned To</Label>
                  <p>{task.assigned_to_name}</p>
                </div>
              )}
              {task.due_date && (
                <div className="space-y-0.5">
                  <Label className={cn(
                    "text-xs flex items-center gap-1",
                    parseLocalDate(task.due_date) < new Date() && task.status !== 'completed'
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}>
                    <Calendar className="h-3 w-3" /> Due Date
                  </Label>
                  <p className={cn(
                    parseLocalDate(task.due_date) < new Date() && task.status !== 'completed' && "text-destructive font-medium"
                  )}>
                    {format(parseLocalDate(task.due_date), 'MMM d, yyyy')}
                  </p>
                </div>
              )}
              {task.state_name && (
                <div className="space-y-0.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> State</Label>
                  <p>{task.state_name}{task.state_abbreviation ? ` (${task.state_abbreviation})` : ''}</p>
                </div>
              )}
              {task.completed_at && (
                <div className="space-y-0.5">
                  <Label className="text-xs text-muted-foreground">Completed</Label>
                  <p>{formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })}</p>
                </div>
              )}
            </div>

            {/* Blocked info */}
            {isBlocked && task.blocked_reason && (
              <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 border border-warning/30 rounded-md p-3">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-xs">Blocked Reason</p>
                  <p>{task.blocked_reason}</p>
                  {task.blocked_until && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Follow-up: {format(parseLocalDate(task.blocked_until), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* External link */}
            {task.external_url && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">External Link</Label>
                <a
                  href={task.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {task.external_url.length > 60 ? task.external_url.slice(0, 60) + '…' : task.external_url}
                </a>
              </div>
            )}

            {/* Notes */}
            {task.notes && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <div className="text-sm bg-muted/40 rounded-md p-3 whitespace-pre-line">
                  {task.notes}
                </div>
              </div>
            )}

            <Separator />

            {/* Documents section */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> Documents
              </Label>
              <TaskDocumentUpload
                taskId={task.id}
                agreementId={task.agreement_id}
                requiresUpload={requiresUpload}
                disabled={!isAdmin}
              />
            </div>
          </div>
        </ScrollArea>

        {/* Footer with complete action */}
        {canComplete && (
          <DialogFooter className="pt-2 border-t">
            <Button
              variant={isCompleted ? 'outline' : 'default'}
              size="sm"
              onClick={handleToggleComplete}
              disabled={completing}
              className="gap-1.5"
            >
              {completing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isCompleted ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {isCompleted ? 'Reopen Task' : 'Mark Complete'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
