import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  useDataFreshness,
  formatRelativeTime,
  labelForSource,
  isStale,
  type FreshnessRow,
} from '@/hooks/useDataFreshness';
import { cn } from '@/lib/utils';

type FreshnessTable = FreshnessRow['table'];

const TABLE_LABELS: Record<FreshnessTable, string> = {
  state_sla_attainment: 'SLA',
  state_leftover_slots: 'slots',
  provider_utilization: 'utilization',
  utilization_daily: 'daily utilization',
};

interface Props {
  tables: FreshnessTable[];
  /** Compact inline pill (used in headers). When false, full footer + stale alert. */
  variant?: 'inline' | 'footer';
  className?: string;
}

/**
 * Surfaces sync-freshness for one or more data tables. If any tracked
 * table hasn't been refreshed in the last 24h, a yellow banner warns
 * that the data is stale.
 *
 * Modeled on the existing UtilizationPage pattern, generalized so any
 * ops page can drop it in with a single line.
 */
export function DataFreshnessIndicator({ tables, variant = 'footer', className }: Props) {
  const { data: rows = [], isLoading } = useDataFreshness(tables);

  if (isLoading) {
    return (
      <p className={cn('text-xs text-muted-foreground inline-flex items-center gap-1', className)}>
        <RefreshCw className="h-3 w-3 animate-spin" /> checking sync status…
      </p>
    );
  }

  const stale = rows.filter((r) => isStale(r.syncedAt));

  if (variant === 'inline') {
    // Compact one-liner — show the freshest single row, plus warn if any stale.
    const freshest = [...rows].sort((a, b) =>
      (b.syncedAt ?? '').localeCompare(a.syncedAt ?? ''),
    )[0];
    return (
      <span className={cn('text-xs text-muted-foreground inline-flex items-center gap-1.5', className)}>
        {freshest?.syncedAt ? (
          <>
            Last synced {formatRelativeTime(freshest.syncedAt)} · {labelForSource(freshest.source)}
          </>
        ) : (
          <>No sync recorded</>
        )}
        {stale.length > 0 && (
          <Badge variant="outline" className="ml-1 border-yellow-500 text-yellow-700 dark:text-yellow-400 text-[10px] py-0 h-5">
            <AlertTriangle className="h-3 w-3 mr-0.5" /> stale
          </Badge>
        )}
      </span>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {stale.length > 0 && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />
          <AlertDescription className="text-sm">
            <span className="font-medium text-foreground">Data may be stale.</span>{' '}
            {stale
              .map(
                (r) =>
                  `${TABLE_LABELS[r.table]} last synced ${formatRelativeTime(r.syncedAt)}`,
              )
              .join(' · ')}
            . Check the nightly sync job.
          </AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        {rows.map((r, i) => (
          <span key={r.table}>
            {i > 0 && ' · '}
            <span className="font-medium">{TABLE_LABELS[r.table]}</span>{' '}
            {r.syncedAt
              ? `${formatRelativeTime(r.syncedAt)} (${labelForSource(r.source)})`
              : 'never synced'}
          </span>
        ))}
      </p>
    </div>
  );
}
