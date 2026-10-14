# External provider (agency) import — mapping review + dry-run importer

## Template review: changes to make before sending to the agency

The workbook is well structured (3 data sheets, stable external IDs, no example people). These adjustments are needed so it maps cleanly:

| # | Sheet / header | Issue | Change |
|---|---|---|---|
| 1 | Agreements `name` | Ambiguous (provider or supervisor?) | Rename to `supervisor_name` |
| 2 | Agreements `license_number` | Same header as Licenses `license_number`, different meaning | Rename to `supervisor_license_number` |
| 3 | Providers `agency_name` | Template assumes "DirectShift"; our agency record is **DirectShifts** | Use exact "DirectShifts" (dropdown); unknown agency names are rejected |
| 4 | Providers `profession` | Template example `health_coach`; app uses `mental_health_coach` | Dropdown: NP, RN, MD, DO, LPC, LCSW, mental_health_coach |
| 5 | Providers `employment_status` | App only has active/termed; inactive/onboarding/unknown have no local equivalent | Rename to `agency_reported_status`; stored as agency-reported only, never written to our employment status |
| 6 | Providers `employment_type` | All agency people are already "Agency-Supplied" locally | Rename to `agency_classification`; stored for reference, does not change our classification |
| 7 | Providers address block | No `country` or `address_type` on our profiles; home addresses must not sit on the shared profile | Keep headers; stored in a separate restricted address record (see below) |
| 8 | Providers | Medallion has `secondary_taxonomy`; template doesn't | Add optional `secondary_taxonomy` |
| 9 | All sheets | Dropdowns only cover rows 2–31 | Extend validation to row 1000; add 10-digit NPI and date validation |
| 10 | Licenses `status` | `superceded` (Medallion spelling) | Keep; importer also accepts `superseded` |

I will produce the corrected workbook as a file for you to send.

## Source ownership (enforced by the importer)

```text
Internal providers  -> details/licenses/agreements: Medallion (read-only to import)
External providers  -> details/licenses/agreements: verified agency import
Both groups         -> Active PCP Telemedicine States: Metabase only
Local Vitable       -> termination, employment classification, workflow stage
```

- A row whose NPI or email belongs to a Medallion-linked provider is a **conflict**, never applied.
- Termed locally stays termed; agency "active" never reactivates.
- No spreadsheet field touches coverage states or EHR records; there is no coverage column to import.

## How it works

1. **Upload** on the Provider Directory (admin-only "Agency import" button).
2. **Dry run preview** (nothing saved): per sheet — new, updated (field-by-field before/after), unchanged, missing required fields, invalid values, identity conflicts (NPI on another record, Medallion-owned provider, duplicate external IDs, license/agreement pointing to unknown provider).
3. **Import** only after review; records keyed by agency + external ID, so reimports update instead of duplicate.
4. Blank cells are skipped (never clear data); rows missing from a later file are left alone.

## Directory and Supervision views

- External providers appear in the same Directory table with a "Source: DirectShifts import" badge; internal ones keep "Medallion".
- Licensed States and license count come from validated license rows: active + verified, state registrations only (DEA/controlled not counted as states). Partial/unknown inventory shows "incomplete" instead of a definitive number; `not_applicable` with no rows shows "Not applicable".
- Supervision tab shows agency agreements alongside Medallion ones, same columns, with source shown.
- PCP coverage matching adds the external provider NPI as an identity source — Medallion membership not required. Existing scope (NP only), exclusions and termination rules unchanged.
- Addresses: practice address visible to admins/pod leads; mailing/home admin-only. Address without a type is rejected.

## Demonstration

Since the template has no real rows, the dry run will be shown with (a) the empty template (header check passes, 0 changes) and (b) a fictional test file in automated tests only — covering adds, reimport with no duplicates, blank-cell preservation, termination precedence, Medallion conflict, and NPI conflict. No real import, no publishing.

## Technical details

- New tables: `external_providers` (agency_id, external_provider_id unique; profile_id link; agency-reported fields; inventory statuses; verified_as_of/by), `external_licenses` (agency_id, external_license_id unique), `external_agreements` (agency_id, external_agreement_id unique), `external_provider_addresses` (address_type enum practice/mailing/home; RLS: practice → admin/pod_lead, others → admin), `external_import_runs` (file name, counts, diff JSON, dry_run flag). Admin-only RLS + grants.
- Pure parse/diff module in `src/lib/externalImport.ts` (SheetJS parsing, header alias map for both old and new header names) with vitest coverage; commit through a `apply-external-import` edge function that recomputes the diff server-side and applies only non-blank, non-conflicting fields.
- New profiles are created only for unmatched external providers after explicit confirmation in the preview; matching to existing profiles is by exact NPI or agency+external ID, never by name.
- `matchEhrCoverage` gains an external-NPI candidate source.
