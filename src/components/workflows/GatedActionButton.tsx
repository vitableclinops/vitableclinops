import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock } from 'lucide-react';
import { AdminOverrideDialog } from './AdminOverrideDialog';
import type { WorkflowReadiness, BlockingReason } from '@/hooks/useWorkflowReadiness';
import { cn } from '@/lib/utils';

interface GatedActionButtonProps extends Omit<ButtonProps, 'onClick'> {
  readiness: WorkflowReadiness;
  isAdmin: boolean;
  entityType: 'transfer' | 'agreement' | 'activation';
  entityId: string;
  entityLabel: string;
  actionLabel: string;
  onClick: () => Promise<void> | void;
}

export function GatedActionButton({
  readiness,
  isAdmin,
  entityType,
  entityId,
  entityLabel,
  actionLabel,
  onClick,
  children,
  className,
  ...buttonProps
}: GatedActionButtonProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const requiredBlockers = readiness.blockingReasons.filter(r => r.severity === 'required');
  const isBlocked = !readiness.canExecute;

  if (!isBlocked) {
    return (
      <Button onClick={() => onClick()} className={className} {...buttonProps}>
        {children}
      </Button>
    );
  }

  // Blocked: admin gets override dialog, others get disabled with tooltip
  if (isAdmin) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => setOverrideOpen(true)}
              className={cn('gap-2', className)}
              variant="outline"
              {...buttonProps}
            >
              <Lock className="h-3.5 w-3.5" />
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="font-medium text-xs">Blocked — admin override available</p>
            <ul className="mt-1 space-y-0.5">
              {requiredBlockers.slice(0, 3).map((r, i) => (
                <li key={i} className="text-xs">• {r.label}</li>
              ))}
              {requiredBlockers.length > 3 && (
                <li className="text-xs text-muted-foreground">
                  +{requiredBlockers.length - 3} more
                </li>
              )}
            </ul>
          </TooltipContent>
        </Tooltip>

        <AdminOverrideDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          entityType={entityType}
          entityId={entityId}
          entityLabel={entityLabel}
          action={actionLabel}
          blockingReasons={readiness.blockingReasons}
          onConfirm={async () => { await onClick(); }}
        />
      </>
    );
  }

  // Non-admin: disabled with tooltip explanation
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button disabled className={cn('gap-2', className)} {...buttonProps}>
            <Lock className="h-3.5 w-3.5" />
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium text-xs">Blocked</p>
        <ul className="mt-1 space-y-0.5">
          {requiredBlockers.slice(0, 3).map((r, i) => (
            <li key={i} className="text-xs">• {r.label}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
