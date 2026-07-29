# Medallion License Sync

Local Node.js sync for the provider licensing tracker in Supabase project `wzwdcqozkmlaicjiompe`.

Run the provider licensing tracker SQL migration before using this script.

## What It Does

1. Loads the two target providers from `public.providers`: Genevieve Teetie and Rebecca Keuch.
2. Fetches Medallion org providers and saves matching Medallion provider IDs into `providers.medallion_provider_id`.
3. Fetches every page from `GET https://api.medallion.co/api/v1/org/licenses?limit=200`.
4. Filters Medallion licenses to the two target providers.
5. Upserts direct RN/NP licenses into `public.provider_licenses` on `(provider_id, state_code, license_type)`.
6. Adds `source = 'multistate_compact'` active RN rows for compact states when the provider has a compact `home_state` and no direct RN license exists for that state.

The script logs a JSON summary:

```json
{
  "inserted": 0,
  "updated": 0,
  "skipped": 0,
  "unmapped_statuses": []
}
```

Additional detail is included under `medallion`, `compact`, and `provider_mappings`.

## Run Once Locally

```bash
cd /Users/maddiswanagan/Scheduling/vitableclinops/scripts/medallion-license-sync
cp .env.example .env
npm install
```

Fill in `.env` with:

- `MEDALLION_API_KEY`
- `MEDALLION_ORG_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

This package uses Node 20's native `fetch`, so there is no `node-fetch` dependency.

Then preview without writing:

```bash
npm run dry-run
```

Run the sync:

```bash
npm run sync
```

## Scheduling Later

For a low-frequency daily sync, the simplest reliable option is a GitHub Actions cron that runs this Node script with repository or environment secrets. It keeps credentials in one place, produces easy-to-read run logs, and does not require turning this local script into an Edge Function.

Supabase `pg_cron` plus an Edge Function is a good option if you want the workflow fully inside Supabase, but it adds deployment and secret-management steps. I would use GitHub Actions first for this daily internal sync, then move to an Edge Function only if you want tighter Supabase-native observability or webhook-style reuse.
