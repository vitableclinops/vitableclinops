# Scheduling Cross-Training Guide

Last updated: 2026-06-03

Goal: by 2026-06-30, at least two non-Maddi team members can run the monthly scheduling workflow end to end, with Maddi acting as reviewer or escalation support.

## Training Outcomes

Each trained operator should be able to:

- Explain the monthly scheduling workflow from availability intake to Homebase/EHR publish.
- Identify the source of truth for submissions, rates, utilization, licensure, and demand.
- Run the scheduling workbench for medical and mental health scopes.
- Resolve unmatched submissions and resubmissions.
- Send and mark missing-provider outreach.
- Review priority ordering, coverage gaps, declined hours, and audit explanations.
- Recognize exceptions that require clinical or data-owner review.
- Publish shifts and verify audit tracking.

## Training Matrix

| Skill | Trainee observes | Trainee performs with support | Trainee performs solo | Signoff owner |
| --- | --- | --- | --- | --- |
| Jotform sync and availability review | Week 1 | Week 2 | Week 3 | Scheduling reviewer |
| Missing-provider outreach and mark-sent tracking | Week 1 | Week 2 | Week 3 | Scheduling reviewer |
| Resubmission and unmatched-provider review | Week 1 | Week 2 | Week 4 | Scheduling reviewer |
| Recalculate schedule and read audit notes | Week 1 | Week 3 | Week 4 | Maddi or scheduling reviewer |
| Priority/rate/utilization review | Week 2 | Week 3 | Week 4 | Data owner |
| Coverage gaps and declined-hour review | Week 2 | Week 3 | Week 4 | Clinical reviewer |
| Homebase and EHR publish | Week 2 | Week 3 | Week 4 | Scheduling reviewer |
| Exception documentation updates | Week 2 | Week 3 | Week 4 | Scheduling reviewer |

## June 2026 Ramp Plan

### Week 1: Walkthrough

- Maddi or the current operator walks through the workbench.
- Trainees observe one real month in Readiness, Availability, Matching, Coverage Gaps, Publish, Declined Hours, Exceptions, and Audit.
- Trainees identify which data source powers each tab.
- Trainees shadow missing-provider outreach but do not send.

### Week 2: Supported Operation

- Trainees run Availability review with support.
- Trainees prepare BCC outreach, send from the mail client, and click Mark selected sent.
- Trainees review admin-only providers and explain why they are excluded.
- Trainees review Richard Rash, Margo/Margaret, and Shashai exceptions.

### Week 3: Controlled Ownership

- Trainees run the workbench for a target month.
- Reviewer checks before recalculation, after recalculation, and before publish.
- Trainees explain accepted, declined, and needs-review decisions using Audit notes.
- Trainees publish a small provider/day batch to Homebase and EHR with reviewer confirmation.

### Week 4: Solo Dry Run and Signoff

- Trainees run the monthly checklist without step-by-step prompting.
- Reviewer samples source syncs, priority ordering, coverage gaps, outreach log, and publish audit.
- Any gap becomes a follow-up training task before 2026-06-30.

## Operator Checklist

- I can tell whether I am in medical scheduling or mental health scheduling.
- I know which month I am operating on and can verify the target month in source data.
- I can explain why an admin-only provider is excluded from missing outreach.
- I can send a BCC outreach email and mark it sent in the workbench.
- I can explain clinical lead, hourly-rate, and utilization priority ordering.
- I can identify when Brittney Afram's DirectShifts compatibility key matters and when it does not.
- I can explain why licensure, MD-only state policy, unavailable dates, and clinical lead priority override rate/utilization sorting.
- I can identify MH coach and therapy/LPC scheduling behavior.
- I can document a new exception without hiding it in personal notes.
- I can publish shifts and confirm Homebase/EHR audit entries.

## Backup Coverage Model

- Primary operator: owns the monthly run.
- Backup operator: shadows every monthly run and can take over within one business day.
- Reviewer: signs off on coverage gaps, exceptions, and publish readiness.
- Data owner: owns sync failures, Metabase credential rotation, provider rates, utilization, and demand input fixes.

No monthly run should depend on one person's local notes or memory. Repeatable edge cases belong in the Exceptions tab and in the SOP.

## Signoff Record

| Trainee | Observed run | Supported run | Solo dry run | Signed off by | Date |
| --- | --- | --- | --- | --- | --- |
| TBD |  |  |  |  |  |
| TBD |  |  |  |  |  |

## Escalation Guide

- Data is missing or stale: data owner.
- Licensure, MD-only, or clinical lead ambiguity: clinical reviewer.
- Provider says their timezone or booking cutoff is wrong: scheduling reviewer updates provider scheduling preferences.
- Email was sent but not marked: operator records it in Missing tab as soon as discovered.
- New recurring edge case: add it to Exceptions and update the SOP.
