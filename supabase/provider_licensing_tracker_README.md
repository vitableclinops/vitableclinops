# Provider Licensing Tracker

This schema is for the Supabase project `wzwdcqozkmlaicjiompe`. It is intended to be run manually in the Supabase SQL editor from `supabase/manual/20260721180511_provider_licensing_tracker.sql`; it does not include any anon or service role keys.

Do not move this into the auto-applied `supabase/migrations/` folder for the main ClinOps project without reconciling the existing `public.providers` schema first.

## Tables

- `states`: all 50 states plus DC. `is_nurse_compact` marks fully implemented Nurse Licensure Compact states where an active multistate RN license currently grants practice privilege. `is_aprn_compact` marks states that have enacted the APRN Compact.
- `providers`: one row per clinician. `home_state` is nullable for now and should be filled after checking Medallion for the state that issued the provider's multistate RN license.
- `provider_licenses`: one direct license row per provider, state, and license type (`RN` or `NP`). The unique key is `(provider_id, state_code, license_type)`. Compact coverage does not require synthetic rows here.
- `license_tasks`: checklist/task rows for licensing work by provider, state, license type, and step.

## Compact View

`provider_effective_licenses` returns the full provider x state x license type grid. With the two seeded providers, 51 jurisdictions, and two license types, it should return 204 rows:

```sql
select count(*) from public.provider_effective_licenses;
```

The view reports:

- `active_direct`: a matching `provider_licenses` row has `status = 'active'`.
- `active_via_compact`: no active direct row is needed because the provider's `home_state` and the target state are compact-covered.
- `in_progress`: a matching direct row is `in_progress` or `submitted`.
- `needed`: no direct row exists, or the direct row is `not_started` or `expired`.

RN compact coverage uses `states.is_nurse_compact`. Massachusetts is not flagged because NCSBN lists it as enacted but awaiting implementation, and the boolean is being used for current coverage.

NP compact coverage uses `states.is_aprn_compact`, but the view only activates APRN compact coverage once at least seven states are flagged, because NCSBN says the APRN Compact becomes operational at that threshold. As seeded, Delaware, North Dakota, South Dakota, and Utah are flagged, so `aprn_compact_operational` is currently false.

## Access

RLS is enabled on all four tables. The migration only creates read/write policies and grants for `service_role`, and revokes table/view access from `anon` and `authenticated`. The view is created with `security_invoker = true` so it follows the underlying table access model.

Sources checked July 21, 2026:

- [NCSBN/NurseCompact NLC map PDF](https://www.nursecompact.com/files/NLC_Map.pdf)
- [NCSBN South Dakota APRN Compact announcement](https://www.ncsbn.org/news/south-dakota-enacts-aprn-compact)
