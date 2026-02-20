
# Data Integrity & Identity Unification

## The Core Problem

The platform currently has two parallel ways to represent the same person:
- A **profile record** (the source of truth in the directory)
- **Denormalized text fields** in agreements, tasks, and transfers (e.g., `physician_name`, `provider_email`)

This means Seth Dinowitz and Kate Baron exist as real profiles, but when an agreement is created or imported, it only stores their name and email as text — there is no FK (`physician_id` / `provider_id`) pointing back to their actual profile record. This is why some agreements show "Unknown" for the physician, and why you cannot click from an agreement into a person's profile.

From the database:
- **85 out of 86 `collaborative_agreements`** have a NULL `provider_id`
- **6 agreements** have a NULL `physician_id` (the "Unknown" ones)
- **73 out of ~80+ `agreement_providers` rows** have a NULL `provider_id`
- All of these have matching profiles in the database — they just were never linked

---

## What This Plan Does

### Part 1 — Backfill existing FK links (data repair)
Run SQL updates to populate all missing `physician_id` and `provider_id` foreign key columns by matching on email. This is purely a data operation that does not change any schema or code.

```text
Affected rows:
  collaborative_agreements.physician_id   — 4 agreements where physician email matches a profile
  collaborative_agreements.provider_id    — 73 agreements where provider_email matches a profile
  agreement_providers.provider_id         — 73 junction rows where provider_email matches a profile
```

This immediately fixes the "Unknown" physician display on agreement cards.

### Part 2 — Upgrade the Agreement Wizard: Physician step → Physician Directory Lookup

The current wizard's "Physician Info" step is a free-text form (name, email, NPI) that creates agreements with no FK link. It must become a **directory-first picker**:

- Replace the text inputs with a searchable dropdown of profiles who have a physician profession (`MD`, `DO`)
- Pre-populate name, email, NPI automatically from the selected profile
- Store `physician_id` (the profile's UUID) on the agreement at creation time
- Keep a manual override option only for external physicians not yet in the system (with a clear warning)

### Part 3 — Enforce `physician_id` write-back in `createAgreementWithTasks`

Currently the `handleSubmit` in `AgreementWizard.tsx` does not pass `physician_id` into the agreement data object. The workflow hook must be updated to:
- Accept `physicianId` from the form
- Write it to `collaborative_agreements.physician_id` on insert

### Part 4 — Provider selection: enforce profile-linked selection

The current `ProviderSelectionStep` already fetches from `profiles` and records `id` — this is mostly correct. However:
- The "Add Manually" option (no `id`) must be removed or blocked with a warning
- The form must require that at least one provider has a proper `id` (profile UUID)

This ensures `agreement_providers.provider_id` is always populated on new agreements.

---

## Technical Details

### Data Repair SQL (run as data updates, not migrations)

```sql
-- 1. Backfill physician_id on collaborative_agreements
UPDATE public.collaborative_agreements ca
SET physician_id = p.id
FROM public.profiles p
WHERE LOWER(p.email) = LOWER(ca.physician_email)
  AND ca.physician_id IS NULL;

-- 2. Backfill provider_id on collaborative_agreements (direct column)
UPDATE public.collaborative_agreements ca
SET provider_id = p.id
FROM public.profiles p
WHERE LOWER(p.email) = LOWER(ca.provider_email)
  AND ca.provider_id IS NULL
  AND ca.provider_email IS NOT NULL;

-- 3. Backfill provider_id on agreement_providers junction table
UPDATE public.agreement_providers ap
SET provider_id = p.id
FROM public.profiles p
WHERE LOWER(p.email) = LOWER(ap.provider_email)
  AND ap.provider_id IS NULL;
```

### Code Changes

**`src/components/agreements/wizard/PhysicianInfoStep.tsx`**
- Query `profiles` where `profession IN ('MD', 'DO')` using `useQuery`
- Render a searchable combobox/select of physician profiles
- On selection, auto-fill `physicianName`, `physicianEmail`, `physicianNpi`, and expose the new `physicianId` field
- Add a "Not in directory?" escape hatch (manual entry) with a visible warning that a profile should be created first

**`src/components/agreements/AgreementWizard.tsx`**
- Add `physicianId: string | null` to `AgreementFormData`
- Pass `physician_id: formData.physicianId` in the `handleSubmit` agreement data object

**`src/hooks/useAgreementWorkflow.ts` → `createAgreementWithTasks`**
- Accept `physician_id` in the `agreementData` object (it already passes through as-is, just needs to not be stripped)

**`src/components/agreements/wizard/ProviderSelectionStep.tsx`**
- Remove or disable the "Add Manually" button (or wrap it with a prominent warning: "Manual providers will not be linked to a profile — use directory search instead")

---

## Sequence of Changes

```text
Step 1: Run data backfill SQL (3 UPDATE statements) — fixes existing "Unknown" display
Step 2: Update PhysicianInfoStep — directory picker replaces free-text
Step 3: Update AgreementWizard form data type + handleSubmit to pass physician_id
Step 4: Disable/warn on manual provider entry in ProviderSelectionStep
Step 5: Verify by creating a new test agreement with Seth Dinowitz → Kate Baron
```

No schema migrations are required. All changes are data updates and UI code changes only.
