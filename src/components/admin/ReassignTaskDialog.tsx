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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCog, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface ReassignTaskDialogProps {
  taskId: string | null;
  taskTitle: string;
  currentAssignee: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReassignTaskDialog({ taskId, taskTitle, currentAssignee, onClose, onSuccess }: ReassignTaskDialogProps) {
  const [selectedUser, setSelectedUser] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!taskId) return;
    setLoadingMembers(true);
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name')
      .then(({ data }) => {
        setTeamMembers((data || []) as TeamMember[]);
        setLoadingMembers(false);
      });
  }, [taskId]);

  const handleReassign = async () => {
    if (!taskId || !selectedUser) return;
    setSaving(true);
    try {
      const member = teamMembers.find(m => m.id === selectedUser);
      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          assigned_to: selectedUser,
          assigned_to_name: member?.full_name || member?.email || 'Unknown',
          assigned_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;
      toast({ title: 'Task reassigned', description: `Assigned to ${member?.full_name || member?.email}` });
      setSelectedUser('');
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!taskId} onOpenChange={() => { setSelectedUser(''); onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Reassign Task
          </DialogTitle>
          <DialogDescription>
            Reassign "<span className="font-medium">{taskTitle}</span>" to another team member.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>Assign to</Label>
          {loadingMembers ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading team members…
            </div>
          ) : (
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers.map(m => (
                  <SelectItem key={m.id} value={m.id} disabled={m.id === currentAssignee}>
                    {m.full_name || m.email}
                    {m.id === currentAssignee && ' (current)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setSelectedUser(''); onClose(); }}>
            Cancel
          </Button>
          <Button onClick={handleReassign} disabled={saving || !selectedUser}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
