import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TaskAssignmentSelect } from './TaskAssignmentSelect';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { 
  FileText, 
  Calendar, 
  Bell, 
  ClipboardCheck, 
  Clock,
  MoreVertical,
  Pencil,
  Trash2,
  Link as LinkIcon,
  AlertCircle,
  GripVertical,
  Star,
  Flag,
  AlertTriangle,
  ExternalLink,
  Lock,
  Unlock,
  UserPlus
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Task = Tables<'agreement_tasks'>;

type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'waiting_on_signature' | 'completed';

interface EditableTaskItemProps {
  task: Task;
  transferId: string;
  isAdmin: boolean;
  onUpdate: () => void;
  onDelete?: (taskId: string) => void;
}

export function EditableTaskItem({ 
  task, 
  transferId, 
  isAdmin, 
  onUpdate,
  onDelete 
}: EditableTaskItemProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [showBlocker, setShowBlocker] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');
  const [externalUrl, setExternalUrl] = useState(task.external_url || '');
  const [notes, setNotes] = useState(task.notes || '');
  const [isRequired, setIsRequired] = useState(task.is_required ?? true);
  const [blockedReason, setBlockedReason] = useState(task.blocked_reason || '');
  const [blockedUntil, setBlockedUntil] = useState(task.blocked_until || '');
  const [saving, setSaving] = useState(false);

  const taskStatus = task.status as TaskStatus;

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'document':
        return <FileText className="h-4 w-4" />;
      case 'supervision_meeting':
        return <Calendar className="h-4 w-4" />;
      case 'notification':
        return <Bell className="h-4 w-4" />;
      case 'chart_review':
        return <ClipboardCheck className="h-4 w-4" />;
      case 'termination':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const handleToggleComplete = async () => {
    const newStatus = taskStatus === 'completed' ? 'pending' : 'completed';
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('agreement_tasks')
      .update({
        status: newStatus,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        completed_by: newStatus === 'completed' ? user?.id : null,
        blocked_reason: null,
        blocked_until: null,
      })
      .eq('id', task.id);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to update task.',
        variant: 'destructive',
      });
      return;
    }

    // Log the activity
    await supabase.from('transfer_activity_log').insert({
      transfer_id: transferId,
      task_id: task.id,
      activity_type: newStatus === 'completed' ? 'task_completed' : 'status_changed',
      actor_id: user?.id,
      actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
      actor_role: 'admin',
      description: newStatus === 'completed' 
        ? `Completed: ${task.title}`
        : `Reopened: ${task.title}`,
    });

    onUpdate();
  };

  const handleSetBlocked = async (status: 'blocked' | 'waiting_on_signature' | 'pending') => {
    if ((status === 'blocked' || status === 'waiting_on_signature') && !blockedReason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason for blocking this task.',
        variant: 'destructive',
      });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('agreement_tasks')
      .update({
        status,
        blocked_reason: status === 'pending' ? null : blockedReason,
        blocked_until: status === 'pending' ? null : blockedUntil || null,
      })
      .eq('id', task.id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update task.', variant: 'destructive' });
      return;
    }

    await supabase.from('transfer_activity_log').insert({
      transfer_id: transferId,
      task_id: task.id,
      activity_type: status === 'pending' ? 'task_unblocked' : 'task_blocked',
      actor_id: user?.id,
      actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
      actor_role: 'admin',
      description: status === 'pending' 
        ? `Unblocked: ${task.title}` 
        : `Blocked (${status}): ${task.title} - ${blockedReason}`,
      metadata: { blocked_until: blockedUntil },
    });

    toast({ title: status === 'pending' ? 'Task unblocked' : 'Task marked as blocked' });
    setShowBlocker(false);
    setBlockedReason('');
    setBlockedUntil('');
    onUpdate();
  };

  const handleToggleEscalate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const newEscalated = !task.escalated;

    const { error } = await supabase
      .from('agreement_tasks')
      .update({
        escalated: newEscalated,
        escalated_at: newEscalated ? new Date().toISOString() : null,
        escalated_by: newEscalated ? user?.id : null,
      })
      .eq('id', task.id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update escalation.', variant: 'destructive' });
      return;
    }

    await supabase.from('transfer_activity_log').insert({
      transfer_id: transferId,
      task_id: task.id,
      activity_type: newEscalated ? 'escalation_added' : 'escalation_removed',
      actor_id: user?.id,
      actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
      actor_role: 'admin',
      description: newEscalated ? `Escalated: ${task.title}` : `Removed escalation: ${task.title}`,
    });

    toast({ title: newEscalated ? 'Task escalated' : 'Escalation removed' });
    onUpdate();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          title,
          description: description || null,
          due_date: dueDate || null,
          external_url: externalUrl || null,
          notes: notes || null,
          is_required: isRequired,
        })
        .eq('id', task.id);

      if (error) throw error;

      // Log the edit
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        task_id: task.id,
        activity_type: 'task_edited',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: `Edited task: ${title}`,
        metadata: {
          changes: {
            title: title !== task.title,
            description: description !== task.description,
            due_date: dueDate !== task.due_date,
            is_required: isRequired !== task.is_required,
          }
        }
      });

      toast({ title: 'Task updated' });
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error saving task:', error);
      toast({
        title: 'Error',
        description: 'Failed to save task.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Log deletion before deleting
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        task_id: task.id,
        activity_type: 'task_deleted',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: `Deleted task: ${task.title}`,
      });

      const { error } = await supabase
        .from('agreement_tasks')
        .delete()
        .eq('id', task.id);

      if (error) throw error;

      toast({ title: 'Task deleted' });
      onDelete(task.id);
    } catch (error) {
      console.error('Error deleting task:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete task.',
        variant: 'destructive',
      });
    }
  };

  // Editing mode
  if (editing) {
    return (
      <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="h-20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>External URL</Label>
            <Input
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="Link to document, etc."
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes"
            className="h-16"
          />
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={isRequired}
              onCheckedChange={setIsRequired}
              id="required"
            />
            <Label htmlFor="required" className="text-sm">
              Required for completion
            </Label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Blocker input form
  if (showBlocker) {
    return (
      <div className="p-3 border rounded-lg bg-warning/5 border-warning/30 space-y-3">
        <div className="flex items-center gap-2 text-warning">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">Mark as Blocked</span>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Reason (required)</Label>
          <Textarea
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
            placeholder="Why is this task blocked? e.g., Waiting on physician signature..."
            className="h-16"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Follow-up date</Label>
            <Input
              type="date"
              value={blockedUntil}
              onChange={(e) => setBlockedUntil(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select defaultValue="blocked" onValueChange={(v) => handleSetBlocked(v as 'blocked' | 'waiting_on_signature')}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="waiting_on_signature">Waiting on Signature</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowBlocker(false)}>
            Cancel
          </Button>
          <Button 
            size="sm" 
            variant="destructive"
            onClick={() => handleSetBlocked('blocked')}
            disabled={!blockedReason.trim()}
          >
            Mark Blocked
          </Button>
        </div>
      </div>
    );
  }

  // View mode
  const isBlocked = taskStatus === 'blocked' || taskStatus === 'waiting_on_signature';

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors group",
        taskStatus === 'completed' && 'opacity-60',
        isBlocked && 'bg-warning/5 border border-warning/30',
        task.escalated && 'bg-destructive/5 border border-destructive/30'
      )}
    >
      {isAdmin && (
        <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />
      )}
      
      <Checkbox
        checked={taskStatus === 'completed'}
        onCheckedChange={handleToggleComplete}
        disabled={!isAdmin || isBlocked}
      />
      
      <div className="text-muted-foreground">
        {getCategoryIcon(task.category)}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn(
            "text-sm",
            taskStatus === 'completed' && 'line-through'
          )}>
            {task.title}
          </p>
          {!task.is_required && (
            <Badge variant="outline" className="text-[10px] px-1">Optional</Badge>
          )}
          {task.is_required && (
            <Star className="h-3 w-3 text-warning fill-warning" />
          )}
          {isBlocked && (
            <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px] gap-1">
              <Lock className="h-3 w-3" />
              {taskStatus === 'waiting_on_signature' ? 'Waiting Signature' : 'Blocked'}
            </Badge>
          )}
          {task.escalated && (
            <Badge variant="destructive" className="text-[10px] gap-1">
              <Flag className="h-3 w-3" />
              Escalated
            </Badge>
          )}
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {task.description}
          </p>
        )}
        {/* Blocked reason display */}
        {isBlocked && task.blocked_reason && (
          <p className="text-xs text-warning mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {task.blocked_reason}
            {task.blocked_until && (
              <span className="text-muted-foreground ml-1">
                (follow-up: {format(new Date(task.blocked_until), 'MMM d')})
              </span>
            )}
          </p>
        )}
        {(task.due_date || task.external_url) && (
          <div className="flex items-center gap-3 mt-1">
            {task.due_date && (
              <span className={cn(
                "text-xs flex items-center gap-1",
                new Date(task.due_date) < new Date() && taskStatus !== 'completed'
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}>
                <Calendar className="h-3 w-3" />
                Due {format(new Date(task.due_date), 'MMM d')}
              </span>
            )}
            {task.external_url && (
              <a 
                href={task.external_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-primary flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Evidence
              </a>
            )}
          </div>
        )}
      </div>

      {/* Assignment / Self-assign */}
      {isAdmin && (
        task.assigned_to ? (
          <TaskAssignmentSelect
            taskId={task.id}
            transferId={transferId}
            currentAssigneeId={task.assigned_to}
            currentAssigneeName={task.assigned_to_name}
            onAssigned={onUpdate}
          />
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-primary gap-1"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) return;
                  const { data: profile } = await supabase
                    .from('profiles')
                    .select('full_name, email')
                    .eq('user_id', user.id)
                    .maybeSingle();
                  const displayName = profile?.full_name || profile?.email || user.email || 'Unknown';
                  
                  const { error } = await supabase
                    .from('agreement_tasks')
                    .update({
                      assigned_to: user.id,
                      assigned_to_name: displayName,
                      assigned_at: new Date().toISOString(),
                    })
                    .eq('id', task.id);
                  if (error) throw error;
                  
                  await supabase.from('transfer_activity_log').insert({
                    transfer_id: transferId,
                    task_id: task.id,
                    activity_type: 'task_assigned',
                    actor_id: user.id,
                    actor_name: displayName,
                    actor_role: 'admin',
                    description: `Self-assigned: ${task.title}`,
                  });
                  
                  toast({ title: 'Task claimed', description: `Assigned to ${displayName}` });
                  onUpdate();
                } catch (err: any) {
                  toast({ title: 'Error', description: err.message, variant: 'destructive' });
                }
              }}
            >
              <UserPlus className="h-3 w-3" />
              Claim
            </Button>
            <TaskAssignmentSelect
              taskId={task.id}
              transferId={transferId}
              currentAssigneeId={null}
              currentAssigneeName={null}
              onAssigned={onUpdate}
            />
          </div>
        )
      )}

      {/* Completion info */}
      {taskStatus === 'completed' && task.completed_at && (
        <span className="text-xs text-muted-foreground">
          {format(new Date(task.completed_at), 'MMM d')}
        </span>
      )}

      {/* Actions menu */}
      {isAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
            {!isBlocked && taskStatus !== 'completed' && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-warning hover:text-warning"
                onClick={() => setShowBlocker(true)}
              >
                <Lock className="h-4 w-4 mr-2" />
                Mark Blocked
              </Button>
            )}
            {isBlocked && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-success hover:text-success"
                onClick={() => handleSetBlocked('pending')}
              >
                <Unlock className="h-4 w-4 mr-2" />
                Unblock
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "w-full justify-start",
                task.escalated ? "text-muted-foreground" : "text-destructive hover:text-destructive"
              )}
              onClick={handleToggleEscalate}
            >
              <Flag className="h-4 w-4 mr-2" />
              {task.escalated ? 'Remove Escalation' : 'Escalate'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}