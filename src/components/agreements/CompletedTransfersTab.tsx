import { useState, useEffect } from 'react';
import { generateTransferAuditReport } from './TransferAuditReportGenerator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  CheckCircle2,
  Search,
  Users,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Ban,
  FileText,
  Clock,
  Download,
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Transfer = Tables<'agreement_transfers'>;
type Task = Tables<'agreement_tasks'>;

interface TransferWithDetails extends Transfer {
  tasks: Task[];
  providerNames: string[];
}

export function CompletedTransfersTab() {
  const [transfers, setTransfers] = useState<TransferWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCompletedTransfers = async () => {
      const { data: transferData } = await supabase
        .from('agreement_transfers')
        .select('*')
        .in('status', ['completed', 'cancelled'])
        .order('completed_at', { ascending: false });

      if (!transferData || transferData.length === 0) {
        setTransfers([]);
        setLoading(false);
        return;
      }

      // Fetch tasks for all transfers
      const transferIds = transferData.map(t => t.id);
      const { data: tasks } = await supabase
        .from('agreement_tasks')
        .select('*')
        .in('transfer_id', transferIds)
        .order('sort_order', { ascending: true });

      // Fetch provider names
      const allProviderIds = [...new Set(transferData.flatMap(t => t.affected_provider_ids || []))];
      const { data: profiles } = allProviderIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', allProviderIds)
        : { data: [] };
      const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name || 'Unknown']));

      // Fallback from agreement_providers
      const sourceAgreementIds = [...new Set(transferData.map(t => t.source_agreement_id))];
      const { data: apData } = sourceAgreementIds.length > 0
        ? await supabase.from('agreement_providers').select('agreement_id, provider_name').in('agreement_id', sourceAgreementIds)
        : { data: [] };
      const apByAgreement = new Map<string, string[]>();
      (apData || []).forEach(ap => {
        const list = apByAgreement.get(ap.agreement_id) || [];
        list.push(ap.provider_name);
        apByAgreement.set(ap.agreement_id, list);
      });

      const enriched: TransferWithDetails[] = transferData.map(t => ({
        ...t,
        tasks: (tasks || []).filter(tk => tk.transfer_id === t.id),
        providerNames: (() => {
          const fromProfiles = (t.affected_provider_ids || []).map(id => nameMap.get(id)).filter(Boolean) as string[];
          return fromProfiles.length > 0 ? fromProfiles : (apByAgreement.get(t.source_agreement_id) || []);
        })(),
      }));

      setTransfers(enriched);
      setLoading(false);
    };

    fetchCompletedTransfers();
  }, []);

  const filtered = transfers.filter(t => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.state_name.toLowerCase().includes(q) ||
      t.state_abbreviation.toLowerCase().includes(q) ||
      (t.source_physician_name || '').toLowerCase().includes(q) ||
      t.target_physician_name.toLowerCase().includes(q) ||
      t.providerNames.some(n => n.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-16 bg-muted rounded" />
        <div className="h-16 bg-muted rounded" />
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No completed transfers yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Completed Transfers</h3>
          <p className="text-sm text-muted-foreground">
            {transfers.length} transfer{transfers.length !== 1 ? 's' : ''} archived
          </p>
        </div>
        <div className="relative w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search transfers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map(transfer => {
          const isExpanded = expandedId === transfer.id;
          const isCancelled = transfer.status === 'cancelled';
          const terminationTasks = transfer.tasks.filter(t => t.auto_trigger === 'transfer_termination');
          const initiationTasks = transfer.tasks.filter(t => t.auto_trigger === 'transfer_initiation');

          return (
            <Card key={transfer.id} className={isCancelled ? 'border-muted' : ''}>
              <CardHeader
                className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : transfer.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isCancelled ? (
                      <Ban className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    )}
                    <div>
                      <CardTitle className="text-base">
                        {transfer.state_name} ({transfer.state_abbreviation})
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        {transfer.source_physician_name || 'Unknown'}
                        <ArrowRightLeft className="h-3 w-3" />
                        {transfer.target_physician_name}
                        <span className="mx-1">•</span>
                        <Users className="h-3 w-3" />
                        {transfer.providerNames.join(', ') || `${transfer.affected_provider_count} provider(s)`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={isCancelled ? 'secondary' : 'default'} className={!isCancelled ? 'bg-success/10 text-success border-success/20' : ''}>
                      {isCancelled ? 'Cancelled' : 'Completed'}
                    </Badge>
                    {transfer.completed_at && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(transfer.completed_at), 'MMM d, yyyy')}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                  <Separator />

                  {/* Key Dates */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Initiated</p>
                      <p className="font-medium">{format(new Date(transfer.initiated_at), 'MMM d, yyyy')}</p>
                    </div>
                    {transfer.termination_effective_date && (
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs">Termination Date</p>
                        <p className="font-medium">{format(parseLocalDate(transfer.termination_effective_date), 'MMM d, yyyy')}</p>
                      </div>
                    )}
                    {transfer.initiation_effective_date && (
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs">Initiation Date</p>
                        <p className="font-medium">{format(parseLocalDate(transfer.initiation_effective_date), 'MMM d, yyyy')}</p>
                      </div>
                    )}
                    {transfer.completed_at && (
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs">Completed</p>
                        <p className="font-medium">{format(new Date(transfer.completed_at), 'MMM d, yyyy')}</p>
                      </div>
                    )}
                  </div>

                  {/* Phase 1: Termination Tasks */}
                  {terminationTasks.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">Phase 1</Badge>
                        Termination — {transfer.source_physician_name || 'Source'}
                      </h4>
                      <div className="space-y-1">
                        {terminationTasks.map(task => (
                          <div key={task.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/30">
                            {task.status === 'completed' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                            ) : task.status === 'archived' ? (
                              <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className={task.status === 'completed' ? 'text-muted-foreground line-through' : task.status === 'archived' ? 'text-muted-foreground' : ''}>
                              {task.title}
                            </span>
                            {task.completed_at && (
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {format(new Date(task.completed_at), 'MMM d')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Phase 2: Initiation Tasks */}
                  {initiationTasks.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">Phase 2</Badge>
                        Initiation — Dr. {transfer.target_physician_name}
                      </h4>
                      <div className="space-y-1">
                        {initiationTasks.map(task => (
                          <div key={task.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/30">
                            {task.status === 'completed' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                            ) : task.status === 'archived' ? (
                              <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className={task.status === 'completed' ? 'text-muted-foreground line-through' : task.status === 'archived' ? 'text-muted-foreground' : ''}>
                              {task.title}
                            </span>
                            {task.completed_at && (
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {format(new Date(task.completed_at), 'MMM d')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Links to agreements */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/admin/agreements/${transfer.source_agreement_id}`)}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      Source Agreement
                    </Button>
                    {transfer.target_agreement_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/admin/agreements/${transfer.target_agreement_id}`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        New Agreement
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateTransferAuditReport(transfer.id)}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download Audit
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
