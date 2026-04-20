import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  children: ReactNode;
  className?: string;
  /** Aria label for the info icon. Default: "More info". */
  label?: string;
  /** Alignment relative to the trigger. */
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Tiny info-icon tooltip for jargon or column-header definitions.
 *
 *   <th>
 *     <span className="inline-flex items-center gap-1">
 *       SLA Target
 *       <InfoTooltip>Daily appointment-slot target: max(5, weekly_visits / 5 × 1.5).</InfoTooltip>
 *     </span>
 *   </th>
 */
export function InfoTooltip({
  children,
  className,
  label = "More info",
  side = "top",
}: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              className,
            )}
          >
            <Info className="h-3 w-3" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
