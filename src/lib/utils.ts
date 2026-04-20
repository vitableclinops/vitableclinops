import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date for display, consistently, across the app.
 * Accepts a Date, ISO string, or YYYY-MM-DD string; returns "" for null/undefined/invalid.
 *
 * Modes:
 *   - "short": Apr 20, 2026       (default — tables, detail rows)
 *   - "long":  April 20, 2026     (headings, summaries)
 *   - "numeric": 04/20/2026       (dense tables)
 *   - "datetime": Apr 20, 2026, 2:03 PM
 *   - "iso": 2026-04-20           (machine-friendly, for CSV export etc.)
 */
export function formatDisplayDate(
  value: Date | string | null | undefined,
  mode: "short" | "long" | "numeric" | "datetime" | "iso" = "short",
): string {
  if (value == null || value === "") return "";
  const d =
    typeof value === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? parseLocalDate(value)
        : new Date(value)
      : value;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  switch (mode) {
    case "short":    return format(d, "MMM d, yyyy");
    case "long":     return format(d, "MMMM d, yyyy");
    case "numeric":  return format(d, "MM/dd/yyyy");
    case "datetime": return format(d, "MMM d, yyyy, h:mm a");
    case "iso":      return formatLocalDate(d);
  }
}

/**
 * Format a percentage for display. Accepts either a fraction (0.035) or an already-scaled number (3.5),
 * and clamps precision. Use this everywhere we show SLA %, utilization %, attainment, etc.
 *
 *   formatPercent(0.035)          → "3.5%"
 *   formatPercent(3.5, { isFraction: false }) → "3.5%"
 *   formatPercent(null)           → "—"
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { digits?: number; isFraction?: boolean; empty?: string } = {},
): string {
  const { digits = 1, isFraction = true, empty = "—" } = opts;
  if (value == null || Number.isNaN(value)) return empty;
  const scaled = isFraction ? value * 100 : value;
  return `${scaled.toFixed(digits)}%`;
}

/**
 * Format a whole-number count with thousands separators. "" for null/undefined.
 */
export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US");
}

/**
 * Parse a YYYY-MM-DD date string as a local date (not UTC).
 * Prevents timezone shift where e.g. "2026-03-01" displays as Feb 28.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date as YYYY-MM-DD using local calendar values (not UTC).
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Download an array of flat objects as a CSV file.
 * Values containing commas or quotes are quoted.
 */
export function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
