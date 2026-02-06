import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import {
  User,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flag,
  MoreVertical,
  Filter,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Task = Tables<'agreement_tasks'>;

interface ProviderStatusRow {
  id: string;
  transfer_id: string;
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  status: string;
  blocked_reason: string | null;
  blocked_until: string | null;
  escalated: boolean;
  escalated_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface TransferProviderSubtableProps {
  transferId: string;
  affectedProviderIds: string[];
  tasks: Task[];
  isAdmin: boolean;
  onUpdate: () => void;
}

export function TransferProviderSubtable({
  transferId,
  affectedProviderIds,
  tasks,
  isAdmin,
  onUpdate,
}: TransferProviderSubtableProps) {
  const { toast } = useToast();
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'blocked' | 'overdue' | 'pending'>('all');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchProviderStatuses();
  }, [transferId]);

  const fetchProviderStatuses = async () => {
    const { data, error } = await supabase
      .from('transfer_provider_status')
      .select('*')
      .eq('transfer_id', transferId)
      .order('provider_name');

    if (!error && data) {
      setProviderStatuses(data as ProviderStatusRow[]);
    }
    setLoading(false);
  };

  // Calculate task stats per provider
  const getProviderTaskStats = (providerId: string) => {
    // For now, we divide tasks by provider count as approximation
    // In full implementation, tasks would have provider_id
    const providerTasks = tasks; // Would filter by provider
    const required = providerTasks.filter(t => t.is_required !== false);
    const completed = required.filter(t => t.status === 'completed');
    const blocked = providerTasks.filter(t => t.status === 'blocked');
    const overdue = providerTasks.filter(t => 
      t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed'
    );

    return {
      total: required.length,
      completed: completed.length,
      blocked: blocked.length,
      overdue: overdue.length,
      progress: required.length > 0 ? (completed.length / required.length) * 100 : 0,
    };
  };

  const getStatusBadge = (status: string, escalated: boolean) => {
    if (escalated) {
      return (
        <Badge className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
          <Flag className="h-3 w-3" />
          Escalated
        </Badge>
      );
    }
    switch (status) {
      case 'completed':
        return <Badge className="bg-success/10 text-success border-success/20 gap-1"><CheckCircle2 className="h-3 w-3" />Complete</Badge>;
      case 'blocked':
        return <Badge className="bg-warning/10 text-warning border-warning/20 gap-1"><AlertTriangle className="h-3 w-3" />Blocked</Badge>;
      case 'in_progress':
        return <Badge className="bg-primary/10 text-primary border-primary/20 gap-1"><Clock className="h-3 w-3" />In Progress</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    }
  };

  const handleEscalate = async (providerStatus: ProviderStatusRow) => {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase
      .from('transfer_provider_status')
      .update({
        escalated: !providerStatus.escalated,
        escalated_at: !providerStatus.escalated ? new Date().toISOString() : null,
      })
      .eq('id', providerStatus.id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update escalation.', variant: 'destructive' });
      return;
    }

    // Log activity
    await supabase.from('transfer_activity_log').insert({
      transfer_id: transferId,
      activity_type: providerStatus.escalated ? 'escalation_removed' : 'escalation_added',
      actor_id: user?.id,
      actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
      actor_role: 'admin',
      description: `${providerStatus.escalated ? 'Removed escalation from' : 'Escalated'}: ${providerStatus.provider_name}`,
    });

    toast({ title: providerStatus.escalated ? 'Escalation removed' : 'Provider escalated' });
    fetchProviderStatuses();
    onUpdate();
  };

  const handleBlockProvider = async (
    providerStatus: ProviderStatusRow, 
    reason: string, 
    until?: string
  ) => {
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('transfer_provider_status')
      .update({
        status: 'blocked',
        blocked_reason: reason,
        blocked_until: until || null,
      })
      .eq('id', providerStatus.id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to block provider.', variant: 'destructive' });
      return;
    }

    // Log activity
    await supabase.from('transfer_activity_log').insert({
      transfer_id: transferId,
      activity_type: 'provider_blocked',
      actor_id: user?.id,
      actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
      actor_role: 'admin',
      description: `Blocked ${providerStatus.provider_name}: ${reason}`,
      metadata: { blocked_until: until },
    });

    toast({ title: 'Provider marked as blocked' });
    fetchProviderStatuses();
    onUpdate();
  };

  const filteredProviders = providerStatuses.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'blocked') return p.status === 'blocked' || p.escalated;
    if (filter === 'pending') return p.status === 'pending' || p.status === 'in_progress';
    return true;
  });

  if (loading) {
    return <div className="animate-pulse h-20 bg-muted rounded-md" />;
  }

  if (providerStatuses.length === 0) {
    return null; // No provider-level tracking yet
  }

  return (
    <div className="border rounded-lg">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Provider Status</span>
          <Badge variant="outline" className="text-xs">
            {providerStatuses.filter(p => p.status === 'completed').length}/{providerStatuses.length} complete
          </Badge>
          {providerStatuses.some(p => p.escalated) && (
            <Badge variant="destructive" className="text-xs gap-1">
              <Flag className="h-3 w-3" />
              {providerStatuses.filter(p => p.escalated).length} escalated
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>

      {expanded && (
        <div className="border-t">
          {/* Filters */}
          <div className="p-2 border-b bg-muted/30 flex items-center gap-2">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <div className="flex gap-1">
              {(['all', 'blocked', 'pending'] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* Provider rows */}
          <div className="divide-y">
            {filteredProviders.map(provider => {
              const stats = getProviderTaskStats(provider.provider_id);
              
              return (
                <div 
                  key={provider.id} 
                  className={cn(
                    "flex items-center gap-3 p-3 hover:bg-muted/30",
                    provider.escalated && "bg-destructive/5"
                  )}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {provider.provider_name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {provider.provider_name}
                      </span>
                      {getStatusBadge(provider.status, provider.escalated)}
                    </div>
                    {provider.blocked_reason && (
                      <p className="text-xs text-warning mt-0.5 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {provider.blocked_reason}
                        {provider.blocked_until && (
                          <span className="text-muted-foreground">
                            (until {format(new Date(provider.blocked_until), 'MMM d')})
                          </span>
                        )}
                      </p>
                    )}
                    {provider.last_activity_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Last activity: {formatDistanceToNow(new Date(provider.last_activity_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {stats.completed}/{stats.total} tasks
                      </p>
                      <Progress value={stats.progress} className="w-16 h-1.5" />
                    </div>

                    {isAdmin && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64" align="end">
                          <div className="space-y-3">
                            <Button
                              variant={provider.escalated ? 'outline' : 'destructive'}
                              size="sm"
                              className="w-full"
                              onClick={() => handleEscalate(provider)}
                            >
                              <Flag className="h-4 w-4 mr-2" />
                              {provider.escalated ? 'Remove Escalation' : 'Escalate'}
                            </Button>
                            
                            {provider.status !== 'blocked' && (
                              <BlockProviderForm 
                                onBlock={(reason, until) => handleBlockProvider(provider, reason, until)} 
                              />
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockProviderForm({ onBlock }: { onBlock: (reason: string, until?: string) => void }) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');

  return (
    <div className="space-y-2 pt-2 border-t">
      <Label className="text-xs">Mark as Blocked</Label>
      <Textarea
        placeholder="Reason for blocking..."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-16 text-xs"
      />
      <Input
        type="date"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        placeholder="Follow-up date"
        className="text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => onBlock(reason, until)}
        disabled={!reason.trim()}
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        Mark Blocked
      </Button>
    </div>
  );
}
