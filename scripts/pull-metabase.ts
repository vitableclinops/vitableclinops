#!/usr/bin/env node
/**
 * pull-metabase.ts
 *
 * Downloads Metabase reports as CSVs, parses them, and sends rows to
 * the already-deployed Lovable Cloud import edge functions.
 *
 * No service role key required — uses the public anon key to call functions.
 *
 * Run:  npx tsx scripts/pull-metabase.ts
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Load .env.metabase if running locally
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(join(PROJECT_ROOT, ".env.metabase"));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const METABASE_URL = "https://metabase.vitablehealth.com";
const SUPABASE_URL = "https://saksjvmqyudkowxypoce.supabase.co";
// Anon key is intentionally public — safe to hardcode
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E";

const METABASE_USERNAME = process.env.METABASE_USERNAME ?? "";
const METABASE_PASSWORD = process.env.METABASE_PASSWORD ?? "";

// ---------------------------------------------------------------------------
// Report definitions: name → handler
// ---------------------------------------------------------------------------
type Row = Record<string, string>;

interface Report {
  name: string;
  handle: (rows: Row[]) => Promise<{ inserted: number; errors: string[] }>;
}

const REPORTS: Report[] = [
  {
    name: "SLA Attainment Rate by State",
    handle: async (rows) => {
      const today = new Date().toISOString().slice(0, 10);
      const mapped = rows.map((r) => ({
        state: col(r, "State", "state"),
        sla: col(r, "SLA Attainment Rate", "SLA Attainment Rate", "sla"),
      })).filter((r) => r.state);
      return callFunction("import-sla-attainment", {
        rows: mapped,
        window_label: "daily_auto",
        window_start: today,
        window_end: today,
      });
    },
  },
  {
    name: "Sum of same_next_day_available_slots by state and date_actual: Day",
    handle: async (rows) => {
      const mapped = rows.map((r) => ({
        state: col(r, "State", "state"),
        date: col(r, "date_actual: Day", "date_actual", "date", "Day"),
        slots: col(r, "Sum of same_next_day_available_slots", "slots", "available_slots"),
      })).filter((r) => r.state);
      return callFunction("import-leftover-slots", {
        rows: mapped,
        window_type: "forecast",
      });
    },
  },
  {
    name: "Weekly demand forecast + active members by state",
    handle: async (rows) => {
      const mapped = rows.map((r) => ({
        state: col(r, "State", "state"),
        week_start: col(r, "Week", "week_start", "date", "Period"),
        visits: col(r, "Visits", "visits", "projected_visits", "Count", "Active Members", "members"),
      })).filter((r) => r.state && r.week_start);
      return callFunction("import-demand-forecast", { rows: mapped });
    },
  },
  {
    name: "Utilization Rate by Provider (5-week)",
    handle: async (rows) => {
      const now = new Date();
      const window_end = now.toISOString().slice(0, 10);
      const window_start = new Date(now.getTime() - 35 * 864e5).toISOString().slice(0, 10);
      const mapped = rows.map((r) => ({
        provider: col(r, "Provider", "provider", "Name"),
        avg_utilization: col(r, "Avg Time Slot Utilization", "Utilization Rate", "utilization"),
        total_timeslots: col(r, "Total Timeslots", "total_timeslots", "timeslots"),
      })).filter((r) => r.provider);
      return callFunction("import-provider-utilization", { rows: mapped, window_start, window_end });
    },
  },
  // Reports without dedicated import functions — log and skip for now
  { name: "Average of SLA Attainment Rate",                    handle: logOnly },
  { name: "rpt_telemedicine_availability_by_state_per_day",    handle: logOnly },
  { name: "PCP State Coverage",                                handle: logOnly },
  { name: "Provider Appointment Count",                        handle: logOnly },
];

// ---------------------------------------------------------------------------
// Metabase helpers
// ---------------------------------------------------------------------------
async function getMetabaseToken(): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: METABASE_USERNAME, password: METABASE_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function findCardId(token: string, name: string): Promise<number | null> {
  const res = await fetch(
    `${METABASE_URL}/api/search?q=${encodeURIComponent(name)}&models=card`,
    { headers: { "X-Metabase-Session": token } }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: number; name: string }[] };
  return body.data?.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;
}

async function downloadCSVText(token: string, cardId: number): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/card/${cardId}/query/csv`, {
    method: "POST",
    headers: { "X-Metabase-Session": token, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${await res.text()}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields)
// ---------------------------------------------------------------------------
function parseCSV(text: string): Row[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]));
  });
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Edge function caller
// ---------------------------------------------------------------------------
async function callFunction(
  name: string,
  body: unknown
): Promise<{ inserted: number; errors: string[] }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} returned ${res.status}: ${text}`);
  const data = JSON.parse(text) as { inserted?: number; errors?: string[] };
  return { inserted: data.inserted ?? 0, errors: data.errors ?? [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function col(row: Row, ...candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === c.toLowerCase());
    if (key !== undefined) return (row[key] ?? "").trim();
  }
  return "";
}

async function logOnly(rows: Row[]): Promise<{ inserted: number; errors: string[] }> {
  console.log(`    (no import function yet — ${rows.length} rows available, skipping)`);
  return { inserted: 0, errors: [] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== Metabase CSV Pull — ${today} ===\n`);

  if (!METABASE_USERNAME || !METABASE_PASSWORD) {
    console.error("Missing METABASE_USERNAME or METABASE_PASSWORD");
    process.exit(1);
  }

  console.log("Authenticating to Metabase...");
  const token = await getMetabaseToken();
  console.log("  ✓ Authenticated\n");

  const overallErrors: string[] = [];

  for (const report of REPORTS) {
    process.stdout.write(`• ${report.name}\n`);

    try {
      const cardId = await findCardId(token, report.name);
      if (!cardId) {
        console.log("    ⚠️  Card not found in Metabase — skipping");
        continue;
      }

      const csvText = await downloadCSVText(token, cardId);
      const rows = parseCSV(csvText);
      console.log(`    Downloaded ${rows.length} rows (card ${cardId})`);

      const { inserted, errors } = await report.handle(rows);
      if (inserted > 0) console.log(`    ✓ Inserted/updated ${inserted} records`);
      if (errors.length > 0) {
        errors.forEach((e) => console.log(`    ⚠️  ${e}`));
        overallErrors.push(...errors.map((e) => `${report.name}: ${e}`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ✗ ${msg}`);
      overallErrors.push(`${report.name}: ${msg}`);
    }

    console.log();
  }

  if (overallErrors.length > 0) {
    console.error(`Finished with ${overallErrors.length} error(s).`);
    process.exit(1);
  } else {
    console.log("All reports processed successfully.");
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
