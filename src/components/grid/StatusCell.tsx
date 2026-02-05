import { cn } from '@/lib/utils';
import type { CellStatus } from '@/types/grid';

interface StatusCellProps {
  status: CellStatus;
  onClick?: () => void;
  isSelected?: boolean;
  compact?: boolean;
}

const statusStyles: Record<CellStatus, string> = {
  green: 'bg-success/20 border-success/40 hover:bg-success/30',
  yellow: 'bg-warning/20 border-warning/40 hover:bg-warning/30',
  red: 'bg-destructive/20 border-destructive/40 hover:bg-destructive/30',
  gray: 'bg-muted/50 border-muted hover:bg-muted',
};

const statusDotStyles: Record<CellStatus, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-destructive',
  gray: 'bg-muted-foreground/50',
};

export function StatusCell({ status, onClick, isSelected, compact }: StatusCellProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center border transition-all duration-150 rounded-sm',
        statusStyles[status],
        isSelected && 'ring-2 ring-primary ring-offset-1',
        compact ? 'w-8 h-8' : 'w-10 h-10',
        onClick && 'cursor-pointer'
      )}
    >
      <div className={cn(
        'rounded-full',
        statusDotStyles[status],
        compact ? 'w-2 h-2' : 'w-3 h-3'
      )} />
    </button>
  );
}
