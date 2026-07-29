import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { Download, RefreshCw, Loader2, Clock } from 'lucide-react';
import { downloadCSV } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Week { label: string; start: string; end: string }

interface RoleRow {
  role: string;
  weekly_hours: number[];
  monthly_total: number;
}

interface HoursData {
  month: string;
  weeks: Week[];
  roles: RoleRow[];
  grand_total_by_week: number[];
  grand_total_monthly: number;
  shifts_counted: number;
}

// ── Colors ────────────────────────────────────────────────────────────────────

const PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#84cc16',
  '#06b6d4', '#a78bfa', '#fb7185', '#34d399', '#fbbf24',
];

function roleColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

// ── Data fetching ──────────────────────────────────────────────────────────────

function useScheduledHours(year: number, month: number) {
  return useQuery<HoursData>({
    queryKey: ['homebase-hours-by-role', year, month],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('homebase-hours-by-role', {
        body: { year, month },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as HoursData;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

// ── Month selector options ─────────────────────────────────────────────────────

const MONTHS = [
  { value: 1,  label: 'January'   },
  { value: 2,  label: 'February'  },
  { value: 3,  label: 'March'     },
  { value: 4,  label: 'April'     },
  { value: 5,  label: 'May'       },
  { value: 6,  label: 'June'      },
  { value: 7,  label: 'July'      },
  { value: 8,  label: 'August'    },
  { value: 9,  label: 'September' },
  { value: 10, label: 'October'   },
  { value: 11, label: 'November'  },
  { value: 12, label: 'December'  },
];

const YEARS = [2025, 2026, 2027];

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-sm space-y-1 min-w-[180px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {[...payload].reverse().map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.fill }} />
            <span className="text-muted-foreground truncate max-w-[140px]">{p.name}</span>
          </span>
          <span className="font-medium tabular-nums">{p.value.toFixed(1)}h</span>
        </div>
      ))}
      <div className="border-t pt-1 flex justify-between font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{total.toFixed(1)}h</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScheduledHoursPage() {
  const { user, profile, roles } = useAuth();
  // Default to the current month/year rather than a hard-coded past month.
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading, error, refetch, isFetching } = useScheduledHours(year, month);

  // Build chart data: one entry per week, keyed by role
  const chartData = data
    ? data.weeks.map((w, wi) => {
        const entry: Record<string, any> = { week: w.label };
        for (const r of data.roles) {
          entry[r.role] = r.weekly_hours[wi];
        }
        return entry;
      })
    : [];

  function handleExport() {
    if (!data) return;
    const rows = data.roles.map((r) => {
      const row: Record<string, any> = { Role: r.role };
      data.weeks.forEach((w, wi) => { row[w.label] = r.weekly_hours[wi]; });
      row['Monthly Total'] = r.monthly_total;
      return row;
    });
    // Append grand total row
    const totalsRow: Record<string, any> = { Role: 'GRAND TOTAL' };
    data.weeks.forEach((w, wi) => { totalsRow[w.label] = data.grand_total_by_week[wi]; });
    totalsRow['Monthly Total'] = data.grand_total_monthly;
    rows.push(totalsRow);
    downloadCSV(rows, `scheduled-hours-${data.month}.csv`);
  }

  const monthLabel = MONTHS.find(m => m.value === month)?.label ?? '';

  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar
        userRole={roles[0] ?? 'admin'}
        userName={profile?.full_name ?? ''}
        userEmail={user?.email ?? ''}
      />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Scheduled Hours by Role</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Hours scheduled on Homebase, grouped by role — weekly and monthly totals.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Pulling from Homebase…</span>
          </div>
        )}

        {data && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Total</p>
                  <p className="text-2xl font-bold mt-1">{data.grand_total_monthly.toLocaleString()}h</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Roles Scheduled</p>
                  <p className="text-2xl font-bold mt-1">{data.roles.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Shifts Counted</p>
                  <p className="text-2xl font-bold mt-1">{data.shifts_counted.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg / Week</p>
                  <p className="text-2xl font-bold mt-1">
                    {data.weeks.length > 0
                      ? (data.grand_total_monthly / data.weeks.length).toFixed(0)
                      : 0}h
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Stacked bar chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Weekly Hours by Role — {monthLabel} {year}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit="h" width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      formatter={(value) => (
                        <span className="text-foreground">{value}</span>
                      )}
                    />
                    {data.roles.map((r, i) => (
                      <Bar key={r.role} dataKey={r.role} stackId="a" fill={roleColor(i)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Summary table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Hours Breakdown — {monthLabel} {year}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-48">Role</th>
                      {data.weeks.map(w => (
                        <th key={w.start} className="text-right px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
                          {w.label}
                        </th>
                      ))}
                      <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Monthly Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.roles.map((r, i) => (
                      <tr key={r.role} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                              style={{ background: roleColor(i) }}
                            />
                            {r.role}
                          </span>
                        </td>
                        {r.weekly_hours.map((h, wi) => (
                          <td key={wi} className="text-right px-3 py-2.5 tabular-nums">
                            {h > 0 ? `${h.toFixed(1)}h` : <span className="text-muted-foreground/50">—</span>}
                          </td>
                        ))}
                        <td className="text-right px-4 py-2.5 font-semibold tabular-nums">
                          {r.monthly_total.toFixed(1)}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/40 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      {data.grand_total_by_week.map((h, wi) => (
                        <td key={wi} className="text-right px-3 py-2.5 tabular-nums">{h.toFixed(1)}h</td>
                      ))}
                      <td className="text-right px-4 py-2.5 tabular-nums">{data.grand_total_monthly.toFixed(1)}h</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
