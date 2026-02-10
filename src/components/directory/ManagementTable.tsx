import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Search, Shield, AlertTriangle, Clock, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, MinusCircle, ArrowRight, CalendarDays,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProviderReadiness, StateReadiness, ChecklistItem } from '@/hooks/useProviderReadiness';
import { ProviderClassificationBadge } from '@/components/ProviderClassificationBadge';

type ManagementFilter = 'all' | 'ready' | 'blocked' | 'in_progress' | 'blocked_license' | 'blocked_collab' | 'active_non_compliant' | 'expiring_30' | 'needs_action';

interface ManagementTableProps {
  providers: ProviderReadiness[];
  agencyMap: Map<string, string>;
  initialSearch?: string;
}

const filterConfig: { value: ManagementFilter; label: string; icon: React.ReactNode; variant: string }[] = [
  { value: 'all', label: 'All', icon: null, variant: '' },
  { value: 'needs_action', label: 'Needs Action', icon: <Activity className="h-3.5 w-3.5" />, variant: 'text-primary border-primary/30 hover:bg-primary/10' },
  { value: 'blocked', label: 'Blocked', icon: <AlertTriangle className="h-3.5 w-3.5" />, variant: 'text-destructive border-destructive/30 hover:bg-destructive/10' },
  { value: 'in_progress', label: 'In Progress', icon: <Clock className="h-3.5 w-3.5" />, variant: 'text-warning border-warning/30 hover:bg-warning/10' },
  { value: 'ready', label: 'Ready', icon: <Shield className="h-3.5 w-3.5" />, variant: 'text-success border-success/30 hover:bg-success/10' },
  { value: 'expiring_30', label: 'Expiring Soon', icon: <CalendarDays className="h-3.5 w-3.5" />, variant: 'text-warning border-warning/30 hover:bg-warning/10' },
];

