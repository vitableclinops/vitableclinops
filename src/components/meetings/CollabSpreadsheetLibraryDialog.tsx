import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  COLLAB_SPREADSHEET_LIBRARY_KEY,
  MONTH_NAMES,
  mergeLibraryDefaults,
  normalizeLibraryRow,
  parseSpreadsheetId,
  type LibrarySpreadsheet,
} from '@/lib/collabSpreadsheetLibrary';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CollabSpreadsheetLibraryDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<LibrarySpreadsheet[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['system-config', COLLAB_SPREADSHEET_LIBRARY_KEY],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', COLLAB_SPREADSHEET_LIBRARY_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value as any)?.spreadsheets as LibrarySpreadsheet[] | undefined;
    },
  });

  useEffect(() => {
    if (open && !isLoading) setRows(mergeLibraryDefaults(data));
  }, [open, isLoading, data]);

  const updateRow = (id: string, patch: Partial<LibrarySpreadsheet>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const setTabUrl = (id: string, month: string, url: string) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const tabs = r.tabs.filter((t) => t.month !== month);
        if (url.trim()) tabs.push({ month, url });
        return { ...r, tabs };
      }),
    );

  const tabUrl = (r: LibrarySpreadsheet, month: string) => r.tabs.find((t) => t.month === month)?.url || '';

  const addRow = () =>
    setRows((rs) => [...rs, { id: `new-${Date.now()}`, url: '', title: '', states: [], tabs: [] }]);

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = rows
        .map((r) => ({ ...r, id: parseSpreadsheetId(r.url) || r.id }))
        .filter((r) => r.url.trim())
        .map(normalizeLibraryRow);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: existing } = await supabase
        .from('system_config')
        .select('id')
        .eq('key', COLLAB_SPREADSHEET_LIBRARY_KEY)
        .maybeSingle();
      const payload = {
        value: { spreadsheets: cleaned },
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = existing
        ? await supabase.from('system_config').update(payload).eq('key', COLLAB_SPREADSHEET_LIBRARY_KEY)
        : await supabase.from('system_config').insert({
            key: COLLAB_SPREADSHEET_LIBRARY_KEY,
            description: 'Collab chart spreadsheet library (shared across providers)',
            ...payload,
          });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      toast({ title: 'Spreadsheet library saved' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save the library.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Chart spreadsheet library</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Register each chart spreadsheet once with the states it covers and a direct link to each month's tab.
          Meetings then link the right month's tab automatically per provider.
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid gap-2 sm:grid-cols-2 flex-1">
                    <div className="space-y-1">
                      <Label>Title</Label>
                      <Input
                        value={r.title}
                        onChange={(e) => updateRow(r.id, { title: e.target.value })}
                        placeholder="e.g. PA/NJ collab charts"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>States (comma-separated)</Label>
                      <Input
                        value={r.states.join(', ')}
                        onChange={(e) =>
                          updateRow(r.id, { states: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })
                        }
                        placeholder="e.g. PA, NJ"
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive mt-5"
                    onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    aria-label="Remove spreadsheet"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label>Spreadsheet link</Label>
                  <Input
                    value={r.url}
                    onChange={(e) => updateRow(r.id, { url: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  {expanded === r.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Monthly tab links ({r.tabs.length}/12 set)
                </button>
                {expanded === r.id && (
                  <div className="grid gap-2 sm:grid-cols-2 pl-4">
                    {MONTH_NAMES.map((m) => (
                      <div key={m} className="space-y-1">
                        <Label className="text-xs">{m}</Label>
                        <Input
                          value={tabUrl(r, m)}
                          onChange={(e) => setTabUrl(r.id, m, e.target.value)}
                          placeholder="Tab link (optional)"
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4 mr-2" /> Add spreadsheet
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || isLoading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save library'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
