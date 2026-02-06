import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { UserPlus } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface TaskAssignmentSelectProps {
  taskId: string;
  transferId: string;
  currentAssigneeId: string | null;
  currentAssigneeName: string | null;
  onAssigned?: () => void;
}

export function TaskAssignmentSelect({ 
  taskId, 
  transferId,
  currentAssigneeId, 
  currentAssigneeName,
  onAssigned 
}: TaskAssignmentSelectProps) {
  const { toast } = useToast();
  const [assignees, setAssignees] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAssignees = async () => {
      // Get all admin users who can be assigned tasks
      const { data: adminRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (adminRoles && adminRoles.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('user_id', adminRoles.map(r => r.user_id).filter(Boolean) as string[]);

        if (profiles) {
          setAssignees(profiles);
        }
      }
    };

    fetchAssignees();
  }, []);

  const handleAssign = async (assigneeId: string) => {
    if (assigneeId === currentAssigneeId) return;

    setLoading(true);
    try {
      const assignee = assignees.find(a => a.id === assigneeId);
      const { data: { user } } = await supabase.auth.getUser();

      // Update the task
      const { error: taskError } = await supabase
        .from('agreement_tasks')
        .update({
          assigned_to: assigneeId,
          assigned_to_name: assignee?.full_name || assignee?.email || 'Unknown',
          assigned_at: new Date().toISOString(),
          notification_status: 'pending',
        })
        .eq('id', taskId);

      if (taskError) throw taskError;

      // Log the activity
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        task_id: taskId,
        activity_type: currentAssigneeId ? 'task_reassigned' : 'task_assigned',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: `Task assigned to ${assignee?.full_name || assignee?.email}`,
        metadata: {
          previous_assignee: currentAssigneeName,
          new_assignee: assignee?.full_name || assignee?.email,
        },
      });

      toast({
        title: 'Task assigned',
        description: `Assigned to ${assignee?.full_name || assignee?.email}`,
      });

      onAssigned?.();
    } catch (error) {
      console.error('Error assigning task:', error);
      toast({
        title: 'Error',
        description: 'Failed to assign task.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (assignees.length === 0) {
    return currentAssigneeName ? (
      <Badge variant="outline" className="text-xs">
        {currentAssigneeName}
      </Badge>
    ) : null;
  }

  return (
    <Select 
      value={currentAssigneeId || ''} 
      onValueChange={handleAssign}
      disabled={loading}
    >
      <SelectTrigger className="h-7 w-[140px] text-xs">
        <SelectValue placeholder={
          <span className="flex items-center gap-1 text-muted-foreground">
            <UserPlus className="h-3 w-3" />
            Assign
          </span>
        } />
      </SelectTrigger>
      <SelectContent>
        {assignees.map(assignee => (
          <SelectItem key={assignee.id} value={assignee.id}>
            {assignee.full_name || assignee.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
