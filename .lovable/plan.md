

## Question: Do the auto-email and Provider Message field both make sense?

**Short answer: No, having both creates confusion. Recommend removing the Provider Message field from the wizard.**

### Why they overlap awkwardly

| | Auto-sent Initiation Email | Provider Message field |
|---|---|---|
| **When** | Fires automatically on agreement creation | Saved to record, never auto-sent |
| **Recipient** | NP + Physician (both) | None — admin reference only |
| **Content** | Vitable-branded template with state-specific statute language | Free-text from admin |
| **Purpose** | Officially notify the parties | ??? — currently just sits on the record |

The auto-email already covers the actual job (notifying the provider that their agreement is being set up). The Provider Message field was useful **before** the auto-email existed, but now it's a vestigial input that:
- Adds a step to the wizard with unclear purpose
- Gets shown on the agreement detail page but never reaches the provider unless an admin manually copies it into an email
- Could lead admins to think they've messaged the provider when they haven't

### Recommended change

**Option A (recommended): Remove the Provider Message field entirely from the wizard.**
- Delete the textarea + template selector from `ReviewStep.tsx`
- Keep the `provider_message` DB column for now (it's used by `TerminationDialog.tsx` for transfer notes — that's a legit different use case)
- Keep the display block on `AgreementDetailPage.tsx` so existing data still renders, but no new agreements will populate it from the wizard

**Option B (if you want to keep manual messaging): Repurpose it as "Internal notes for this agreement"** — relabel clearly so it's obviously not an email and not auto-sent.

### Files affected (Option A)

- `src/components/agreements/wizard/ReviewStep.tsx` — remove the Provider-Facing Message Card, remove template-fetching logic, remove `updateFormData` calls for `providerMessage`
- `src/components/agreements/AgreementWizard.tsx` — remove `providerMessage` from form state (or leave default `''` for safety)
- `src/hooks/useAgreementWorkflow.ts` — stop passing `providerMessage` on creation (line 236)

No DB migration needed. Transfer flow (`TerminationDialog.tsx`) keeps working unchanged.

### My recommendation

Go with **Option A**. The auto-email is doing the real work, the manual message field is a leftover from before that automation existed, and removing it makes the wizard cleaner and removes the "wait, did this get sent?" confusion you just hit.

Want me to proceed with Option A, or would you prefer Option B?

