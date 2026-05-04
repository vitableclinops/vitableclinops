# Supabase — provider data + activation candidate ranking

This directory holds the schema and seed tooling for the ClinOps provider
operational store. Replaces the Lovable / ClinOps Hub setup so we can run on
a Supabase project that has a BAA.

Project: `https://bbquooftytwprllipcsb.supabase.co`

## Layout

```
supabase/
├── migrations/                         # Apply in numeric order — see below.
│   ├── 0001_create_providers.sql
│   ├── 0002_create_provider_licenses.sql
│   ├── 0003_create_provider_utilization_daily.sql
│   ├── 0004_get_activation_candidates.sql
│   └── 0005_enable_rls.sql
└── seed/
    ├── seed_providers.py               # Idempotent CSV → REST upsert.
    ├── providers.csv.example
    └── licenses.csv.example
```

## Apply migrations (one-time setup)

The migration files are SQL recipes — they don't take effect until you run
them against the database. Easiest path: paste each one into Supabase's
web SQL Editor.

1. Open <https://supabase.com/dashboard> and click into the **clinopsworkflows**
   project.
2. In the left sidebar, click the **SQL Editor** icon (looks like `</>`).
3. Click **New query**.
4. Open `migrations/0001_create_providers.sql` from this repo. Copy the entire
   file. Paste into the SQL Editor. Click **Run** (bottom-right). Should say
   "Success. No rows returned."
5. Repeat for `0002`, `0003`, `0004`, `0005` — five files, five paste-and-runs,
   in that order.
6. Verify: click **Table Editor** in the sidebar. You should see
   `providers`, `provider_licenses`, and `provider_utilization_daily`.

If a migration errors, stop and read the message — it's almost always a
missing prior migration (e.g. running `0002` without `0001`).

## Seed providers + licenses

After the tables exist, populate them with real provider data.

1. Copy the example CSVs and fill them in:

   ```bash
   cp supabase/seed/providers.csv.example supabase/seed/providers.csv
   cp supabase/seed/licenses.csv.example  supabase/seed/licenses.csv
   ```

   The `.gitignore` keeps real rosters out of the repo.

2. Get the **service-role** key from Supabase: Project Settings → API →
   `service_role` (NOT the anon key — service_role bypasses RLS so the
   seed can write).

3. Run the seed script:

   ```bash
   export SUPABASE_URL=https://bbquooftytwprllipcsb.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
   pip install -r requirements.txt
   python supabase/seed/seed_providers.py \
     --providers supabase/seed/providers.csv \
     --licenses  supabase/seed/licenses.csv
   ```

   Re-running is safe: providers upsert on `email`, licenses on
   `(provider_id, state)`.

## Provider utilization sync

The `provider_utilization_daily` table is populated by a separate nightly
job at 4 AM Central — see `.github/workflows/sync-provider-utilization.yml`
and `src/sync_provider_utilization.py`. Until you configure the Metabase
card IDs (`METABASE_DAILY_UTIL_CARD_ID`, `METABASE_5WK_UTIL_CARD_ID`) as
GitHub Actions variables, the table stays empty and
`get_activation_candidates` ranks every candidate as if utilization were 0
(highest priority). That's fine for bootstrap.

## RPC: get_activation_candidates

Replaces the Lovable `suggest-activation-candidates` edge function.

```sql
select * from get_activation_candidates(
  deficit_states    := array['PA','NJ'],
  util_threshold    := 70,
  candidate_limit   := 5,
  shift_type_filter := array['NP Telemedicine','MD Telemedicine']
);
```

REST/curl form:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_activation_candidates" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deficit_states": ["PA","NJ"],
    "util_threshold": 70,
    "candidate_limit": 5,
    "shift_type_filter": ["NP Telemedicine","MD Telemedicine"]
  }'
```

Ranking within each state:

1. Lowest current utilization (NULL → treated as 0, i.e. highest priority)
2. `readiness_status` — `ready` before `training` before `paused`
3. Provider name (alphabetical, for stable ordering)

## RLS posture

All three tables have RLS enabled with deny-by-default for `anon` and
`authenticated`. The service-role key bypasses RLS, which is what the
daily-report and utilization-sync jobs use. No frontend access until we add
explicit policies.
