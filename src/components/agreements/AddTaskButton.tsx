import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';

interface AddTaskButtonProps {
  transferId: string;
  agreementId: string;
  phase: 'termination' | 'initiation';
  stateAbbreviation: string;
  stateName: string;
  nextSortOrder: number;
  physicianId?: string | null;
  onAdded: () => void;
}

export function AddTaskButton({
  transferId,
  agreementId,
  phase,
  stateAbbreviation,
  stateName,
  nextSortOrder,
  physicianId,
  onAdded,
}: AddTaskButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [dueDate, setDueDate] = useState('');
  const [isRequired, setIsRequired] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!title.trim()) return;
    
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      type TaskCategory = 'agreement_creation' | 'chart_review' | 'compliance' | 'custom' | 'document' | 'renewal' | 'signature' | 'supervision_meeting' | 'termination';
      
      const taskData = {
        transfer_id: transferId,
        agreement_id: agreementId,
        title: title.trim(),
        description: description.trim() || null,
        category: category as TaskCategory,
        status: 'pending' as const,
        priority: 'medium',
        assigned_role: 'admin',
        is_auto_generated: false,
        auto_trigger: phase === 'termination' ? 'transfer_termination' : 'transfer_initiation',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
        is_required: isRequired,
        sort_order: nextSortOrder,
        due_date: dueDate || null,
        physician_id: physicianId || null,
      };

      const { error } = await supabase.from('agreement_tasks').insert(taskData);

      if (error) throw error;

      // Log the addition
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        activity_type: 'task_added',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: `Added task: ${title.trim()}`,
        metadata: { phase, category, is_required: isRequired },
      });

      toast({ title: 'Task added' });
      setOpen(false);
      resetForm();
      onAdded();
    } catch (error) {
      console.error('Error adding task:', error);
      toast({
        title: 'Error',
        description: 'Failed to add task.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('custom');
    setDueDate('');
    setIsRequired(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {phase === 'termination' ? 'Termination' : 'Initiation'} Task</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title *</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                    <SelectItem value="signature">Signature</SelectItem>
                    <SelectItem value="supervision_meeting">Meeting</SelectItem>
                    <SelectItem value="chart_review">Chart Review</SelectItem>
                    <SelectItem value="termination">Termination</SelectItem>
                    <SelectItem value="agreement_creation">Agreement</SelectItem>
                    <SelectItem value="compliance">Compliance</SelectItem>
                    <SelectItem value="renewal">Renewal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving || !title.trim()}>
              {saving ? 'Adding...' : 'Add Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}