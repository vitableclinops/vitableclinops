import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Upload } from 'lucide-react';
import { parseWorkbook, type DryRun, type ParsedWorkbook } from '@/lib/externalImport';
import { applyImport, runDryRun } from '@/hooks/useExternalImport';
import { toast } from 'sonner';

const actionVariant = { add: 'default', update: 'secondary', unchanged: 'outline', blocked: 'destructive' } as const;

export function ExternalImportPanel() {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; parsed: ParsedWorkbook } | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [createProfiles, setCreateProfiles] = useState(false);
  const [filter, setFilter] = useState<'all' | 'attention'>('attention');

  const onFile = async (f: File) => {
    setBusy(true); setDry(null);
    try {
      const parsed = parseWorkbook(await f.arrayBuffer());
      setFile({ name: f.name, parsed });
      setDry(await runDryRun(parsed, f.name));
    } catch (e: any) { toast.error(`Couldn't read file: ${e.message}`); }
    setBusy(false);
  };

  const onImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await applyImport(file.parsed, file.name, createProfiles);
      setDry(res.dry);
      qc.invalidateQueries({ queryKey: ['external-directory'] });
      qc.invalidateQueries({ queryKey: ['pcp-coverage-by-id'] });
      if (res.errors.length) toast.error(`${res.errors.length} rows failed: ${res.errors[0]}`);
      else toast.success(`Imported ${res.written} records${res.profilesCreated ? `, ${res.profilesCreated} new directory records` : ''}.`);
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  const pending = dry ? dry.results.filter((r) => r.action === 'add' || r.action === 'update').length : 0;
  const rows = dry ? dry.results.filter((r) => filter === 'all' || r.action !== 'unchanged' || r.notes.length) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Agency import</h2>
        <p className="text-sm text-muted-foreground mt-1">
          External provider details, licenses and agreements from verified agency workbooks. Uploading shows a preview only — nothing is saved until you press Import.
          Medallion providers are never changed, blank cells never erase information, rows left out of a file are kept, local terminations stay, and coverage states always come from Metabase.
        </p>
      </div>

      <label className="inline-flex">
        <input type="file" accept=".xlsx" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <Button asChild variant="outline" disabled={busy}><span><Upload className="h-4 w-4 mr-2" />{busy ? 'Working…' : 'Upload agency workbook'}</span></Button>
      </label>

      {dry && file && (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Preview: {file.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {dry.headerIssues.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-1">
                  {dry.headerIssues.map((h) => <p key={h} className="flex gap-2"><AlertTriangle className="h-4 w-4 text-warning shrink-0" />{h}</p>)}
                </div>
              )}
              <div className="flex flex-wrap gap-4">
                {(['Providers', 'Addresses', 'Licenses', 'Agreements'] as const).map((s) => {
                  const c = dry.counts[s] ?? { add: 0, update: 0, unchanged: 0, blocked: 0 };
                  return <div key={s}><p className="font-medium">{s}</p><p className="text-muted-foreground">{c.add} new · {c.update} updated · {c.unchanged} unchanged · {c.blocked} blocked</p></div>;
                })}
              </div>
              {dry.results.length === 0 && <p className="text-muted-foreground">No data rows in this file. Headers were checked; nothing to import.</p>}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <label className="flex items-center gap-2"><Checkbox checked={createProfiles} onCheckedChange={(v) => setCreateProfiles(!!v)} />Create directory records for new agency providers with no existing match</label>
                <Button onClick={onImport} disabled={busy || pending === 0}>Import {pending} records</Button>
              </div>
            </CardContent>
          </Card>

          {dry.results.length > 0 && (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <div className="p-3 flex gap-2">
                  <Button size="sm" variant={filter === 'attention' ? 'default' : 'outline'} onClick={() => setFilter('attention')}>Changes & issues</Button>
                  <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All rows</Button>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Sheet / row</TableHead><TableHead>Record</TableHead><TableHead>Result</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={`${r.sheet}-${r.row}-${i}`}>
                        <TableCell className="text-xs whitespace-nowrap">{r.sheet} · {r.row}</TableCell>
                        <TableCell className="font-medium">{r.label}{r.profileLink && <p className="text-xs text-muted-foreground">{r.profileLink.via === 'npi' ? 'Linked to existing record by NPI' : r.profileLink.via === 'existing' ? 'Already linked' : r.profileLink.via === 'new' ? 'No existing record' : 'Not linked'}</p>}</TableCell>
                        <TableCell><Badge variant={actionVariant[r.action]}>{r.action === 'add' ? 'New' : r.action === 'update' ? 'Update' : r.action === 'blocked' ? 'Blocked' : 'Unchanged'}</Badge></TableCell>
                        <TableCell className="text-xs space-y-1 max-w-[520px]">
                          {r.missing.length > 0 && <p className="text-destructive">Missing: {r.missing.join(', ')}</p>}
                          {r.invalid.map((m) => <p key={m} className="text-destructive">{m}</p>)}
                          {r.conflicts.map((m) => <p key={m} className="text-destructive">Identity conflict: {m}</p>)}
                          {r.notes.map((m) => <p key={m} className="text-warning">{m}</p>)}
                          {r.action === 'update' && r.changes.map((c) => <p key={c.field}><span className="font-mono">{c.field}</span>: {c.before ?? '—'} → {c.after}</p>)}
                          {r.action === 'add' && <p className="text-muted-foreground">{r.changes.length} fields</p>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
