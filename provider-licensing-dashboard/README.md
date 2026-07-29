# Provider Licensing Tracker

Standalone React + Vite dashboard for the provider licensing tracker in Supabase project `wzwdcqozkmlaicjiompe`.

## Setup

```bash
cd /Users/maddiswanagan/Scheduling/vitableclinops/provider-licensing-dashboard
npm install
cp .env.example .env
```

Fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The app expects the licensing tracker migration to be applied first, including `provider_effective_licenses`, `providers`, and `license_tasks`.

## Run Locally

```bash
npm run dev
```

Vite serves the app at the URL printed in the terminal, usually `http://localhost:5174`.

## Build For Upload

```bash
npm run build
```

Upload the generated `dist/` folder, or zip it:

```bash
cd dist
zip -r ../provider-licensing-dashboard-dist.zip .
```

## Supabase Access Note

This browser app uses `VITE_SUPABASE_ANON_KEY`; it does not use a service role key. The sandbox wrapper may handle user access to the hosted app, but Supabase still needs read access to `provider_effective_licenses`, `providers`, and `states`, plus read/insert/update access to `license_tasks` for the role represented by the client token.

If the database still has the earlier service-role-only RLS policies, the UI will load with Supabase permission errors until those policies are adjusted for the sandbox role.
