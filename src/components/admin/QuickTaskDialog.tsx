import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type WeekStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

export interface QuickTaskTarget {
  state: string;
  status: WeekStatus;
  slotsToday: number | null;
  slaTarget: number | null;
}

interface QuickTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  target: QuickTaskTarget | null;
  date: string;
}

function defaultPriority(status: WeekStatus): string {
  if (status === 'zero' || status === 'critical') return 'critical';
  if (status === 'low') return 'high';
  return 'medium';
}

export function QuickTaskDialog({ open, onClose, onSuccess, target, date }: QuickTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('critical');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && target) {
      const label = target.status === 'zero' ? 'ZERO SLOTS'
        : target.status === 'critical' ? 'CRITICAL'
        : target.status === 'low' ? 'LOW SLOTS'
        : target.status.toUpperCase();
      setTitle(`Coverage gap — ${target.state}: ${label}`);
      setDescription(
        `${target.state} has ${target.slotsToday ?? 0} available slot${target.slotsToday !== 1 ? 's' : ''}` +
        (target.slaTarget ? ` vs. daily SLA target of ${target.slaTarget}` : '') +
        `. Date: ${date}. Immediate follow-up required to restore coverage.`
      );
      setPriority(defaultPriority(target.status));
      setDueDate(date);
    }
  }, [open, target, date]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('agreement_tasks').insert({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category: 'custom' as any,
        due_date: dueDate || null,
        status: 'pending' as any,
        created_by: user?.id || null,
      });
      if (error) throw error;
      toast({ title: 'Task created', description: `Coverage task for ${target?.state} added to queue.` });
      onSuccess();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Quick Task — {target.state}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
