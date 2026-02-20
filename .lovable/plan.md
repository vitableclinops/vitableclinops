
# Automated Verification Dialog, Audit Report & EHR Termination Step

## Overview

Instead of a manual checklist where you tick boxes, the "Verify & Activate" button will open a dialog that **automatically inspects the actual data** -- tasks, documents, licenses, physician capacity -- and presents a pass/fail readiness report. If everything passes, you simply click "Approve & Activate" to sign off. If anything fails, the dialog shows exactly what needs to be fixed, with links to fix it.

The same approach applies to the downloadable audit report and the new EHR deactivation step in termination workflows.

---

## Part 1: Automated Verification Dialog

When an admin clicks "Verify & Activate" on a `pending_verification` agreement, a dialog opens that runs these automated checks against live data:

| Check | Data Source | Pass Condition |
|---|---|---|
| All required tasks completed | `agreement_tasks` WHERE agreement_id + is_required | Every required task has status = 'completed' |
| Signed agreement document uploaded | `collaborative_agreements.agreement_document_url` | Field is not null/empty |
| Provider has active license in state | `provider_licenses` WHERE profile_id + state | At least one license with status = 'active' |
| Physician capacity not exceeded | `collaborative_agreements` WHERE physician_id + state + active | Count does not exceed state ratio limit from `state_compliance_requirements` |
| All signatures confirmed | `agreement_providers` WHERE agreement_id | All active providers have signature_status = 'signed' |
| Supervision meeting scheduled (if required) | `supervision_meetings` WHERE agreement_id | At least one meeting exists if state requires meetings |

Each check displays as a row with a green checkmark or red X. If all checks pass, the "Approve & Activate" button is enabled. If any fail, the button is disabled and each failing check shows what specifically is wrong.

When the admin clicks "Approve & Activate":
1. The agreement advances to `active`
2. An audit log entry is written recording the automated check results and the admin who approved
3. A toast confirms activation

**New file:** `src/components/agreements/VerificationChecklistDialog.tsx`
**Modified:** `src/pages/AgreementDetailPage.tsx` -- the "Verify & Activate" button opens this dialog instead of calling `handleAdvanceStatus` directly

---

## Part 2: Downloadable Audit Report

A "Download Audit Report" button appears in the agreement detail page header. Clicking it generates a clean, printable HTML document (opened in a new browser tab for print-to-PDF) containing:

**Section 1 -- Agreement Summary:**
- State, provider name, physician name, current status
- Start date, renewal date
- Agreement document link (clickable)

**Section 2 -- Verification Checks (from Part 1):**
- Each automated check result with pass/fail and data snapshot
- Timestamp of when verification was performed
- Name of admin who approved

**Section 3 -- Complete Task Log:**
- Every task title, status, who completed it, and when (pulled from `agreement_tasks`)
- Organized by category

**Section 4 -- Full Audit Trail:**
- Every entry from `agreement_audit_log` for this agreement, chronologically
- Includes status transitions, who performed them, and timestamps

The document includes a header with the company name, "Collaborative Agreement Compliance Report", and a generation timestamp.

**New file:** `src/components/agreements/AuditReportGenerator.tsx`
**Modified:** `src/pages/AgreementDetailPage.tsx` -- adds the download button

---

## Part 3: EHR Deactivation Step in Termination Workflow

Add a new required task to the termination task template in `useAgreementWorkflow.ts`:

- **Title:** "Deactivate provider in EHR system"
- **Description:** "Confirm the provider has been deactivated in the EHR for this state. Must be completed before termination is finalized."
- **Category:** termination
- **Priority:** urgent
- **Sort order:** 5 (after regulatory compliance check)

Every future termination will auto-generate this task. It must be marked complete before the system allows finalization.

**Modified:** `src/hooks/useAgreementWorkflow.ts`

---

## Technical Summary

| File | Change |
|---|---|
| `src/components/agreements/VerificationChecklistDialog.tsx` | New -- automated checks dialog with real-time data inspection |
| `src/components/agreements/AuditReportGenerator.tsx` | New -- generates printable HTML compliance report |
| `src/pages/AgreementDetailPage.tsx` | Wire verification dialog to "Verify & Activate" button; add "Download Audit Report" button |
| `src/hooks/useAgreementWorkflow.ts` | Add EHR deactivation task to termination template |

No database schema changes needed -- uses existing tables (`agreement_tasks`, `provider_licenses`, `state_compliance_requirements`, `agreement_audit_log`, `agreement_providers`, `supervision_meetings`).
