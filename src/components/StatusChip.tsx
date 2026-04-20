import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Canonical status categories used across the app. Pick the closest one for your domain.
 * The actual label shown can still be customized with `label`.
 *
 * This is the generic chip — if you're labeling a *task* status, use `StatusBadge` instead,
 * which has task-specific icons/labels baked in.
 */
export type StatusTone =
  | "active"       // green    — working, healthy, on-track
  | "inactive"     // gray     — archived, deactivated, disabled
  | "pending"      // amber    — waiting, in-progress, not-yet-resolved
  | "warning"      // orange   — attention-needed, degraded, expiring soon
  | "error"        // red      — failed, critical, expired, blocked
  | "info"         // blue     — informational, forecasted, externally-managed
  | "success";     // green    — completed, confirmed

const TONE_CLASSES: Record<StatusTone, string> = {
  active:   "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  success:  "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  inactive: "bg-muted text-muted-foreground border-border",
  pending:  "bg-amber-500/10  text-amber-700   border-amber-500/30  dark:text-amber-400",
  warning:  "bg-orange-500/10 text-orange-700  border-orange-500/30 dark:text-orange-400",
  error:    "bg-red-500/10    text-red-700     border-red-500/30    dark:text-red-400",
  info:     "bg-blue-500/10   text-blue-700    border-blue-500/30   dark:text-blue-400",
};

interface StatusChipProps {
  tone: StatusTone;
  /** The text shown. Defaults to a Title-Cased version of the tone. */
  label?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

const DEFAULT_LABELS: Record<StatusTone, string> = {
  active: "Active",
  success: "Completed",
  inactive: "Inactive",
  pending: "Pending",
  warning: "Warning",
  error: "Error",
  info: "Info",
};

/**
 * Single source of truth for domain status chips (provider status, state activation,
 * license expiry, SLA health, etc.). Prefer this over hand-rolled `bg-*` + `text-*` combos.
 *
 * <StatusChip tone="active" />                   // "Active", green
 * <StatusChip tone="pending" label="In review" />
 * <StatusChip tone="warning" icon={<AlertTriangle className="h-3 w-3" />} label="Expires soon" />
 */
export function StatusChip({ tone, label, icon, className }: StatusChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", TONE_CLASSES[tone], className)}
    >
      {icon}
      {label ?? DEFAULT_LABELS[tone]}
    </Badge>
  );
}

/**
 * Map a common free-form status string to a tone.
 * Unknown values fall through to "inactive" so nothing blows up if the DB has a new enum value.
 */
export function toneForStatus(status: string | null | undefined): StatusTone {
  const s = (status ?? "").toLowerCase();
  if (["active", "approved", "completed", "healthy", "ok", "success", "ready", "verified"].includes(s)) return "active";
  if (["pending", "in_progress", "in-progress", "in progress", "draft", "processing", "queued", "review"].includes(s)) return "pending";
  if (["warning", "expiring", "degraded", "low", "attention"].includes(s)) return "warning";
  if (["error", "failed", "expired", "critical", "blocked", "rejected", "denied", "zero"].includes(s)) return "error";
  if (["info", "forecast", "external", "externally_managed", "externally-managed"].includes(s)) return "info";
  return "inactive";
}
