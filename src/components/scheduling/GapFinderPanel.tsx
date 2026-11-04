import { useMemo, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { RefreshCw, Download, Plus, Trash2, Sparkles } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { useGapFinder } from '@/hooks/useGapFinder';
import { chicagoDate, coverageBand, hoursClosed, labelOffer, type DailyGap } from '@/lib/gapFinder';
import { downloadCSV, cn } from '@/lib/utils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const bandClass: Record<string, string> = {
  short: 'bg-destructive/15 border-destructive/40 text-destructive',
  tight: 'bg-accent/40 border-accent text-foreground',
  covered: 'bg-primary/15 border-primary/40 text-primary',
  none: 'bg-muted border-border text-muted-foreground',
};

type AiResult = {
  summary: string; total_hours_closed: number; suggestions: string;
  offers: { date: string; start: string; end: string; hours: number; day_gap: number | null; hours_closed: number; verdict: string; note: string }[];
};

type Offer = { id: number; date: string; start: string; end: string };

export function GapFinderPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const { data, isLoading, error } = useGapFinder(month);
  const qc = useQueryClient();
  const { toast } = useToast();

  const refresh = useMutation({
    mutationFn: async () => {
      const [y, m] = month.split('-').map(Number);
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const { error } = await clinopsSupabase.functions.invoke('sync-homebase', { body: { start_date: month, end_date: end } });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gap-finder'] });
      toast({ title: 'Homebase refreshed', description: 'Shifts for this month were pulled again.' });
    },
    onError: (e) => toast({ title: 'Homebase refresh failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const [aiText, setAiText] = useState('');
  const ai = useMutation({
    mutationFn: async (): Promise<AiResult> => {
      const payload = (data?.days ?? []).map((d) => ({ date: d.date, dow: d.dow, scheduled: d.scheduled, expected: d.expected, gap: d.gap, holiday: d.holiday ?? null }));
      const { data: res, error } = await supabase.functions.invoke('gap-offer-ai', { body: { text: aiText, month, days: payload } });
      if (error) {
        let msg = error.message;
        try { msg = (await (error as any).context?.json())?.error ?? msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      if (res?.error) throw new Error(res.error);
      return res as AiResult;
    },
    onError: (e) => toast({ title: 'AI check failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const days = data?.days ?? [];
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const sorted = useMemo(() => [...days].sort((a, b) => b.gap - a.gap), [days]);
  const totalGap = days.reduce((s, d) => s + Math.max(0, d.gap), 0);
  const under90 = days.filter((d) => coverageBand(d.coveragePct) === 'short').length;

  const offerRows = offers.map((o) => {
    const hrs = o.start && o.end ? Math.max(0, (toMin(o.end) - toMin(o.start)) / 60) : 0;
    const day = byDate.get(o.date);
    return { ...o, hrs, day, label: day ? labelOffer(day.gap) : null, closed: day ? hoursClosed(day.gap, hrs) : 0 };
  });
  const offerClosed = offerRows.reduce((s, r) => s + r.closed, 0);

  const firstDow = days[0]?.dow ?? 0;
  const dayShifts = selected ? (data?.shifts ?? []).filter((s) => s.start_at && chicagoDate(s.start_at) === selected) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Month</label>
            <Input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)} className="w-44" />
          </div>
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={cn('h-4 w-4 mr-2', refresh.isPending && 'animate-spin')} />Refresh from Homebase
          </Button>
          <Button variant="outline" disabled={!days.length} onClick={() => downloadCSV(sorted.map(toCsv), `gap-finder-${month.slice(0, 7)}.csv`)}>
            <Download className="h-4 w-4 mr-2" />CSV
          </Button>
          <p className="text-xs text-muted-foreground ml-auto max-w-md">
            Whole network, telemedicine only (NP + MD telemedicine shifts). Expected hours = monthly demand target split by each weekday's usual share of the last 12 weeks.
            {data?.lastSync && <> Last Homebase pull: {new Date(data.lastSync).toLocaleString()}.</>}
          </p>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">Could not load: {(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && !data.hasTargets && <p className="text-sm text-destructive">No demand targets exist for this month yet, so expected hours are 0.</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Total gap hours" value={totalGap.toFixed(1)} />
            <Stat label="Days under 90% coverage" value={String(under90)} />
            <Card><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Biggest gap days</p>
              <ul className="text-sm mt-1">
                {sorted.filter((d) => d.gap > 0).slice(0, 5).map((d) => (
                  <li key={d.date}>{DOW[d.dow]} {d.date.slice(5)} — {d.gap} hrs short</li>
                ))}
              </ul>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Coverage calendar</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 text-xs">
                {DOW.map((d) => <div key={d} className="text-center text-muted-foreground font-medium">{d}</div>)}
                {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                {days.map((d) => (
                  <button key={d.date} onClick={() => setSelected(d.date === selected ? null : d.date)}
                    className={cn('rounded border p-1.5 text-left min-h-16', bandClass[coverageBand(d.coveragePct)], selected === d.date && 'ring-2 ring-ring')}>
                    <div className="font-semibold">{Number(d.date.slice(8))}</div>
                    <div>{d.coveragePct ?? '–'}%</div>
                    <div className="opacity-80">{d.scheduled}/{d.expected}h</div>
                    {d.holiday && <div className="truncate">{d.holiday}</div>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Red under 90%, yellow 90–100%, green over 100%. Click a day for its shifts.</p>
              {selected && (
                <div className="mt-3 border rounded p-3">
                  <p className="font-medium text-sm mb-2">{selected} — {dayShifts.length} shifts</p>
                  <ul className="text-sm space-y-0.5 max-h-60 overflow-y-auto">
                    {dayShifts.map((s) => (
                      <li key={s.id}>{s.employee_name || 'Unmatched'} · {s.role} · {fmtTime(s.start_at)}–{fmtTime(s.end_at)} ({s.scheduled_hours}h)</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Provider offer check</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Paste what the provider is offering (an email, text, or list) and AI will check it against this month's gaps. Nothing is written to Homebase.</p>
              <Textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={4}
                placeholder={'e.g. "I can do Nov 12 9am-1pm, every Tuesday 2-6pm, and Nov 28 all day"'} />
              <Button size="sm" onClick={() => ai.mutate()} disabled={!aiText.trim() || ai.isPending || !days.length}>
                <Sparkles className={cn('h-4 w-4 mr-1', ai.isPending && 'animate-pulse')} />{ai.isPending ? 'Checking…' : 'Check with AI'}
              </Button>
              {ai.data && (
                <div className="border rounded p-3 space-y-2 text-sm">
                  <p>{ai.data.summary}</p>
                  <p>Closes <strong>{Number(ai.data.total_hours_closed).toFixed(1)}</strong> gap hours.</p>
                  {ai.data.offers.length > 0 && (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead className="text-right">Hrs</TableHead>
                        <TableHead className="text-right">Day gap</TableHead><TableHead>Verdict</TableHead><TableHead>Note</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {ai.data.offers.map((o, i) => (
                          <TableRow key={i}>
                            <TableCell>{o.date}</TableCell><TableCell>{o.start}–{o.end}</TableCell>
                            <TableCell className="text-right">{o.hours}</TableCell>
                            <TableCell className="text-right">{o.day_gap ?? '–'}</TableCell>
                            <TableCell><Badge variant={o.verdict === 'Fills a gap' ? 'default' : o.verdict === 'Marginal' ? 'secondary' : 'outline'}>{o.verdict}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{o.note}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {ai.data.suggestions && <p className="text-muted-foreground">{ai.data.suggestions}</p>}
                  <p className="text-xs text-muted-foreground">AI reading — double-check dates before offering shifts.</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-2">Or enter shifts manually:</p>
              {offerRows.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2">
                  <Input type="date" value={o.date} onChange={(e) => update(o.id, { date: e.target.value })} className="w-40" />
                  <Input type="time" value={o.start} onChange={(e) => update(o.id, { start: e.target.value })} className="w-32" />
                  <Input type="time" value={o.end} onChange={(e) => update(o.id, { end: e.target.value })} className="w-32" />
                  <span className="text-sm w-14">{o.hrs.toFixed(1)}h</span>
                  {o.label ? (
                    <Badge variant={o.label === 'Fills a gap' ? 'default' : o.label === 'Marginal' ? 'secondary' : 'outline'}>{o.label}</Badge>
                  ) : o.date ? <span className="text-xs text-muted-foreground">Outside selected month</span> : null}
                  {o.day && <span className="text-xs text-muted-foreground">day gap {o.day.gap}h</span>}
                  <Button size="icon" variant="ghost" onClick={() => setOffers((x) => x.filter((y) => y.id !== o.id))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => setOffers((x) => [...x, { id: Date.now(), date: '', start: '09:00', end: '13:00' }])}>
                  <Plus className="h-4 w-4 mr-1" />Add offered shift
                </Button>
                {offers.length > 0 && <span className="text-sm">This offer closes <strong>{offerClosed.toFixed(1)}</strong> gap hours.</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Days by gap</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Day</TableHead><TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Gap</TableHead><TableHead className="text-right">Coverage</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {sorted.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>{d.date}{d.holiday && <span className="text-xs text-muted-foreground"> · {d.holiday}</span>}</TableCell>
                      <TableCell>{DOW[d.dow]}</TableCell>
                      <TableCell className="text-right">{d.scheduled}</TableCell>
                      <TableCell className="text-right">{d.expected}</TableCell>
                      <TableCell className={cn('text-right font-medium', d.gap > 0 && 'text-destructive')}>{d.gap}</TableCell>
                      <TableCell className="text-right">{d.coveragePct ?? '–'}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );

  function update(id: number, patch: Partial<Offer>) {
    setOffers((x) => x.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>;
}
function toMin(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '';
}
function toCsv(d: DailyGap) {
  return { date: d.date, day: DOW[d.dow], scheduled_hours: d.scheduled, expected_hours: d.expected, gap_hours: d.gap, coverage_pct: d.coveragePct ?? '', holiday: d.holiday ?? '' };
}
