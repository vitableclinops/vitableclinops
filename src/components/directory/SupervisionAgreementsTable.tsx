import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, FileText } from 'lucide-react';
import { MEDALLION_STALE_HOURS, agreementTypeLabel, useMedallionDirectoryData } from '@/hooks/useMedallionDirectory';
import { formatRelativeTime } from '@/hooks/useDataFreshness';

/**
 * Every collaborative agreement from Medallion, across all providers.
 * Read-only; our own agreement records are unchanged.
 */
export function SupervisionAgreementsTable() {
  const { data, isLoading, error } = useMedallionDirectoryData(true);
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [type, setType] = useState('all');

  const provName = useMemo(() => {
    const m = new Map<string, string>();
    (data?.providers ?? []).forEach((p) => m.set(p.medallion_id, p.full_name || '—'));
    return m;
  }, [data]);

  const rows = useMemo(() => {
    const all = (data?.agreements ?? []).map((a) => ({ ...a, provider: provName.get(a.medallion_provider_id) ?? '—' }));
    return all
      .filter((a) => state === 'all' || a.state === state)
      .filter((a) => type === 'all' || agreementTypeLabel(a.agreement_type) === type)
      .filter((a) => !q || `${a.provider} ${a.supervisor_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.provider.localeCompare(b.provider) || (a.state ?? '').localeCompare(b.state ?? ''));
  }, [data, provName, q, state, type]);

  const states = [...new Set((data?.agreements ?? []).map((a) => a.state).filter(Boolean) as string[])].sort();
  const counts = (data?.agreements ?? []).reduce<Record<string, number>>((acc, a) => {
    const k = agreementTypeLabel(a.agreement_type); acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});
  const staleCutoff = Date.now() - MEDALLION_STALE_HOURS * 3600_000;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Supervision & collaboration</h2>
        <p className="text-sm text-muted-foreground mt-1">Every collaborative agreement from Medallion, across all providers. Read-only; our own agreement records are unchanged.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{data?.agreements.length ?? 0} agreements</Badge>
        {Object.entries(counts).map(([k, v]) => (
          <Badge key={k} variant={k === 'Unknown' ? 'outline' : 'secondary'}>{k}: {v}</Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search provider or supervisor" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All states</SelectItem>{states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="Primary">Primary</SelectItem>
            <SelectItem value="Backup">Backup</SelectItem>
            <SelectItem value="Unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            : error ? <p className="p-4 text-sm text-destructive">Couldn't load agreements.</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead><TableHead>Supervisor</TableHead><TableHead>State</TableHead>
                    <TableHead>Type</TableHead><TableHead>Medallion status</TableHead><TableHead>Dates</TableHead>
                    <TableHead>Document</TableHead><TableHead>Our record</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => {
                    const stale = a.last_returned_at && new Date(a.last_returned_at).getTime() < staleCutoff;
                    const t = agreementTypeLabel(a.agreement_type);
                    return (
                      <TableRow key={a.medallion_agreement_id}>
                        <TableCell className="font-medium">
                          {a.provider}
                          {stale && <p className="text-xs text-warning flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Stale · last returned {formatRelativeTime(a.last_returned_at!)}</p>}
                        </TableCell>
                        <TableCell>{a.supervisor_name ?? '—'}{a.supervisor_npi && <p className="text-xs text-muted-foreground">NPI {a.supervisor_npi}</p>}</TableCell>
                        <TableCell>{a.state ?? '—'}</TableCell>
                        <TableCell>{t === 'Unknown' ? <Badge variant="outline" title="Medallion did not say primary or backup">Unknown</Badge> : t}</TableCell>
                        <TableCell className="capitalize">{a.source_status ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{a.start_date ?? '?'} → {a.end_date ?? 'open'}</TableCell>
                        <TableCell className="text-xs max-w-[220px]">
                          {a.document_title ? (
                            <span className="flex items-start gap-1" title="The file is stored in Medallion; open it there.">
                              <FileText className="h-3 w-3 mt-0.5 shrink-0" /><span className="break-all">{a.document_title}</span>
                            </span>
                          ) : <span className="text-muted-foreground">None in Medallion</span>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {a.local_agreement_id ? <Link className="text-primary hover:underline" to={`/admin/agreements/${a.local_agreement_id}`}>Open</Link>
                            : a.local_match_notes ? <span className="text-warning">Several matches — review</span>
                            : <span className="text-muted-foreground">No match</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Agreement files live in Medallion; this view shows the file name. Rows Medallion stops returning stay listed and are marked stale rather than removed.</p>
    </div>
  );
}
