# Monthly Scheduling SOP

Last updated: 2026-06-03

Target: scheduling operations can be run by at least two trained team members by 2026-06-30. Maddi should remain a reviewer/escalation path, not the only person who can operate the system.

## Scope

This SOP covers the monthly scheduling hub workflow for medical and mental health providers:

- Pulling availability from Jotform.
- Reviewing unmatched or resubmitted availability.
- Running schedule evaluation.
- Reviewing readiness, priority, coverage, and declined-hour explanations.
- Publishing accepted shifts to Homebase and EHR.
- Tracking missing-provider outreach.
- Documenting exceptions and admin-only provider exemptions.

## Primary Roles

- Scheduling operator: runs the workbench, sends reminders, records outreach, publishes shifts.
- Scheduling reviewer: reviews exceptions, coverage gaps, and needs-review rows before publish.
- Clinical reviewer: confirms clinical lead, MD-only, licensure, or mental health edge cases.
- Data owner: fixes sync issues with Jotform, Metabase, provider rates, or utilization inputs.

## Source Systems

- Jotform: provider availability submissions and unavailable dates.
- Provider directory: provider email, profession, employment type, source, active status, scheduling outreach exemption.
- Provider pay rates: current hourly rates used for scheduling priority.
- Provider utilization: recent utilization percentage measured for visibility and outreach only, unless an explicit recalculation override enables it.
- State eligibility view: allocation-eligible states and license-source evidence.
- Demand forecast: monthly state/service-line demand targets.
- Homebase and EHR: final posting destinations.

## Monthly Workflow

1. Confirm data sync health.

   - Check that Jotform submissions are landing in the expected target month.
   - Check Metabase sync freshness for provider utilization, rates, active states, and demand inputs.
   - If Metabase credentials rotate, update the environment-backed secret rather than hardcoding the password.

2. Open the scheduling workbench for the target month.

   - Start in Readiness.
   - Confirm no unexpected missing-submission, unmatched, needs-review, or coverage warnings.
   - Use the Mental Health route for MH coach and therapy/LPC providers.

3. Review availability.

   - Submissions: confirm latest provider submissions are present.
   - Resubmits: resolve content-changing resubmissions.
   - Unmatched: match providers by name/email, paying attention to known aliases.
   - Setup: confirm onboarding readiness before accepting availability.
   - Missing: select providers, open a BCC reminder draft, then use Mark selected sent after the email is actually sent.
   - Time Off: review unavailable date ranges before filling coverage gaps.

4. Recalculate schedule.

   - Run Recalculate schedule after syncs or manual corrections.
   - Confirm the evaluator generated per-shift recommendations.
   - Published shifts should preserve Homebase/EHR completion state unless the shift changed or disappeared.

5. Review priority and matching.

   - Clinical leads are prioritized first.
   - After clinical leads, lower hourly rate remains the main cost signal across internal and DirectShifts/access providers.
   - DirectShifts/access providers target roughly 25% of accepted telehealth appointment volume when eligible supply exists.
   - DirectShifts/access providers with the same rate should receive a similar accepted percentage of submitted forecastable hours.
   - A 75% submitted-hours soft cap redistributes additional hours to eligible peers before allowing over-cap allocation.
   - Utilization is measured for visibility and outreach only unless explicitly enabled for recalculation.
   - Brittney Afram keeps the DirectShifts compatibility key only as a final tie-break after rate and equity rules.
   - Priority never overrides licensure, MD-only state policy, unavailable dates, mental health service-line routing, or clinical lead priority.

6. Review coverage and declined hours.

   - Coverage Gaps: verify underserved states/service lines before publishing.
   - Declined Hours: review why hours were cut, especially oversupply trims, unavailable dates, business-hour policy, 12-hour break rules, and provider meeting blackout handling.
   - Audit: use staff-readable explanations to validate the system's decision before manual overrides.

7. Publish.

   - Publish Homebase first, then EHR.
   - Mark each per-shift publish step as complete in the workbench.
   - Use bulk mark only after verifying the set of shifts in that provider/day group.
   - Keep reviewer signoff for any manual exceptions.

## Missing-Provider Outreach

- The Missing tab excludes providers marked `scheduling_outreach_exempt`.
- Use BCC for bulk reminders so providers do not see each other.
- Opening a mailto draft does not count as contact.
- After sending the email from the mail client, click Mark selected sent.
- The outreach log records provider, email, target month, subject, body, sender, and sent timestamp.

## Admin-Only Providers

Providers such as Kate Baron and Seth Dinowitz may be admin-only and not expected to submit monthly availability.

Profile indicator:

- `providers.scheduling_outreach_exempt = true`
- `providers.scheduling_outreach_exemption_reason` explains why they are excluded.

Admin-only providers are excluded from missing-submission counts, publish gates, and contact lists.

## Standing Exceptions

- Richard Rash: route through the mental health therapy/LPC service-line forecast, not the telehealth allocator.
- Margo / Margaret Mulgrew: treat Margo and Margaret as the same provider for matching; route to therapy/LPC.
- Shashai: verify active licensure and EHR readiness before publishing shifts.

Keep new exceptions in the workbench Exceptions tab and update this SOP when an exception becomes a repeatable rule.

## Troubleshooting

- Submitted shifts missing or phantom dates appearing: inspect Jotform target-month parsing, submission timestamps, provider local time display, and schedule slot date generation.
- Wrong reminder date in email: verify the template uses the selected target month/cycle date, not a hardcoded date.
- Metabase sync stopped: verify the environment credential and rerun the sync; do not commit rotated passwords.
- Mental health slots look wrong: MH shifts are built in 2.5-hour base blocks; EHR visit slots should remain back-to-back with charting buffers accounted for in shift capacity.
- Late booking complaints: verify provider scheduling preferences for timezone, late-booking notice hours, and booking cutoff minutes.

## Completion Checklist

- Jotform sync healthy.
- Metabase sync healthy.
- Missing outreach sent and marked.
- Needs-review rows resolved.
- Unmatched submissions cleared or documented.
- Exceptions reviewed.
- Coverage gaps reviewed.
- Homebase publish complete.
- EHR publish complete.
- Audit notes reviewed for any manual overrides.
