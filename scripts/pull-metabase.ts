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
  cardId?: number;
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
    cardId: 2431,
    name: "Same & Next Day Available Slots By State and Day (Next 7 days)",
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
      // Card 2957 returns: State | Weekly Demand | Active Members Count...
      // No week column — use current week's Monday as week_start.
      const now = new Date();
      const dow = now.getUTCDay(); // 0=Sun
      const daysToMonday = (dow + 6) % 7;
      const monday = new Date(now.getTime() - daysToMonday * 864e5);
      const defaultWeekStart = monday.toISOString().slice(0, 10);
      const mapped = rows.map((r) => ({
        state: col(r, "State", "state"),
        week_start: col(r, "Week", "week_start", "Week Start", "date_actual", "date_actual: Week", "date", "Period", "Day") || defaultWeekStart,
        visits: col(r, "Weekly Demand", "Visits", "visits", "projected_visits", "Forecasted Visits", "Forecast", "Count", "Active Members", "members", "Sum"),
      })).filter((r) => r.state && r.week_start && r.visits);
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
        provider: col(r, "Provider", "provider", "Provider Full Name", "Name", "Provider Name"),
        avg_utilization: col(r, "Avg Time Slot Utilization", "Average of Time Slot Utilization", "Utilization Rate", "utilization", "Avg Utilization"),
        total_timeslots: col(r, "Total Timeslots", "Sum of Total Timeslots", "total_timeslots", "timeslots", "Timeslots"),
      })).filter((r) => r.provider);
      return callFunction("import-provider-utilization", { rows: mapped, window_start, window_end });
    },
  },
  {
    cardId: 2931,
    name: "SD/ND SLA Attainment Rate - MTD",
    handle: async (rows) => callFunction("import-sla-aggregate", { rows }),
  },
  {
    name: "rpt_telemedicine_availability_by_state_per_day",
    // 49k+ rows — chunk to avoid edge function memory limits
    handle: async (rows) => chunkedCall("import-telemedicine-availability", rows, 2000),
  },
  {
    cardId: 2940,
    name: "PCP State Coverage",
    handle: async (rows) => callFunction("import-pcp-coverage", { rows }),
  },
  {
    name: "Provider Appointment Count",
    // 5k+ rows + may use "Provider Full Name" column — pre-normalize and chunk
    handle: async (rows) => {
      const mapped = rows.map((r) => ({
        provider: col(r, "Provider Full Name", "Provider", "provider", "Name"),
        count:    col(r, "Booked Appointment Count", "Completed Appointment Count", "Provider Appointment Count", "Count", "count"),
        date:     col(r, "Date", "date", "day"),
      })).filter((r) => r.provider);
      return chunkedCall("import-provider-appointments", mapped, 2000);
    },
  },
];

/**
 * Calls an import function in batches of `chunkSize` rows so we don't blow past
 * the edge function memory/CPU limits on multi-thousand-row reports.
 */
async function chunkedCall(
  name: string,
  rows: unknown[],
  chunkSize: number
): Promise<{ inserted: number; errors: string[] }> {
  let totalInserted = 0;
  const allErrors: string[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    try {
      const { inserted, errors } = await callFunction(name, { rows: batch });
      totalInserted += inserted;
      allErrors.push(...errors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allErrors.push(`Chunk ${i}-${i + batch.length}: ${msg}`);
    }
  }
  return { inserted: totalInserted, errors: allErrors };
}

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

async function findCardId(
  token: string,
  name: string
): Promise<{ id: number | null; candidates: { id: number; name: string }[] }> {
  const res = await fetch(
    `${METABASE_URL}/api/search?q=${encodeURIComponent(name)}&models=card`,
    { headers: { "X-Metabase-Session": token } }
  );
  if (!res.ok) return { id: null, candidates: [] };
  const body = (await res.json()) as { data: { id: number; name: string }[] };
  const candidates = body.data ?? [];

  const target = name.trim().toLowerCase();

  // 1) Exact match (case-insensitive)
  const exact = candidates.find((c) => c.name.trim().toLowerCase() === target);
  if (exact) return { id: exact.id, candidates };

  // 2) Normalized match: collapse whitespace + strip punctuation
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tNorm = norm(name);
  const normMatch = candidates.find((c) => norm(c.name) === tNorm);
  if (normMatch) return { id: normMatch.id, candidates };

  // 3) Substring match (target words all appear in candidate)
  const targetWords = tNorm.split(" ").filter((w) => w.length > 2);
  const substr = candidates.find((c) => {
    const cn = norm(c.name);
    return targetWords.every((w) => cn.includes(w));
  });
  if (substr) return { id: substr.id, candidates };

  return { id: null, candidates };
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
  if (res.status === 404) {
    // Function not yet deployed — warn but don't fail the whole run
    console.log(`    ⏳ ${name} not deployed yet (404) — will work after Lovable syncs`);
    return { inserted: 0, errors: [] };
  }
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
      let cardId = report.cardId ?? null;
      let candidates: { id: number; name: string }[] = [];

      if (!cardId) {
        const result = await findCardId(token, report.name);
        cardId = result.id;
        candidates = result.candidates;
      }

      if (!cardId) {
        console.log(`    ✗ Card not found: "${report.name}"`);
        if (candidates.length > 0) {
          console.log(`      Closest matches in Metabase search results:`);
          candidates.slice(0, 5).forEach((c) =>
            console.log(`        • [${c.id}] ${c.name}`)
          );
        } else {
          console.log(`      (no candidates returned by Metabase search)`);
        }
        overallErrors.push(`${report.name}: card not found in Metabase`);
        console.log();
        continue;
      }

      const csvText = await downloadCSVText(token, cardId);
      const rows = parseCSV(csvText);
      console.log(`    Downloaded ${rows.length} rows (card ${cardId})`);

      if (rows.length === 0) {
        console.log(`    ⚠️  Card returned 0 rows — check Metabase query`);
        overallErrors.push(`${report.name}: card returned 0 rows`);
        console.log();
        continue;
      }

      const { inserted, errors } = await report.handle(rows);
      if (inserted > 0) {
        console.log(`    ✓ Inserted/updated ${inserted} records`);
      } else {
        console.log(`    ⚠️  0 records inserted (all rows rejected)`);
        console.log(`      CSV columns: ${Object.keys(rows[0] ?? {}).join(" | ")}`);
        console.log(`      First row sample: ${JSON.stringify(rows[0] ?? {}).slice(0, 300)}`);
        overallErrors.push(`${report.name}: 0 of ${rows.length} rows inserted`);
      }
      if (errors.length > 0) {
        errors.slice(0, 10).forEach((e) => console.log(`    ⚠️  ${e}`));
        if (errors.length > 10) console.log(`    ⚠️  ...and ${errors.length - 10} more errors`);
        overallErrors.push(...errors.map((e) => `${report.name}: ${e}`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ✗ ${msg}`);
      overallErrors.push(`${report.name}: ${msg}`);
    }

    console.log();
  }

  console.log("=== Summary ===");
  if (overallErrors.length > 0) {
    console.error(`❌ Finished with ${overallErrors.length} error(s):`);
    overallErrors.forEach((e) => console.error(`   - ${e}`));
    process.exit(1);
  } else {
    console.log("✅ All reports processed successfully.");
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
