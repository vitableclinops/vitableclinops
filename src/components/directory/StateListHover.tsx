import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface StateListHoverProps {
  /** Heading shown in the popup, e.g. "Active States in EHR". */
  label: string;
  /** The complete, untruncated state list. No popup is shown when empty. */
  value: string | null | undefined;
  /** Optional muted explanation line under the list. */
  detail?: string | null;
  /** What the cell shows while space allows (usually the truncated list). */
  display: React.ReactNode;
  /** Extras rendered after the display, e.g. a copy button. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Hover popup that reveals a state list the cell had to truncate.
 * Presentation only — it never changes what the cell displays.
 */
export const StateListHover = ({
  label,
  value,
  detail,
  display,
  children,
  className,
}: StateListHoverProps) => {
  const [open, setOpen] = React.useState(false);
  const list = (value || '').trim();

  const body = (
    <span className={className || 'flex items-center gap-1'}>
      {display}
      {children}
    </span>
  );

  if (!list) return body;

  const count = list.split(',').filter(s => s.trim()).length;

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="cursor-help" onClick={() => setOpen(false)}>
          {body}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-sm whitespace-normal break-words">
        <p className="text-xs font-semibold">{label}</p>
        <p className="mt-1 text-xs leading-relaxed">{list}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {count} state{count === 1 ? '' : 's'}
          {detail ? ` · ${detail}` : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  );
};
