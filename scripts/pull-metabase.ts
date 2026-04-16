#!/usr/bin/env node
/**
 * pull-metabase.ts
 *
 * Authenticates to Metabase, downloads configured reports as CSVs,
 * saves them locally under exports/YYYY-MM-DD/, and uploads to Supabase Storage.
 *
 * Run:  node --experimental-strip-types scripts/pull-metabase.ts
 *   or: npx tsx scripts/pull-metabase.ts
 *
 * Credentials are read from <project-root>/.env.metabase
 * Copy .env.metabase.example → .env.metabase and fill in values.
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Load .env.metabase (project-root relative)
// ---------------------------------------------------------------------------

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
loadEnvFile(join(PROJECT_ROOT, ".env.metabase"));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const METABASE_URL = (
  process.env.METABASE_URL || "https://metabase.vitablehealth.com"
).replace(/\/$/, "");

const METABASE_USERNAME = process.env.METABASE_USERNAME ?? "";
const METABASE_PASSWORD = process.env.METABASE_PASSWORD ?? "";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "metabase-exports";

const EXPORTS_BASE = join(PROJECT_ROOT, "exports");

const REPORT_NAMES = [
  "SLA Attainment Rate by State",
  "Average of SLA Attainment Rate",
  "rpt_telemedicine_availability_by_state_per_day",
  "Sum of same_next_day_available_slots by state and date_actual: Day",
  "Weekly demand forecast + active members by state",
  "PCP State Coverage",
  "Provider Appointment Count",
  "Utilization Rate by Provider (5-week)",
];

// ---------------------------------------------------------------------------
// Metabase helpers
// ---------------------------------------------------------------------------

async function getMetabaseToken(): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: METABASE_USERNAME,
      password: METABASE_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`Metabase auth failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function findCardsByNames(
  token: string,
  names: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  for (const name of names) {
    const encoded = encodeURIComponent(name);
    const res = await fetch(
      `${METABASE_URL}/api/search?q=${encoded}&models=card`,
      { headers: { "X-Metabase-Session": token } }
    );
    if (!res.ok) {
      console.warn(`  ⚠️  Search failed for "${name}": ${res.statusText}`);
      continue;
    }
    const body = (await res.json()) as { data: { id: number; name: string }[] };
    const exact = body.data?.find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (exact) {
      results.set(name, exact.id);
    } else {
      console.warn(
        `  ⚠️  No exact match found for "${name}" (${body.data?.length ?? 0} partial results)`
      );
    }
  }
  return results;
}

async function downloadCSV(token: string, cardId: number): Promise<Uint8Array> {
  const res = await fetch(`${METABASE_URL}/api/card/${cardId}/query/csv`, {
    method: "POST",
    headers: {
      "X-Metabase-Session": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(
      `CSV download failed for card ${cardId} (${res.status}): ${await res.text()}`
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Supabase helper
// ---------------------------------------------------------------------------

async function uploadToSupabase(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  remotePath: string,
  data: Uint8Array
): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(remotePath, data, {
      contentType: "text/csv",
      upsert: true,
    });
  if (error) throw new Error(`Supabase upload error: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------

function toFilename(reportName: string): string {
  return (
    reportName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") + ".csv"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(`\n=== Metabase CSV Pull — ${today} ===\n`);

  // Validate required env vars
  const missing = [];
  if (!METABASE_USERNAME) missing.push("METABASE_USERNAME");
  if (!METABASE_PASSWORD) missing.push("METABASE_PASSWORD");
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    console.error("Set them in .env.metabase — see .env.metabase.example");
    process.exit(1);
  }

  // Set up local exports directory
  const exportDir = join(EXPORTS_BASE, today);
  mkdirSync(exportDir, { recursive: true });

  // Set up Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Authenticate to Metabase
  console.log("Authenticating to Metabase...");
  const token = await getMetabaseToken();
  console.log("  ✓ Authenticated\n");

  // Find card IDs by report name
  console.log("Looking up report IDs...");
  const cardMap = await findCardsByNames(token, REPORT_NAMES);
  console.log(`  Found ${cardMap.size} / ${REPORT_NAMES.length} reports\n`);

  if (cardMap.size === 0) {
    console.error("No reports found — check report names in the script.");
    process.exit(1);
  }

  // Download and save each report
  const errors: string[] = [];

  for (const [name, cardId] of cardMap.entries()) {
    const filename = toFilename(name);
    const localPath = join(exportDir, filename);
    const remotePath = `${today}/${filename}`;

    process.stdout.write(`Pulling "${name}" (card ${cardId})...`);

    try {
      const csv = await downloadCSV(token, cardId);

      // Save locally
      writeFileSync(localPath, csv);

      // Upload to Supabase
      await uploadToSupabase(supabase, SUPABASE_BUCKET, remotePath, csv);

      console.log(` ✓  (${(csv.length / 1024).toFixed(1)} KB)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` ✗  ${msg}`);
      errors.push(`${name}: ${msg}`);
    }
  }

  console.log(`\nSaved locally → exports/${today}/`);
  console.log(`Uploaded to   → ${SUPABASE_BUCKET}/${today}/`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  } else {
    console.log(`\nAll ${cardMap.size} reports pulled successfully.\n`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
