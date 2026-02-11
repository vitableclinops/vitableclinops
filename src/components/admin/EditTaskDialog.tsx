import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Loader2, Pencil, Clock, MapPin, User, Flag, Archive, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';
import type { Database } from '@/integrations/supabase/types';

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

interface LinkedProvider {
  id: string;
  provider_id: string;
  role_label: string;
  full_name: string | null;
  email: string | null;
}

interface EditTaskDialogProps {
  task: DashboardTaskItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditTaskDialog({ task, onClose, onSuccess }: EditTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('pending');
  const [category, setCategory] = useState<string>('custom');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkedProviders, setLinkedProviders] = useState<LinkedProvider[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setStatus(task.status || 'pending');
      setCategory(task.category || 'custom');
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '');
      setNotes('');

      // Fetch linked providers from junction table
      supabase
        .from('task_linked_providers')
        .select('id, provider_id, role_label')
        .eq('task_id', task.id)
        .then(async ({ data: links }) => {
          if (!links || links.length === 0) {
            setLinkedProviders([]);
            return;
          }
          const providerIds = links.map(l => l.provider_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', providerIds);

          const profileMap = new Map((profiles || []).map(p => [p.id, p]));
          setLinkedProviders(
            links.map(l => ({
              id: l.id,
              provider_id: l.provider_id,
              role_label: l.role_label,
              full_name: profileMap.get(l.provider_id)?.full_name || null,
              email: profileMap.get(l.provider_id)?.email || null,
            }))
          );
        });
    }
  }, [task]);

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    try {
      if (task.category === 'milestone') {
        await supabase
          .from('milestone_tasks')
          .update({
            title,
            description: description || null,
            due_date: dueDate || task.due_date || new Date().toISOString().split('T')[0],
            status,
          })
          .eq('id', task.id);
      } else {
        const updatePayload: Record<string, any> = {
          title,
          description: description || null,
          priority,
          status: status as any,
          category: category as any,
          due_date: dueDate || null,
        };

        if (notes.trim()) {
          updatePayload.notes = notes.trim();
        }

        if (status === 'completed') {
          const { data: { user } } = await supabase.auth.getUser();
          updatePayload.completed_at = new Date().toISOString();
          updatePayload.completed_by = user?.id || null;
        }

        await supabase
          .from('agreement_tasks')
          .update(updatePayload)
          .eq('id', task.id);
      }

      toast({ title: 'Task updated', description: 'Changes saved successfully.' });
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!task) return null;

  const isMilestone = task.category === 'milestone';
  const isArchived = task.status === 'archived';

  return (
    <Dialog open={!!task} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit Task
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            {task.state_abbreviation && (
              <Badge variant="outline" className="gap-1 text-xs">
                <MapPin className="h-3 w-3" />
                {task.state_abbreviation}
              </Badge>
            )}
            {task.assigned_to_name && (
              <Badge variant="secondary" className="text-xs">
                Assigned: {task.assigned_to_name}
              </Badge>
            )}
            {isArchived && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <Archive className="h-3 w-3" />
                Archived
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Linked Providers - read-only, always visible */}
          {linkedProviders.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Link2 className="h-3.5 w-3.5" />
                Linked Providers
              </Label>
              <div className="space-y-1.5">
                {linkedProviders.map((lp) => (
                  <div
                    key={lp.id}
                    className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">{lp.full_name || 'Unknown'}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                      {lp.role_label}
                    </Badge>
                    {lp.email && (
                      <span className="text-muted-foreground text-xs ml-auto truncate">{lp.email}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Provider links cannot be removed. They ensure visibility on each provider's dashboard.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isArchived}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Task details…"
              disabled={isArchived}
            />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus} disabled={isArchived}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="task-due-date">Due Date</Label>
            <Input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isArchived}
            />
          </div>

          {!isMilestone && !isArchived && (
            <div className="space-y-2">
              <Label htmlFor="task-notes">Add Note</Label>
              <Textarea
                id="task-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional note to append…"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {isArchived ? 'Close' : 'Cancel'}
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
