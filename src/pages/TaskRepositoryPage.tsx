import { useState, useEffect, useCallback } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Search, ListChecks, Clock, Flag, Lock, Archive, CheckCircle2,
  MapPin, User, ArrowRightLeft, ShieldCheck, FileText, Cake, Users,
  RefreshCw, ExternalLink, UserPlus, X, Paperclip,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog';

type TaskStatus = 'active' | 'all' | 'pending' | 'in_progress' | 'completed' | 'blocked' | 'waiting_on_signature' | 'archived';
type TaskCategory = 'all' | 'document' | 'signature' | 'supervision_meeting' | 'chart_review' | 'compliance' | 'transfer' | 'onboarding' | 'milestone' | 'outreach' | 'communication' | 'custom';

interface RepoTask {
  id: string;
  title: string;
  status: string;
  category: string;
  state_name: string | null;
  state_abbreviation: string | null;
  assigned_to_name: string | null;
  assigned_to: string | null;
  priority: string | null;
  due_date: string | null;
  completed_at: string | null;
  archived_at: string | null;
  provider_id: string | null;
  provider_name?: string | null;
  transfer_id: string | null;
  agreement_id: string | null;
  agreement_label?: string | null;
  escalated: boolean | null;
  blocked_reason: string | null;
  description: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
  source: 'agreement' | 'milestone';
  requires_upload?: boolean;
  document_count?: number;
  // milestone extras
  milestone_type?: string | null;
  slack_template?: string | null;
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'document': case 'signature': return <FileText className="h-3.5 w-3.5" />;
    case 'supervision_meeting': case 'chart_review': case 'compliance': return <ShieldCheck className="h-3.5 w-3.5" />;
    case 'transfer': case 'onboarding': return <ArrowRightLeft className="h-3.5 w-3.5" />;
    case 'outreach': case 'communication': return <Users className="h-3.5 w-3.5" />;
    case 'milestone': return <Cake className="h-3.5 w-3.5" />;
    default: return <ListChecks className="h-3.5 w-3.5" />;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed': return <Badge className="bg-success/10 text-success border-success/20 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Completed</Badge>;
    case 'archived': return <Badge variant="secondary" className="text-[10px]"><Archive className="h-2.5 w-2.5 mr-0.5" />Archived</Badge>;
    case 'in_progress': return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">In Progress</Badge>;
    case 'blocked': return <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px]"><Lock className="h-2.5 w-2.5 mr-0.5" />Blocked</Badge>;
    case 'waiting_on_signature': return <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px]"><Lock className="h-2.5 w-2.5 mr-0.5" />Waiting Sig</Badge>;
    case 'pending': return <Badge variant="outline" className="text-[10px]">Pending</Badge>;
    default: return <Badge variant="outline" className="text-[10px] capitalize">{status}</Badge>;
  }
}

const STATUS_COUNTS_DISPLAY: { key: TaskStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'waiting_on_signature', label: 'Waiting Sig' },
  { key: 'archived', label: 'Archived' },
];

const PAGE_SIZE = 50;

