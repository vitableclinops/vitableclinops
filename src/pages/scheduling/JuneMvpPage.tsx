import { useCallback, useEffect, useMemo, useState } from 'react';
import SchedulingShell from './SchedulingShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  CircleX,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseDemandCsv } from '@/lib/juneSchedule/parseDemand';
import { parseLicensesCsv } from '@/lib/juneSchedule/parseLicenses';
import { parseEhrCoverageCsv } from '@/lib/juneSchedule/parseEhrCoverage';
import { parseSupervisionXlsx } from '@/lib/juneSchedule/parseSupervisionXlsx';
import { parseJotformCsv, buildShiftCandidates } from '@/lib/juneSchedule/parseJotform';
import { allocate, mergeProviders } from '@/lib/juneSchedule/allocator';
import type { AllocatedShift, AllocationResult, DemandRow, ProviderInfo } from '@/lib/juneSchedule/types';
import { fmtMin } from '@/lib/juneSchedule/businessHours';
import { useJunePublishLocal } from '@/hooks/useJunePublishLocal';

const TARGET_MONTH = '2026-06-01';

type SlotKey = 'demand' | 'licenses' | 'supervision' | 'ehr' | 'jotform';

const SLOT_DEFS: Array<{ key: SlotKey; label: string; accept: string; hint: string }> = [
  { key: 'demand', label: '1. Demand by state', accept: '.csv', hint: 'CSV — State + Adjusted Monthly Hours' },
  { key: 'licenses', label: '2. Medallion licenses', accept: '.csv', hint: 'Medallion CSV export' },
  { key: 'supervision', label: '3. Supervision matrix', accept: '.xlsx,.xls', hint: 'DirectShifts XLSX' },
  { key: 'ehr', label: '4. EHR state coverage', accept: '.csv', hint: 'PCP coverage CSV' },
  { key: 'jotform', label: '5. Jotform availability', accept: '.csv', hint: 'Jotform monthly availability CSV' },
];

interface SlotData {
  fileName: string;
  parsedCount: number;
  payload: unknown;
}

const REASON_LABELS: Record<string, string> = {
  outside_business_hours: 'Outside business hours',
  state_capacity_full: 'State capacity full',
  provider_unlicensed_in_needed_states: 'No eligible state',
  np_state_restricted: 'NP-restricted state',
  date_blackout: 'Provider blackout',
  invalid_time: 'Invalid time entry',
};

