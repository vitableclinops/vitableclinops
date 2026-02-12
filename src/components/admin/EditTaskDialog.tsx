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
import { Loader2, Pencil, MapPin, Archive, Copy, Search, Cake, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';
import type { Database } from '@/integrations/supabase/types';
import { LinkedProviderEditor, type LinkedProviderItem } from './LinkedProviderEditor';

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
  const [linkedProviders, setLinkedProviders] = useState<LinkedProviderItem[]>([]);
  const [initialLinkedIds, setInitialLinkedIds] = useState<Set<string>>(new Set());
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
            // Fallback: show legacy provider_id
            if (task.provider_id) {
              const { data: fallback } = await supabase
                .from('profiles')
                .select('id, full_name, email')
                .eq('id', task.provider_id)
                .single();
              if (fallback) {
                const item: LinkedProviderItem = {
                  id: 'legacy',
                  provider_id: fallback.id,
                  role_label: 'NP',
                  full_name: fallback.full_name,
                  email: fallback.email,
                };
                setLinkedProviders([item]);
                setInitialLinkedIds(new Set([fallback.id]));
                return;
              }
            }
            setLinkedProviders([]);
            setInitialLinkedIds(new Set());
            return;
          }
          const providerIds = links.map(l => l.provider_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', providerIds);

          const profileMap = new Map((profiles || []).map(p => [p.id, p]));
          const items: LinkedProviderItem[] = links.map(l => ({
            id: l.id,
            provider_id: l.provider_id,
            role_label: l.role_label,
            full_name: profileMap.get(l.provider_id)?.full_name || null,
            email: profileMap.get(l.provider_id)?.email || null,
          }));
          setLinkedProviders(items);
          setInitialLinkedIds(new Set(providerIds));
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

        // Sync linked providers
        const currentIds = new Set(linkedProviders.map(lp => lp.provider_id));
        
        // Delete removed providers
        const toRemove = [...initialLinkedIds].filter(id => !currentIds.has(id));
        if (toRemove.length > 0) {
          await supabase
            .from('task_linked_providers')
            .delete()
            .eq('task_id', task.id)
            .in('provider_id', toRemove);
        }

        // Insert new providers
        const toAdd = linkedProviders.filter(lp => !initialLinkedIds.has(lp.provider_id));
        if (toAdd.length > 0) {
          await supabase.from('task_linked_providers').insert(
            toAdd.map(lp => ({
              task_id: task.id,
              provider_id: lp.provider_id,
              role_label: lp.role_label,
            }))
          );
        }

        // Update role labels for existing providers
        const toUpdate = linkedProviders.filter(lp => initialLinkedIds.has(lp.provider_id) && !lp.id.startsWith('new-'));
        for (const lp of toUpdate) {
          await supabase
            .from('task_linked_providers')
            .update({ role_label: lp.role_label })
            .eq('task_id', task.id)
            .eq('provider_id', lp.provider_id);
        }
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
          {/* Linked Providers - editable */}
          <LinkedProviderEditor
            value={linkedProviders}
            onChange={setLinkedProviders}
            disabled={isArchived}
          />

          <Separator />

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

          {isMilestone && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  {task.milestone_type === 'birthday' ? <Cake className="h-3.5 w-3.5 text-pink-500" /> : <Trophy className="h-3.5 w-3.5 text-amber-500" />}
                  Celebration Helper
                </Label>
                {task.slack_template && (
                  <div className="bg-muted/40 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-line">
                    {task.slack_template}
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          const message = task.slack_template || task.title;
                          navigator.clipboard.writeText(message);
                          toast({ title: 'Copied to clipboard', description: 'Celebration message copied!' });
                        }}
                      >
                        <Copy className="h-3 w-3" />
                        Copy Message
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy celebration message to clipboard</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          const term = task.milestone_type === 'birthday' ? 'happy birthday celebration' : 'work anniversary congratulations';
                          window.open(`https://giphy.com/search/${encodeURIComponent(term)}`, '_blank');
                        }}
                      >
                        <Search className="h-3 w-3" />
                        Find GIF
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Search for a celebration GIF</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </>
          )}

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