export default function TaskRepositoryPage() {
  const { profile, hasRole } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasRole('admin');
  const isPodLead = hasRole('pod_lead') && !isAdmin;
  const userRole = isAdmin ? 'admin' : isPodLead ? 'pod_lead' : 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';

  const { toast } = useToast();

  const [tasks, setTasks] = useState<RepoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus>('active' as TaskStatus);
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory>('all');
  const [sortBy, setSortBy] = useState<'updated_at' | 'due_date' | 'created_at'>('updated_at');

  // Selection & bulk assign
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [detailTask, setDetailTask] = useState<RepoTask | null>(null);

  // Fetch team members for assignment
  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').in('role', ['admin']);
      if (roles && roles.length > 0) {
        const uids = [...new Set(roles.map(r => r.user_id).filter(Boolean))] as string[];
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('user_id', uids).order('full_name');
        setTeamMembers((profs || []).map(p => ({ id: p.id, name: p.full_name || p.email || 'Unknown' })));
      }
    })();
  }, []);

  // Clear selection when filters/page change
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, categoryFilter, search, page]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const agreementTasks = tasks.filter(t => t.source === 'agreement');
    if (selectedIds.size === agreementTasks.length && agreementTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(agreementTasks.map(t => t.id)));
    }
  };

  const handleBulkAssign = async (assigneeId: string) => {
    if (selectedIds.size === 0) return;
    setBulkAssigning(true);
    try {
      const assignee = teamMembers.find(m => m.id === assigneeId);
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          assigned_to: assigneeId,
          assigned_to_name: assignee?.name || 'Unknown',
          assigned_at: new Date().toISOString(),
        })
        .in('id', ids);
      if (error) throw error;
      toast({ title: `${ids.length} task${ids.length > 1 ? 's' : ''} assigned`, description: `Assigned to ${assignee?.name}` });
      setSelectedIds(new Set());
      fetchTasks();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to assign tasks.', variant: 'destructive' });
    } finally {
      setBulkAssigning(false);
    }
  };

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Build agreement_tasks query
      let q = supabase
        .from('agreement_tasks')
        .select('id, title, status, category, state_name, state_abbreviation, assigned_to_name, assigned_to, priority, due_date, completed_at, archived_at, provider_id, transfer_id, agreement_id, escalated, blocked_reason, description, archived_reason, created_at, updated_at, requires_upload', { count: 'exact' });

      if (statusFilter === 'active') {
        q = q.not('status', 'in', '("completed","archived")');
      } else if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter as any);
      }
      if (categoryFilter !== 'all') q = q.eq('category', categoryFilter as any);
      if (search.trim()) q = q.ilike('title', `%${search.trim()}%`);

      q = q.order(sortBy, { ascending: false }).range(from, to);

      const { data, count, error } = await q;
      if (error) throw error;

      // Enrich with provider names
      const enriched = (data || []) as RepoTask[];
      enriched.forEach(t => { t.source = 'agreement'; });

      // Enrich with provider names
      const providerIds = [...new Set(enriched.map(t => t.provider_id).filter(Boolean))] as string[];
      if (providerIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', providerIds);
        const nameMap = new Map((profs || []).map(p => [p.id, p.full_name]));
        enriched.forEach(t => { if (t.provider_id) t.provider_name = nameMap.get(t.provider_id); });
      }

      // Enrich with agreement origin labels (provider ↔ physician)
      const agreementIds = [...new Set(enriched.map(t => t.agreement_id).filter(Boolean))] as string[];
      if (agreementIds.length > 0) {
        const { data: agreements } = await supabase
          .from('collaborative_agreements')
          .select('id, provider_name, physician_name, state_abbreviation')
          .in('id', agreementIds);
        const labelMap = new Map((agreements || []).map(a => {
          const provider = a.provider_name || 'Provider';
          const physician = a.physician_name ? `Dr. ${a.physician_name}` : 'Physician';
          return [a.id, `${provider} ↔ ${physician} (${a.state_abbreviation})`];
        }));
        enriched.forEach(t => { if (t.agreement_id) t.agreement_label = labelMap.get(t.agreement_id); });
      }

      // Enrich with document counts
      const taskIds = enriched.map(t => t.id);
      if (taskIds.length > 0) {
        const { data: docs } = await supabase
          .from('task_documents')
          .select('task_id')
          .in('task_id', taskIds);
        const docCounts = new Map<string, number>();
        (docs || []).forEach(d => docCounts.set(d.task_id, (docCounts.get(d.task_id) || 0) + 1));
        enriched.forEach(t => { t.document_count = docCounts.get(t.id) || 0; });
      }

      // Also fetch milestone tasks if no category filter (or milestone selected)
      let milestoneTasks: RepoTask[] = [];
      if (categoryFilter === 'all' || categoryFilter === 'milestone') {
        let mq = supabase
          .from('milestone_tasks')
          .select('id, title, status, milestone_type, due_date, completed_at, created_at, updated_at, provider_id, provider_name, assigned_to, assigned_to_name, description, slack_template');

        if (statusFilter === 'active') {
          mq = mq.not('status', 'in', '("completed","archived")');
        } else if (statusFilter !== 'all') {
          // Only include milestone tasks if the status is one they support (pending/completed)
          if (statusFilter === 'pending' || statusFilter === 'completed') {
            mq = mq.eq('status', statusFilter);
          } else {
            // Milestones don't support in_progress/blocked/waiting_on_signature/archived — skip
            milestoneTasks = [];
            // skip the query
            const all = [...enriched].sort((a, b) =>
              new Date(b[sortBy] || b.updated_at).getTime() - new Date(a[sortBy] || a.updated_at).getTime()
            );
            setTasks(all);
            setTotal(count || 0);
            return;
          }
        }
        if (search.trim()) mq = mq.ilike('title', `%${search.trim()}%`);

        const { data: mData } = await mq.order('updated_at', { ascending: false }).limit(50);
        milestoneTasks = (mData || []).map(m => ({
          id: m.id,
          title: m.title,
          status: m.status,
          category: 'milestone',
          state_name: null,
          state_abbreviation: null,
          assigned_to_name: m.assigned_to_name,
          assigned_to: m.assigned_to,
          priority: 'medium',
          due_date: m.due_date,
          completed_at: m.completed_at,
          archived_at: null,
          provider_id: m.provider_id,
          provider_name: m.provider_name,
          transfer_id: null,
          agreement_id: null,
          agreement_label: null,
          escalated: false,
          blocked_reason: null,
          description: m.description,
          archived_reason: null,
          created_at: m.created_at,
          updated_at: m.updated_at,
          source: 'milestone' as const,
          milestone_type: m.milestone_type,
          slack_template: m.slack_template,
        }));
      }

      const all = [...enriched, ...milestoneTasks].sort((a, b) =>
        new Date(b[sortBy] || b.updated_at).getTime() - new Date(a[sortBy] || a.updated_at).getTime()
      );

      setTasks(all);
      setTotal((count || 0) + milestoneTasks.length);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, search, sortBy, page]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, categoryFilter, search, sortBy]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const now = new Date();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Task Repository</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Central view of all tasks across all agreements, providers, and workflows.
            </p>
          </div>

          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tasks..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as TaskStatus)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (excludes completed/archived)</SelectItem>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="waiting_on_signature">Waiting Signature</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={v => setCategoryFilter(v as TaskCategory)}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="document">Documents</SelectItem>
                    <SelectItem value="signature">Signatures</SelectItem>
                    <SelectItem value="supervision_meeting">Supervision Meetings</SelectItem>
                    <SelectItem value="chart_review">Chart Review</SelectItem>
                    <SelectItem value="compliance">Compliance</SelectItem>
                    <SelectItem value="transfer">Transfers</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="milestone">Milestones</SelectItem>
                    <SelectItem value="outreach">Outreach</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated_at">Last Updated</SelectItem>
                    <SelectItem value="created_at">Date Created</SelectItem>
                    <SelectItem value="due_date">Due Date</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={fetchTasks}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Status filter chips */}
          <div className="flex gap-1.5 flex-wrap mb-4">
            {STATUS_COUNTS_DISPLAY.map(s => (
              <Button
                key={s.key}
                variant={statusFilter === s.key ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-7"
                onClick={() => setStatusFilter(s.key)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isAdmin && tasks.length > 0 && (
                    <Checkbox
                      checked={selectedIds.size > 0 && selectedIds.size === tasks.filter(t => t.source === 'agreement').length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  )}
                  <span>
                    {loading ? 'Loading...' : `${total.toLocaleString()} task${total !== 1 ? 's' : ''}`}
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ListChecks className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No tasks found</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tasks.map(task => {
                    const isOverdue = task.due_date && new Date(task.due_date) < now && task.status !== 'completed' && task.status !== 'archived';
                    return (
                      <div
                        key={`${task.source}-${task.id}`}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors group cursor-pointer",
                          isOverdue && "border-destructive/40 bg-destructive/5",
                          task.status === 'completed' && "opacity-70",
                          task.status === 'archived' && "opacity-50",
                        )}
                        onClick={() => setDetailTask(task)}
                      >
                        {isAdmin && task.source === 'agreement' && (
                          <div className="shrink-0" onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(task.id)}
                              onCheckedChange={() => toggleSelect(task.id)}
                              aria-label={`Select ${task.title}`}
                            />
                          </div>
                        )}
                        <div className="text-muted-foreground shrink-0">
                          {getCategoryIcon(task.category)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{task.title}</p>
                            {getStatusBadge(task.status)}
                            {isOverdue && (
                              <Badge variant="destructive" className="text-[10px] gap-0.5 px-1">
                                <Clock className="h-2.5 w-2.5" /> Overdue
                              </Badge>
                            )}
                            {task.escalated && (
                              <Badge variant="destructive" className="text-[10px] gap-0.5 px-1">
                                <Flag className="h-2.5 w-2.5" /> Escalated
                              </Badge>
                            )}
                            {task.source === 'milestone' && (
                              <Badge variant="outline" className="text-[10px]">
                                <Cake className="h-2.5 w-2.5 mr-0.5" />
                                {task.milestone_type === 'birthday' ? 'Birthday' : 'Anniversary'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            {task.assigned_to_name ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal">
                                <User className="h-2.5 w-2.5" />
                                {task.assigned_to_name}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal text-muted-foreground/60">
                                <User className="h-2.5 w-2.5" />
                                Unassigned
                              </Badge>
                            )}
                            {task.state_abbreviation && (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="h-3 w-3" />
                                {task.state_abbreviation}
                              </span>
                            )}
                            {task.provider_name && (
                              <span className="flex items-center gap-0.5">
                                <User className="h-3 w-3" />
                                {task.provider_name}
                              </span>
                            )}
                            {task.due_date && (
                              <span className={cn("flex items-center gap-0.5", isOverdue && "text-destructive")}>
                                <Clock className="h-3 w-3" />
                                Due {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                            {task.completed_at && task.status === 'completed' && (
                              <span className="flex items-center gap-0.5 text-success">
                                <CheckCircle2 className="h-3 w-3" />
                                Completed {new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                            {task.agreement_label && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1 cursor-pointer hover:bg-muted/50 max-w-[240px] truncate"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (task.agreement_id) navigate(`/admin/agreements/${task.agreement_id}`);
                                }}
                              >
                                <FileText className="h-2.5 w-2.5 mr-0.5 shrink-0" />
                                <span className="truncate">{task.agreement_label}</span>
                              </Badge>
                            )}
                            {task.transfer_id && (
                              <Badge variant="outline" className="text-[10px] px-1">
                                <ArrowRightLeft className="h-2.5 w-2.5 mr-0.5" />Transfer
                              </Badge>
                            )}
                          </div>
                          {task.blocked_reason && (
                            <p className="text-xs text-warning mt-0.5 truncate">{task.blocked_reason}</p>
                          )}
                          {task.archived_reason && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate italic">{task.archived_reason}</p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {(task.document_count ?? 0) > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1 gap-0.5">
                              <Paperclip className="h-2.5 w-2.5" />
                              {task.document_count}
                            </Badge>
                          )}
                          {task.requires_upload && (task.document_count ?? 0) === 0 && task.status !== 'completed' && task.status !== 'archived' && (
                            <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px] px-1 gap-0.5">
                              <Paperclip className="h-2.5 w-2.5" />
                              Needs doc
                            </Badge>
                          )}
                          {task.priority && task.priority !== 'medium' && (
                            <Badge
                              className={cn(
                                "text-[10px]",
                                task.priority === 'critical' && "bg-destructive/10 text-destructive border-destructive/20",
                                task.priority === 'high' && "bg-warning/10 text-warning border-warning/20",
                                task.priority === 'low' && "bg-muted text-muted-foreground",
                              )}
                            >
                              <Flag className="h-2.5 w-2.5 mr-0.5" />
                              {task.priority}
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground hidden md:block whitespace-nowrap">
                            {new Date(task.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {!loading && total > PAGE_SIZE && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <TaskDetailDialog
            task={detailTask}
            open={!!detailTask}
            onOpenChange={(open) => { if (!open) setDetailTask(null); }}
            isAdmin={isAdmin}
          />

          {/* Floating bulk action bar */}
          {isAdmin && selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border shadow-lg rounded-lg px-4 py-3">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" disabled={bulkAssigning}>
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    Assign
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="center" side="top">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Assign to</div>
                  {teamMembers.map(m => (
                    <button
                      key={m.id}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                      onClick={() => handleBulkAssign(m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                  {teamMembers.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-1.5">No team members found</p>
                  )}
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