export function ManagementTable({ providers, agencyMap, initialSearch = '' }: ManagementTableProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<ManagementFilter>(initialSearch ? 'all' : 'needs_action');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = providers;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.provider_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.npi_number || '').includes(q)
      );
    }

    // Filter
    switch (filter) {
      case 'ready':
        list = list.filter(p => p.overall_status === 'ready');
        break;
      case 'blocked':
        list = list.filter(p => p.overall_status === 'blocked');
        break;
      case 'in_progress':
        list = list.filter(p => p.overall_status === 'in_progress');
        break;
      case 'blocked_license':
        list = list.filter(p => p.blocker_reasons.some(r => r.toLowerCase().includes('license')));
        break;
      case 'blocked_collab':
        list = list.filter(p => p.blocker_reasons.some(r => r.toLowerCase().includes('collab') || r.toLowerCase().includes('agreement')));
        break;
      case 'active_non_compliant':
        list = list.filter(p => p.states.some(s => s.ehr_approved && s.computed_status === 'blocked'));
        break;
      case 'expiring_30':
        list = list.filter(p => p.expiring_soon);
        break;
      case 'needs_action':
        list = list.filter(p => p.next_action && p.next_action.type !== 'mark_ready');
        break;
    }

    return list;
  }, [providers, search, filter]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  const statusCounts = useMemo(() => ({
    ready: providers.filter(p => p.overall_status === 'ready').length,
    in_progress: providers.filter(p => p.overall_status === 'in_progress').length,
    blocked: providers.filter(p => p.overall_status === 'blocked').length,
  }), [providers]);

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex items-center gap-3 text-sm">
        <Badge variant="outline" className="gap-1 bg-success/5 text-success border-success/20">
          <CheckCircle2 className="h-3 w-3" /> {statusCounts.ready} Ready
        </Badge>
        <Badge variant="outline" className="gap-1 bg-warning/5 text-warning border-warning/20">
          <Clock className="h-3 w-3" /> {statusCounts.in_progress} In Progress
        </Badge>
        <Badge variant="outline" className="gap-1 bg-destructive/5 text-destructive border-destructive/20">
          <AlertTriangle className="h-3 w-3" /> {statusCounts.blocked} Blocked
        </Badge>
      </div>

      {/* Search + Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search providers..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {filterConfig.map(f => (
                <Button
                  key={f.value}
                  variant={filter === f.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f.value)}
                  className={cn('h-7 text-xs gap-1', filter !== f.value && f.variant)}
                >
                  {f.icon}
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-8" />
                <TableHead className="min-w-[220px]">Provider</TableHead>
                <TableHead>Employment</TableHead>
                <TableHead>States</TableHead>
                <TableHead className="min-w-[180px]">Readiness</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-[160px]">Next Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    No providers match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(provider => (
                  <ProviderRow
                    key={provider.provider_id}
                    provider={provider}
                    expanded={expandedRows.has(provider.provider_id)}
                    onToggle={() => toggleRow(provider.provider_id)}
                    getInitials={getInitials}
                    agencyMap={agencyMap}
                    navigate={navigate}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderRow({
  provider,
  expanded,
  onToggle,
  getInitials,
  agencyMap,
  navigate,
}: {
  provider: ProviderReadiness;
  expanded: boolean;
  onToggle: () => void;
  getInitials: (name: string) => string;
  agencyMap: Map<string, string>;
  navigate: (path: string) => void;
}) {
  const progressPct = provider.checklist_total > 0 ? Math.round((provider.checklist_complete / provider.checklist_total) * 100) : 0;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <TableCell className="w-8 pr-0">
          {provider.states.length > 0 ? (
            expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : null}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={provider.avatar_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {getInitials(provider.provider_name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <span className="font-medium text-sm">{provider.provider_name}</span>
              <p className="text-xs text-muted-foreground">{provider.credentials || provider.profession || ''}</p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <ProviderClassificationBadge employmentType={provider.employment_type} compact />
          {provider.employment_type === 'agency' && provider.agency_id && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[120px]">{agencyMap.get(provider.agency_id) || ''}</p>
          )}
        </TableCell>
        <TableCell>
          <div className="flex gap-1 flex-wrap">
            {provider.states.slice(0, 5).map(s => (
              <Badge
                key={s.state_abbreviation}
                variant="outline"
                className={cn('text-[11px] px-1.5 py-0',
                  s.computed_status === 'ready' && 'bg-success/10 text-success border-success/20',
                  s.computed_status === 'blocked' && 'bg-destructive/10 text-destructive border-destructive/20',
                  s.computed_status === 'in_progress' && 'bg-warning/10 text-warning border-warning/20',
                )}
              >
                {s.state_abbreviation}
              </Badge>
            ))}
            {provider.states.length > 5 && <span className="text-xs text-muted-foreground">+{provider.states.length - 5}</span>}
            {provider.states.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </TableCell>
        <TableCell>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 min-w-[140px]">
                  <Progress value={progressPct} className="h-2 flex-1" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {provider.checklist_complete}/{provider.checklist_total}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <ChecklistSummaryTooltip provider={provider} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
        <TableCell>
          <StatusBadge status={provider.overall_status} />
        </TableCell>
        <TableCell onClick={e => e.stopPropagation()}>
          {provider.next_action && provider.next_action.type !== 'mark_ready' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => {
                if (provider.next_action?.route) navigate(provider.next_action.route);
              }}
            >
              {provider.next_action.label}
              <ArrowRight className="h-3 w-3" />
            </Button>
          ) : provider.next_action?.type === 'mark_ready' ? (
            <Badge variant="outline" className="bg-success/5 text-success border-success/20 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              All Ready
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded state drawer */}
      {expanded && provider.states.length > 0 && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="p-0">
            <div className="px-6 py-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Per-State Readiness</p>
              <div className="grid gap-3">
                {provider.states.map(state => (
                  <StateReadinessRow key={state.state_abbreviation} state={state} navigate={navigate} />
                ))}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function StateReadinessRow({ state, navigate }: { state: StateReadiness; navigate: (path: string) => void }) {
  const required = state.checklist.filter(c => c.status !== 'not_required');
  const complete = required.filter(c => c.status === 'complete').length;
  const total = required.length;

  return (
    <div className="flex items-start gap-4 p-3 rounded-lg border bg-background">
      <div className="flex items-center gap-2 min-w-[60px]">
        <Badge
          variant="outline"
          className={cn('text-xs font-semibold cursor-pointer hover:underline',
            state.computed_status === 'ready' && 'bg-success/10 text-success border-success/20',
            state.computed_status === 'blocked' && 'bg-destructive/10 text-destructive border-destructive/20',
            state.computed_status === 'in_progress' && 'bg-warning/10 text-warning border-warning/20',
          )}
          onClick={() => navigate(`/states/${state.state_abbreviation}`)}
        >
          {state.state_abbreviation}
        </Badge>
      </div>
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">License</span>
          <div className="flex items-center gap-1 mt-0.5">
            <ChecklistIcon status={state.license_verified ? (state.license_expiration && state.license_expiration < new Date().toISOString().split('T')[0] ? 'expired' : 'complete') : 'incomplete'} />
            <span>{state.license_status || 'None'}{state.license_expiration ? ` • ${state.license_expiration}` : ''}</span>
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Collab Required</span>
          <div className="mt-0.5">{state.collab_required ? 'Yes' : 'No'}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Collab Status</span>
          <div className="flex items-center gap-1 mt-0.5">
            {state.collab_required ? (
              <>
                <ChecklistIcon status={state.collab_status === 'active' ? 'complete' : state.collab_status === 'expired' ? 'expired' : 'incomplete'} />
                <span className="capitalize">{state.collab_status || 'None'}</span>
              </>
            ) : <span className="text-muted-foreground">N/A</span>}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">EHR Activation</span>
          <div className="flex items-center gap-1 mt-0.5">
            <ChecklistIcon status={state.ehr_approved ? 'complete' : 'incomplete'} />
            <span className="capitalize">{state.ehr_activation_status || 'Inactive'}</span>
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Meeting</span>
          <div className="flex items-center gap-1 mt-0.5">
            {state.collab_required ? (
              <>
                <ChecklistIcon status={state.meeting_scheduled ? 'complete' : 'incomplete'} />
                <span>{state.next_meeting_date || 'None'}</span>
              </>
            ) : <span className="text-muted-foreground">N/A</span>}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Checklist</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Progress value={total > 0 ? (complete / total) * 100 : 0} className="h-1.5 w-16" />
            <span>{complete}/{total}</span>
          </div>
        </div>
      </div>
      {state.blocker_reason && (
        <Badge variant="outline" className="text-[10px] bg-destructive/5 text-destructive border-destructive/20 shrink-0">
          {state.blocker_reason}
        </Badge>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'ready' | 'in_progress' | 'blocked' }) {
  switch (status) {
    case 'ready':
      return (
        <Badge className="bg-success/10 text-success border-success/20 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </Badge>
      );
    case 'blocked':
      return (
        <Badge className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
          <AlertTriangle className="h-3 w-3" /> Blocked
        </Badge>
      );
    default:
      return (
        <Badge className="bg-warning/10 text-warning border-warning/20 gap-1">
          <Clock className="h-3 w-3" /> In Progress
        </Badge>
      );
  }
}

function ChecklistIcon({ status }: { status: ChecklistItem['status'] }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />;
    case 'expired':
      return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    case 'not_required':
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/40 shrink-0" />;
  }
}

function ChecklistSummaryTooltip({ provider }: { provider: ProviderReadiness }) {
  // Aggregate all checklist items across states
  const allItems = provider.states.flatMap(s => s.checklist.filter(c => c.status !== 'not_required'));
  const grouped = new Map<string, { complete: number; total: number }>();
  allItems.forEach(item => {
    const existing = grouped.get(item.key) || { complete: 0, total: 0 };
    existing.total++;
    if (item.status === 'complete') existing.complete++;
    grouped.set(item.key, existing);
  });

  const labels: Record<string, string> = {
    license_verified: 'License Verified',
    collab_required: 'Collab Agreement',
    collab_signed: 'Agreement Signed',
    meeting_scheduled: 'Meeting Scheduled',
    chart_review: 'Chart Review',
    ehr_activation: 'EHR Activation',
  };

  return (
    <div className="space-y-1 text-xs">
      <p className="font-semibold mb-1">Readiness Checklist</p>
      {Array.from(grouped.entries()).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <ChecklistIcon status={val.complete === val.total ? 'complete' : 'incomplete'} />
          <span>{labels[key] || key}</span>
          <span className="text-muted-foreground ml-auto">{val.complete}/{val.total}</span>
        </div>
      ))}
    </div>
  );
}
