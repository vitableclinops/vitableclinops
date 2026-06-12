## Goal

Turn every issue card in the Homebase Schedule reconciliation map (`/admin/homebase-schedule`, day detail) from a passive "here's what's wrong" message into an inline action so an admin can resolve or override it without leaving the page.

## Issue types and the new inline actions

Each issue card gets a row of action buttons appropriate to its type. Resolutions are persisted so the issue clears (or is visibly muted) after sync.

### 1. `missing_homebase` — approved in Lovable, no Homebase shift
- **Open in Homebase** — deep link to the Homebase scheduler for that date.
- **Mark fixed (re-sync)** — runs the Homebase sync for the affected date range and re-checks.
- **Override: ignore** — writes a reconciliation override so the issue is dismissed for that approved shift (with optional note). Audit logged.

### 2. `unmatched_homebase_employee` — Homebase shift with no linked provider
- **Link to provider…** — opens an inline combobox listing ClinOps providers. On select, we:
  - Update `homebase_employees.provider_id` for that employee, and
  - Upsert into `provider_name_mappings` so future syncs stay matched.
- **Sync now** to re-run reconciliation after linking.
- (Abiah Grant–style fixes happen here without leaving the page.)

### 3. `extra_homebase` — Homebase shift that isn't approved in Lovable
- **Request admin approval** — creates a `schedule_submissions`-style override request / agreement task assigned to the workbench admin so it can be approved into the published schedule.
- **Accept into Lovable (override)** — directly marks the Homebase shift as accepted (admin-only) for users with admin role; writes an override row tagged `accept_homebase`.
- **Open in Homebase** — to remove the shift on the Homebase side.

### 4. `time_mismatch` — same provider/day, different times
- **Accept Homebase time** — override that records Homebase as source of truth; the issue clears and the published view shows the Homebase time.
- **Accept Lovable time** — override that flags Homebase to be updated; issue downgrades to a "waiting on Homebase update" yellow chip with an Open-in-Homebase link.
- **Acknowledge / snooze** — dismiss until the next sync.

### 5. `homebase_unpublished` / `homebase_unscheduled` (yellow)
- **Open in Homebase** + **Acknowledge** (snooze until next sync).

## Data model

New table `schedule_reconciliation_overrides`:
- `issue_key` (text, unique) — deterministic key derived from `(type, date, provider_id, approved_shift_id, homebase_shift_id)` — same key used to render the card.
- `issue_type` (text, matches `ReconciliationIssueType`).
- `resolution` (text enum: `ignored`, `accept_homebase`, `accept_lovable`, `acknowledged`, `pending_admin_approval`, `mapped_employee`).
- `note` (text, nullable).
- `date_key` (date), `provider_id` (uuid, nullable), `approved_shift_id` (text, nullable), `homebase_shift_id` (text, nullable).
- `created_by` (uuid → profiles.id), timestamps.
- RLS: admin + pod_lead can read/write; service_role full. GRANTs to `authenticated` + `service_role`.

The reconciliation builder in `HomebaseSchedulePage.tsx` joins overrides by `issue_key` and either hides the issue, downgrades severity, or shows a "Resolved by <name>" footer with an "Undo" button.

## UI changes (scoped to `src/pages/HomebaseSchedulePage.tsx`)

- Extract the day issue card into `DayIssueCard` and add an `IssueActions` row.
- New `LinkEmployeeDialog` (Command/Combobox over providers).
- New `OverrideConfirmDialog` (shared) for ignore / accept-homebase / accept-lovable / acknowledge with optional note.
- Each action is a TanStack mutation that:
  1. Writes the override row (or updates `homebase_employees` + `provider_name_mappings` for the link case).
  2. Invalidates the reconciliation queries.
  3. Toasts success.
- Admin-only gating via `useAuth().hasRole('admin')` on destructive actions (accept-into-Lovable, accept-homebase-time). Pod leads can acknowledge + link employees but not override times.

## Out of scope (this pass)

- Writing back into Homebase via API (we link out instead — Homebase API write coverage isn't built yet).
- Changing the Coverage Workbench tabs; only the Homebase Schedule reconciliation map gets the inline actions.

## Files to touch

- `supabase/migrations/<new>_schedule_reconciliation_overrides.sql` — new table, GRANTs, RLS.
- `src/integrations/supabase/types.ts` — add the new table type manually (per project convention).
- `src/pages/HomebaseSchedulePage.tsx` — issue card + actions + override join.
- `src/hooks/useReconciliationOverrides.ts` (new) — fetch + mutations.
- `src/components/scheduling/LinkEmployeeDialog.tsx` (new).
- `src/components/scheduling/IssueOverrideDialog.tsx` (new).
