import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, downloadCSV } from '@/lib/utils';
import { ChevronDown, Download, Users } from 'lucide-react';
import { ProviderCoverageRow } from '@/hooks/useProviderCoverage';

interface Props {
  data: ProviderCoverageRow[];
  isLoading: boolean;
  selectedDate: string;
}

export function ProviderCoverageTable({ data, isLoading, selectedDate }: Props) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter((r) => r.providerName.toLowerCase().includes(q));
  }, [data, search]);

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const handleExport = () => {
    const rows: Record<string, unknown>[] = [];
    for (const r of filtered) {
      if (r.stateAllocations.length === 0) {
        rows.push({
          provider: r.providerName,
          total_hours: r.totalHours,
          total_slots: r.totalSlots,
          state: '(no eligible states)',
          allocated_hours: '',
          projected_slots: '',
        });
      } else {
        for (const sa of r.stateAllocations) {
          rows.push({
            provider: r.providerName,
            total_hours: r.totalHours,
            total_slots: r.totalSlots,
            state: sa.state,
            allocated_hours: sa.allocatedHours,
            projected_slots: sa.projectedSlots,
          });
        }
      }
    }
    downloadCSV(rows, `provider-coverage-${selectedDate}.csv`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Provider Coverage — {displayDate}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search provider…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-48 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length} provider{filtered.length !== 1 ? 's' : ''}
            </span>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {data.length === 0
              ? 'No Homebase shifts found for this date.'
              : 'No providers match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-8" />
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total Hours</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total Slots</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">States</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Hrs/State</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Slots/State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isExpanded = expandedId === row.profileId;
                  return (
                    <ProviderRow
                      key={row.profileId}
                      row={row}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : row.profileId)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: ProviderCoverageRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b transition-colors hover:bg-muted/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-2.5">
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </td>
        <td className="px-4 py-2.5 font-medium">{row.providerName}</td>
        <td className="px-4 py-2.5 text-right font-mono">{row.totalHours.toFixed(1)}h</td>
        <td className="px-4 py-2.5 text-right font-mono">{row.totalSlots.toFixed(0)}</td>
        <td className="px-4 py-2.5 text-right">
          <Badge variant="secondary" className="font-mono">
            {row.eligibleStates.length}
          </Badge>
        </td>
        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
          {row.hoursPerState.toFixed(2)}h
        </td>
        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
          {row.slotsPerState.toFixed(1)}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b">
          <td colSpan={7} className="px-0 py-0">
            <div className="bg-muted/20 px-8 py-3">
              {row.stateAllocations.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No active licensed states found for this provider.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                  {row.stateAllocations.map((sa) => (
                    <div
                      key={sa.state}
                      className="rounded-md border bg-background px-3 py-2 text-center"
                    >
                      <div className="text-xs font-bold">{sa.state}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {sa.allocatedHours.toFixed(2)}h · {sa.projectedSlots.toFixed(1)} slots
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
