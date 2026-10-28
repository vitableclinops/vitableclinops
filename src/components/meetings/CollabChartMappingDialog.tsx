import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
import { useUpdateSystemConfig } from '@/hooks/useSystemConfig';
import { COLLAB_CHART_CONFIG_KEY, CollabChartMapping, isSpreadsheetUrl } from '@/lib/collabChartMapping';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; rows: CollabChartMapping[] }

export function CollabChartMappingDialog({ open, onOpenChange, rows }: Props) {
  const [draft, setDraft] = useState<CollabChartMapping[]>([]);
  const [error, setError] = useState('');
  const save = useUpdateSystemConfig();
  useEffect(() => { if (open) { setDraft(rows.map(row => ({ ...row }))); setError(''); } }, [open, rows]);
  const update = (id: string, key: keyof CollabChartMapping, value: string) => {
    setDraft(previous => previous.map(row => row.id === id ? { ...row, [key]: value } : row));
  };
  const submit = async () => {
    const normalized = draft.map(row => ({ ...row, title: row.title.trim(), state: row.state.trim().toUpperCase(), tabUrl: row.tabUrl.trim(), spreadsheetUrl: row.spreadsheetUrl.trim() }));
    const invalid = normalized.find(row => !isSpreadsheetUrl(row.spreadsheetUrl) || (row.tabUrl && (!isSpreadsheetUrl(row.tabUrl) || !/^[A-Z]{2}$/.test(row.state) || !/^\d{4}-\d{2}$/.test(row.month) || !row.title)));
    if (invalid) { setError('Each completed tab needs a title, two-letter state, month, and Google Sheets link.'); return; }
    try {
      await save.mutateAsync({ key: COLLAB_CHART_CONFIG_KEY, value: { rows: normalized }, description: 'Collaborative meeting chart spreadsheet tabs by state and month' });
      onOpenChange(false);
    } catch { /* Mutation displays the save error; keep edits open. */ }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
      <DialogHeader><DialogTitle>Chart spreadsheet mapping</DialogTitle></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-2">
        {draft.map((row, index) => <fieldset key={row.id} className="border-b pb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <legend className="font-medium text-sm">{row.title || `Spreadsheet ${index + 1}`}</legend>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" title="Open spreadsheet" aria-label={`Open spreadsheet ${index + 1}`} disabled={!isSpreadsheetUrl(row.spreadsheetUrl)} onClick={() => window.open(row.spreadsheetUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Add another tab" aria-label={`Add another tab for spreadsheet ${index + 1}`} onClick={() => setDraft(previous => [...previous, { ...row, id: crypto.randomUUID(), month: '', tabUrl: '' }])}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Remove mapping" aria-label={`Remove mapping ${index + 1}`} onClick={() => setDraft(previous => previous.filter(item => item.id !== row.id))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_90px_160px]">
            <div><Label htmlFor={`title-${row.id}`}>Spreadsheet title</Label><Input id={`title-${row.id}`} value={row.title} onChange={e => update(row.id, 'title', e.target.value)} /></div>
            <div><Label htmlFor={`state-${row.id}`}>State</Label><Input id={`state-${row.id}`} maxLength={2} placeholder="CA" value={row.state} onChange={e => update(row.id, 'state', e.target.value.toUpperCase())} /></div>
            <div><Label htmlFor={`month-${row.id}`}>Month</Label><Input id={`month-${row.id}`} type="month" value={row.month} onChange={e => update(row.id, 'month', e.target.value)} /></div>
          </div>
          <div><Label htmlFor={`sheet-${row.id}`}>Spreadsheet link</Label><Input id={`sheet-${row.id}`} type="url" value={row.spreadsheetUrl} onChange={e => update(row.id, 'spreadsheetUrl', e.target.value)} /></div>
          <div><Label htmlFor={`tab-${row.id}`}>Tab link</Label><Input id={`tab-${row.id}`} type="url" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…" value={row.tabUrl} onChange={e => update(row.id, 'tabUrl', e.target.value)} /></div>
        </fieldset>)}
        <Button variant="outline" onClick={() => setDraft(previous => [...previous, { id: crypto.randomUUID(), title: '', state: '', month: '', tabUrl: '', spreadsheetUrl: '' }])}><Plus className="h-4 w-4 mr-2" />Add mapping</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save mapping</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}