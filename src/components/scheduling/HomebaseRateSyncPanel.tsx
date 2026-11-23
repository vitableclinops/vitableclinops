import { RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useHomebaseRateSync } from '@/hooks/useHomebaseRateSync';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const money = (value: number | null) => value === null ? 'Not recorded' : `$${value.toFixed(2)}/hr`;
export function HomebaseRateSyncPanel() {
  const { hasRole } = useAuth();
  const allowed = hasRole('admin');
  const { status, sync } = useHomebaseRateSync(allowed);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  const rows = status.data?.rows ?? [];
  const review = rows.filter(row => row.status !== 'unchanged');
  const differences = rows.filter(row => row.previous_rate !== null && row.homebase_rate !== null && row.previous_rate !== row.homebase_rate);
  return (
    <section className="space-y-3 border-b pb-4" aria-label="Homebase pay rates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Homebase pay rates</h3>
          <p className="text-xs text-muted-foreground">
            {status.data?.synced_at ? `Last synced ${new Date(status.data.synced_at).toLocaleString()}` : 'Not synced yet'}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate(undefined, {
          onSuccess: data => {
            setOpen(true);
            toast.success(`Homebase rates synced: ${(data.counters?.updated ?? 0) + (data.counters?.inserted ?? 0)} changed`);
          },
          onError: error => toast.error(error.message),
        })}>
          {sync.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync Homebase rates
        </Button>
      </div>
      {(status.error || sync.error) && <Alert variant="destructive"><AlertDescription>{(sync.error ?? status.error)?.message}</AlertDescription></Alert>}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto max-w-full whitespace-normal text-left">
            <ChevronDown className="mr-2 h-4 w-4 shrink-0" />
            {differences.length} rate differences · {status.data?.counters?.preserved ?? 0} exceptions retained
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          {status.isLoading ? <p className="text-sm text-muted-foreground">Loading rates…</p> : review.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Saved before sync</TableHead><TableHead>Homebase hourly</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>{review.map(row => <TableRow key={row.provider_id}>
                  <TableCell className="font-medium">{row.provider}</TableCell>
                  <TableCell className="whitespace-nowrap">{money(row.previous_rate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{money(row.homebase_rate)}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">{status.data?.synced_at ? 'All available hourly rates match.' : 'No sync results yet.'}</p>}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}