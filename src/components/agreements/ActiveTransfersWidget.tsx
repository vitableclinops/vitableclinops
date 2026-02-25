import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRightLeft, ChevronRight, Users, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import type { Tables } from '@/integrations/supabase/types';

type Transfer = Tables<'agreement_transfers'>;

interface TransferWithTaskCounts extends Transfer {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  unassignedTasks: number;
  providerNames: string[];
}

export function ActiveTransfersWidget() {
  const [transfers, setTransfers] = useState<TransferWithTaskCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTransfers = async () => {
      const { data: transferData } = await supabase
        .from('agreement_transfers')
        .select('*')
        .in('status', ['pending', 'in_progress'])
        .order('created_at', { ascending: false });

      if (!transferData || transferData.length === 0) {
        setTransfers([]);
        setLoading(false);
        return;
      }

      // Fetch task counts for each transfer
      const transferIds = transferData.map(t => t.id);
      const { data: tasks } = await supabase
        .from('agreement_tasks')
        .select('id, transfer_id, status, assigned_to, is_required')
        .in('transfer_id', transferIds);

      // Fetch provider names
      const allProviderIds = [...new Set(transferData.flatMap(t => t.affected_provider_ids || []))];
      const { data: profiles } = allProviderIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', allProviderIds)
        : { data: [] };
      const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name || 'Unknown']));

      // Fallback: fetch from agreement_providers for transfers where profiles didn't match
      const sourceAgreementIds = [...new Set(transferData.map(t => t.source_agreement_id))];
      const { data: apData } = sourceAgreementIds.length > 0
        ? await supabase.from('agreement_providers').select('agreement_id, provider_name').in('agreement_id', sourceAgreementIds).eq('is_active', true)
        : { data: [] };
      const apByAgreement = new Map<string, string[]>();
      (apData || []).forEach(ap => {
        const list = apByAgreement.get(ap.agreement_id) || [];
        list.push(ap.provider_name);
        apByAgreement.set(ap.agreement_id, list);
      });

      const enriched: TransferWithTaskCounts[] = transferData.map(t => {
        const tTasks = (tasks || []).filter(tk => tk.transfer_id === t.id);
        return {
          ...t,
          totalTasks: tTasks.length,
          completedTasks: tTasks.filter(tk => tk.status === 'completed').length,
          blockedTasks: tTasks.filter(tk => tk.status === 'blocked' || tk.status === 'waiting_on_signature').length,
          unassignedTasks: tTasks.filter(tk => !tk.assigned_to && tk.status !== 'completed').length,
          providerNames: (() => {
            const fromProfiles = (t.affected_provider_ids || []).map(id => nameMap.get(id)).filter(Boolean) as string[];
            return fromProfiles.length > 0 ? fromProfiles : (apByAgreement.get(t.source_agreement_id) || []);
          })(),
        };
      });

      setTransfers(enriched);
      setLoading(false);
    };

    fetchTransfers();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Active Transfers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (transfers.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Active Transfers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No active transfers right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Active Transfers
          </CardTitle>
          <Badge variant="secondary">{transfers.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {transfers.map(transfer => {
          const progress = transfer.totalTasks > 0 
            ? (transfer.completedTasks / transfer.totalTasks) * 100 
            : 0;

          return (
            <div
              key={transfer.id}
              className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer group"
              onClick={() => navigate('/admin/agreements?tab=transfers')}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{transfer.state_name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {transfer.status}
                  </Badge>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                {transfer.source_physician_name || 'Unassigned'}
                <ArrowRightLeft className="h-3 w-3 inline" />
                {transfer.target_physician_name}
                <span className="mx-1">•</span>
                <Users className="h-3 w-3 inline" />
                {transfer.providerNames.length > 0 ? transfer.providerNames.join(', ') : `${transfer.affected_provider_count} provider(s)`}
              </p>

              <Progress value={progress} className="h-1.5 mb-2" />

              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  {transfer.completedTasks}/{transfer.totalTasks}
                </span>
                {transfer.blockedTasks > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    {transfer.blockedTasks} blocked
                  </span>
                )}
                {transfer.unassignedTasks > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {transfer.unassignedTasks} unassigned
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full text-xs"
          onClick={() => navigate('/admin/agreements?tab=transfers')}
        >
          View all transfers
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