export default function JuneMvpPage() {
  const [slots, setSlots] = useState<Partial<Record<SlotKey, SlotData>>>({});
  const [parsing, setParsing] = useState<SlotKey | null>(null);
  const [filter, setFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(true);
  const [computed, setComputed] = useState(false);
  const publish = useJunePublishLocal(TARGET_MONTH);

  const handleFile = useCallback(async (key: SlotKey, file: File) => {
    setParsing(key);
    try {
      let parsed: SlotData;
      if (key === 'supervision') {
        const buf = await file.arrayBuffer();
        const rows = parseSupervisionXlsx(buf);
        parsed = { fileName: file.name, parsedCount: rows.length, payload: rows };
      } else {
        const text = await file.text();
        if (key === 'demand') {
          const rows = parseDemandCsv(text);
          parsed = { fileName: file.name, parsedCount: rows.length, payload: rows };
        } else if (key === 'licenses') {
          const rows = parseLicensesCsv(text);
          parsed = { fileName: file.name, parsedCount: rows.length, payload: rows };
        } else if (key === 'ehr') {
          const rows = parseEhrCoverageCsv(text);
          parsed = { fileName: file.name, parsedCount: rows.length, payload: rows };
        } else {
          const rows = parseJotformCsv(text);
          parsed = { fileName: file.name, parsedCount: rows.length, payload: rows };
        }
      }
      setSlots(prev => ({ ...prev, [key]: parsed }));
      toast.success(`${file.name} — ${parsed.parsedCount} rows parsed`);
    } catch (e) {
      toast.error(`Failed to parse: ${(e as Error).message}`);
    } finally {
      setParsing(null);
    }
  }, []);

  const result: AllocationResult | null = useMemo(() => {
    if (!computed) return null;
    if (!slots.demand || !slots.jotform) return null;
    const demand = slots.demand.payload as DemandRow[];
    const submissions = slots.jotform.payload as ReturnType<typeof parseJotformCsv>;

    const sources: Array<Parameters<typeof mergeProviders>[0][number]> = [];
    if (slots.licenses) {
      const rows = slots.licenses.payload as ReturnType<typeof parseLicensesCsv>;
      for (const r of rows) sources.push({ key: r.key, name: r.name, email: r.email, profession: r.profession, states: r.states });
    }
    if (slots.supervision) {
      const rows = slots.supervision.payload as ReturnType<typeof parseSupervisionXlsx>;
      for (const r of rows) sources.push({ key: r.key, name: r.name, states: r.states, profession: 'NP' });
    }
    if (slots.ehr) {
      const rows = slots.ehr.payload as ReturnType<typeof parseEhrCoverageCsv>;
      for (const r of rows) sources.push({ key: r.key, name: r.name, states: r.states });
    }
    // Also add submitter names so we can flag those without licensure data.
    for (const s of submissions) {
      sources.push({ key: s.key, name: s.name, email: s.email, states: new Set<string>() });
    }

    const providers = mergeProviders(sources);
    const candidates = buildShiftCandidates(submissions, TARGET_MONTH);
    return allocate(candidates, providers, demand);
  }, [slots, computed]);

  const providerRows = useMemo(() => {
    if (!result) return [];
    const rows = Array.from(result.byProvider.values())
      .filter(p => p.acceptedHours > 0 || p.declinedHours > 0)
      .sort((a, b) => b.acceptedHours - a.acceptedHours || a.info.name.localeCompare(b.info.name));
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.info.name.toLowerCase().includes(q));
  }, [result, filter]);

  const acceptedProviderRows = useMemo(
    () => providerRows.filter(r => r.acceptedHours > 0),
    [providerRows],
  );

  const summary = useMemo(() => {
    if (!result) {
      return { providers: 0, hbDone: 0, ehrDone: 0, demand: 0, accepted: 0, declined: 0 };
    }
    const providers = acceptedProviderRows.length;
    let hb = 0, ehr = 0;
    for (const r of acceptedProviderRows) {
      const f = publish.get(r.info.key);
      if (f.homebaseAt) hb++;
      if (f.ehrAt) ehr++;
    }
    return {
      providers,
      hbDone: hb,
      ehrDone: ehr,
      demand: result.totals.demandHours,
      accepted: result.totals.acceptedHours,
      declined: result.totals.declinedHours,
    };
  }, [result, acceptedProviderRows, publish]);

  const handleBulkAll = (step: 'homebase' | 'ehr') => {
    const keys = acceptedProviderRows.map(r => r.info.key);
    if (keys.length === 0) {
      toast.info('No providers to mark.');
      return;
    }
    publish.setMany(keys, step, true);
    toast.success(`Marked ${keys.length} providers as posted to ${step === 'homebase' ? 'Homebase' : 'the EHR'}.`);
  };

  const allReady = Boolean(slots.demand && slots.jotform);

  // Re-uploading any file invalidates the computed result.
  useEffect(() => {
    setComputed(false);
  }, [slots]);

  const handleCalculate = () => {
    if (!allReady) {
      toast.error('Upload Demand + Jotform first.');
      return;
    }
    setComputed(true);
    setUploadOpen(false);
  };

  return (
    <SchedulingShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarCheck className="h-6 w-6 text-emerald-600" />
            June 2026 Schedule MVP
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload the five files, review the allocation, and check off what you've posted to Homebase and the EHR.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSlots({})}
          disabled={Object.keys(slots).length === 0}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Clear uploads
        </Button>
      </div>

      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setUploadOpen(o => !o)}
        >
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload data
              <span className="text-xs font-normal text-muted-foreground">
                {Object.keys(slots).length}/{SLOT_DEFS.length} loaded
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${uploadOpen ? '' : '-rotate-90'}`}
            />
          </CardTitle>
        </CardHeader>
        {uploadOpen && (
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {SLOT_DEFS.map(def => {
              const slot = slots[def.key];
              return (
                <div key={def.key} className="border rounded-md p-3 flex flex-col gap-2 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{def.label}</div>
                    {slot ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {slot.parsedCount}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Empty</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{def.hint}</div>
                  {slot && (
                    <div className="text-xs truncate text-muted-foreground" title={slot.fileName}>
                      <FileSpreadsheet className="inline h-3 w-3 mr-1" />
                      {slot.fileName}
                    </div>
                  )}
                  <Input
                    type="file"
                    accept={def.accept}
                    disabled={parsing === def.key}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(def.key, f);
                      e.target.value = '';
                    }}
                    className="text-xs"
                  />
                </div>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Required to compute: <strong>Demand</strong> + <strong>Jotform</strong>. Licensure
            sources combine as a union — bring as many as you have.
          </div>
        </CardContent>
        )}
      </Card>

      {!allReady && (
        <Alert>
          <AlertDescription>
            Upload the demand CSV and the Jotform availability CSV to compute the schedule.
          </AlertDescription>
        </Alert>
      )}

      {allReady && result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Demand hours" value={summary.demand.toFixed(0)} />
            <Kpi
              label="Accepted hours"
              value={summary.accepted.toFixed(0)}
              sub={summary.demand > 0 ? `${((summary.accepted / summary.demand) * 100).toFixed(0)}% fill` : undefined}
            />
            <Kpi label="Declined hours" value={summary.declined.toFixed(0)} />
            <Kpi
              label="Posted to Homebase"
              value={summary.providers > 0 ? `${Math.round((summary.hbDone / summary.providers) * 100)}%` : '—'}
              sub={`${summary.hbDone} of ${summary.providers}`}
            />
            <Kpi
              label="Posted to EHR"
              value={summary.providers > 0 ? `${Math.round((summary.ehrDone / summary.providers) * 100)}%` : '—'}
              sub={`${summary.ehrDone} of ${summary.providers}`}
            />
          </div>

          <Tabs defaultValue="provider">
            <TabsList>
              <TabsTrigger value="provider">By Provider</TabsTrigger>
              <TabsTrigger value="day">By Day</TabsTrigger>
              <TabsTrigger value="declined">Declined</TabsTrigger>
              <TabsTrigger value="states">State fill</TabsTrigger>
            </TabsList>

            <TabsContent value="provider" className="mt-4">
              <ByProvider
                rows={acceptedProviderRows}
                filter={filter}
                setFilter={setFilter}
                publish={publish}
                onBulkAll={handleBulkAll}
              />
            </TabsContent>

            <TabsContent value="day" className="mt-4">
              <ByDay shifts={result.shifts} publish={publish} />
            </TabsContent>

            <TabsContent value="declined" className="mt-4">
              <DeclinedView shifts={result.shifts} />
            </TabsContent>

            <TabsContent value="states" className="mt-4">
              <StateFill rows={result.stateFill} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {parsing && (
        <div className="fixed bottom-4 right-4 bg-background border rounded-md shadow px-3 py-2 flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Parsing {parsing}…
        </div>
      )}
    </SchedulingShell>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ByProvider({
  rows,
  filter,
  setFilter,
  publish,
  onBulkAll,
}: {
  rows: Array<{ info: ProviderInfo; accepted: AllocatedShift[]; declined: AllocatedShift[]; acceptedHours: number; declinedHours: number }>;
  filter: string;
  setFilter: (s: string) => void;
  publish: ReturnType<typeof useJunePublishLocal>;
  onBulkAll: (step: 'homebase' | 'ehr') => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">Providers · {rows.length}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Filter by name"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="md:w-64"
            />
            <Button size="sm" variant="outline" onClick={() => onBulkAll('homebase')}>
              <CalendarCheck className="h-4 w-4 mr-1" />
              Mark all Homebase
            </Button>
            <Button size="sm" variant="outline" onClick={() => onBulkAll('ehr')}>
              <CalendarCheck className="h-4 w-4 mr-1" />
              Mark all EHR
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Accordion type="multiple" className="w-full">
          {rows.map(r => {
            const flags = publish.get(r.info.key);
            return (
              <AccordionItem value={r.info.key} key={r.info.key}>
                <div className="flex items-center gap-2 px-4">
                  <div className="flex-1">
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex items-center gap-3 text-left w-full">
                        <div className="flex-1">
                          <div className="font-medium">{r.info.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.info.profession} · {r.accepted.length} shift{r.accepted.length === 1 ? '' : 's'}
                            {r.declined.length > 0 && ` · ${r.declined.length} declined`}
                          </div>
                        </div>
                        <div className="text-right tabular-nums text-sm font-semibold">
                          {r.acceptedHours.toFixed(1)}h
                        </div>
                      </div>
                    </AccordionTrigger>
                  </div>
                  <div className="flex items-center gap-3 pl-2" onClick={e => e.stopPropagation()}>
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox
                        checked={!!flags.homebaseAt}
                        onCheckedChange={c => publish.set(r.info.key, 'homebase', !!c)}
                      />
                      HB
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox
                        checked={!!flags.ehrAt}
                        onCheckedChange={c => publish.set(r.info.key, 'ehr', !!c)}
                      />
                      EHR
                    </label>
                  </div>
                </div>
                <AccordionContent className="px-4 pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Time (ET)</TableHead>
                        <TableHead>State(s)</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.accepted.map((s, idx) => (
                        <TableRow key={`a-${idx}`}>
                          <TableCell className="font-medium">{s.date}</TableCell>
                          <TableCell>{fmtMin(s.startMin)} – {fmtMin(s.endMin)}</TableCell>
                          <TableCell>
                            {s.assignments.map(a => (
                              <Badge key={a.state} variant="outline" className="mr-1">
                                {a.state} · {a.hours.toFixed(1)}h
                              </Badge>
                            ))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{s.acceptedHours.toFixed(1)}</TableCell>
                        </TableRow>
                      ))}
                      {r.declined.map((s, idx) => (
                        <TableRow key={`d-${idx}`} className="bg-red-50/50">
                          <TableCell className="font-medium">{s.date}</TableCell>
                          <TableCell>{fmtMin(s.startMin)} – {fmtMin(s.endMin)}</TableCell>
                          <TableCell className="text-xs text-red-700">
                            <CircleX className="inline h-3 w-3 mr-1" />
                            {REASON_LABELS[s.declineReason ?? ''] ?? s.declineReason}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-700">
                            -{s.declinedHours.toFixed(1)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function ByDay({
  shifts,
  publish,
}: {
  shifts: AllocatedShift[];
  publish: ReturnType<typeof useJunePublishLocal>;
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, AllocatedShift[]>();
    for (const s of shifts) {
      if (s.acceptedHours <= 0) continue;
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [shifts]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Days · {byDate.length}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Accordion type="multiple" className="w-full">
          {byDate.map(([date, dayShifts]) => {
            const totalHours = dayShifts.reduce((s, x) => s + x.acceptedHours, 0);
            const providers = new Set(dayShifts.map(s => s.providerKey));
            return (
              <AccordionItem value={date} key={date}>
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 text-left w-full">
                    <div className="flex-1">
                      <div className="font-medium">{formatDayLabel(date)}</div>
                      <div className="text-xs text-muted-foreground">
                        {providers.size} provider{providers.size === 1 ? '' : 's'} · {dayShifts.length} shift{dayShifts.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="text-right tabular-nums text-sm font-semibold">{totalHours.toFixed(1)}h</div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Time (ET)</TableHead>
                        <TableHead>State(s)</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-center">HB</TableHead>
                        <TableHead className="text-center">EHR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayShifts.map((s, idx) => {
                        const f = publish.get(s.providerKey);
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{s.providerName}</TableCell>
                            <TableCell>{fmtMin(s.startMin)} – {fmtMin(s.endMin)}</TableCell>
                            <TableCell>
                              {s.assignments.map(a => (
                                <Badge key={a.state} variant="outline" className="mr-1">
                                  {a.state} · {a.hours.toFixed(1)}h
                                </Badge>
                              ))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{s.acceptedHours.toFixed(1)}</TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={!!f.homebaseAt}
                                onCheckedChange={c => publish.set(s.providerKey, 'homebase', !!c)}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={!!f.ehrAt}
                                onCheckedChange={c => publish.set(s.providerKey, 'ehr', !!c)}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function DeclinedView({ shifts }: { shifts: AllocatedShift[] }) {
  const declined = useMemo(
    () =>
      shifts
        .filter(s => s.declinedHours > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || a.providerName.localeCompare(b.providerName)),
    [shifts],
  );

  if (declined.length === 0) {
    return (
      <Alert>
        <AlertDescription>No declined hours.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Declined · {declined.length} shifts</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time (ET)</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {declined.map((s, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-medium">{s.providerName}</TableCell>
                <TableCell>{s.date}</TableCell>
                <TableCell>{fmtMin(s.startMin)} – {fmtMin(s.endMin)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.declinedHours.toFixed(1)}</TableCell>
                <TableCell>
                  <Badge variant="destructive" className="text-xs">
                    {REASON_LABELS[s.declineReason ?? ''] ?? s.declineReason}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.declineNote}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StateFill({
  rows,
}: {
  rows: Array<{ state: string; needed: number; filled: number; remaining: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">State fill</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">Filled</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right">% Fill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.state}>
                <TableCell className="font-medium">{r.state}</TableCell>
                <TableCell className="text-right tabular-nums">{r.needed.toFixed(0)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.filled.toFixed(0)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.remaining.toFixed(0)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.needed > 0 ? `${((r.filled / r.needed) * 100).toFixed(0)}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}