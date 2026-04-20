import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type Row = Record<string, unknown>;

interface CsvPreviewDialogProps {
  /** Controls visibility */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Confirm SLA Import" */
  title: string;
  /** Optional context shown below the title */
  description?: ReactNode;
  /** Parsed rows to preview. Only the first 5 are rendered. */
  rows: Row[];
  /**
   * Columns to show in the preview table.
   * Falsy → inferred from the keys of the first row.
   */
  columns?: Array<{ key: string; label?: string }>;
  /** Optional key/value summary strip rendered above the table (e.g. window label). */
  meta?: Array<{ label: string; value: ReactNode }>;
  /** Called when user clicks the confirm button. Parent handles the actual import. */
  onConfirm: () => void;
  /** Whether the import is currently running. Disables buttons + shows spinner. */
  isPending?: boolean;
  /** Confirm button label. Defaults to "Continue import". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
}

/**
 * Generic "preview before commit" dialog for CSV imports.
 *
 * Shows total row count, optional meta strip, and the first 5 rows
 * in a small scrollable table so the user can sanity-check the file
 * before it's written to the database.
 */
export function CsvPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  rows,
  columns,
  meta,
  onConfirm,
  isPending = false,
  confirmLabel = 'Continue import',
  cancelLabel = 'Cancel',
}: CsvPreviewDialogProps) {
  const inferredColumns =
    columns ??
    (rows[0]
      ? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
      : []);

  const previewRows = rows.slice(0, 5);
  const total = rows.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{total.toLocaleString()} rows total</Badge>
            <span className="text-muted-foreground">
              showing first {Math.min(previewRows.length, 5)}
            </span>
          </div>

          {meta && meta.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
              {meta.map((m) => (
                <div key={m.label}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {m.label}
                  </div>
                  <div className="font-medium text-foreground">{m.value}</div>
                </div>
              ))}
            </div>
          )}

          {previewRows.length > 0 ? (
            <div className="max-h-[280px] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    {inferredColumns.map((c) => (
                      <TableHead key={c.key} className="whitespace-nowrap">
                        {c.label ?? c.key}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {inferredColumns.map((c) => (
                        <TableCell key={c.key} className="whitespace-nowrap">
                          {formatCell(row[c.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No rows detected — check your file headers match the expected columns.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={isPending || total === 0}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '—' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
