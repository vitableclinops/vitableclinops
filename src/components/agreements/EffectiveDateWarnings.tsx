import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Calendar, Info } from 'lucide-react';
import { format, isBefore, isAfter } from 'date-fns';

interface EffectiveDateWarningsProps {
  terminationEffectiveDate?: string | null;
  initiationEffectiveDate?: string | null;
  terminationComplete: boolean;
  initiationComplete: boolean;
  className?: string;
}

export function EffectiveDateWarnings({
  terminationEffectiveDate,
  initiationEffectiveDate,
  terminationComplete,
  initiationComplete,
  className,
}: EffectiveDateWarningsProps) {
  const warnings: Array<{ type: 'warning' | 'info' | 'error'; message: string; detail?: string }> = [];

  const now = new Date();
  const termDate = terminationEffectiveDate ? new Date(terminationEffectiveDate) : null;
  const initDate = initiationEffectiveDate ? new Date(initiationEffectiveDate) : null;

  // Warning: Initiation tasks completed but termination date not set
  if (initiationComplete && !terminationEffectiveDate) {
    warnings.push({
      type: 'warning',
      message: 'Termination effective date not set',
      detail: 'Initiation tasks have been completed, but no termination effective date is recorded. Please confirm the old agreement end date.',
    });
  }

  // Warning: Initiation date is before termination date
  if (termDate && initDate && isBefore(initDate, termDate)) {
    warnings.push({
      type: 'error',
      message: 'Date sequence issue',
      detail: `The initiation date (${format(initDate, 'MMM d, yyyy')}) is before the termination date (${format(termDate, 'MMM d, yyyy')}). This may cause a supervision gap.`,
    });
  }

  // Warning: Termination date is in the past but tasks not complete
  if (termDate && isBefore(termDate, now) && !terminationComplete) {
    warnings.push({
      type: 'error',
      message: 'Termination deadline passed',
      detail: `The termination effective date was ${format(termDate, 'MMM d, yyyy')}. Some termination tasks are still incomplete.`,
    });
  }

  // Info: Upcoming termination deadline
  if (termDate && isAfter(termDate, now) && !terminationComplete) {
    const daysUntil = Math.ceil((termDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 7) {
      warnings.push({
        type: 'warning',
        message: `Termination deadline in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
        detail: `Complete all termination tasks by ${format(termDate, 'MMM d, yyyy')}.`,
      });
    }
  }

  // Info: No dates set at all
  if (!terminationEffectiveDate && !initiationEffectiveDate) {
    warnings.push({
      type: 'info',
      message: 'No effective dates set',
      detail: 'Consider setting termination and initiation effective dates to track deadlines.',
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className={className}>
      {warnings.map((warning, idx) => (
        <Alert 
          key={idx} 
          variant={warning.type === 'error' ? 'destructive' : 'default'}
          className={warning.type === 'warning' ? 'border-warning bg-warning/5' : ''}
        >
          {warning.type === 'error' ? (
            <AlertTriangle className="h-4 w-4" />
          ) : warning.type === 'warning' ? (
            <Calendar className="h-4 w-4 text-warning" />
          ) : (
            <Info className="h-4 w-4" />
          )}
          <AlertTitle>{warning.message}</AlertTitle>
          {warning.detail && (
            <AlertDescription className="text-sm">
              {warning.detail}
            </AlertDescription>
          )}
        </Alert>
      ))}
    </div>
  );
}
