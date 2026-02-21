
# Supervision Meeting Workflow Evaluation & Fix Plan

## Current State (What's Broken)

1. **Meeting cadence is not configured for any state.** The `meeting_months` field in `state_compliance_requirements` is empty (`[]`) for all 10 CA-required states. The `ca_meeting_cadence` field contains regulatory citation text (e.g., "A prescriptive authority agreement with a supervising physician"), not a usable cadence like "monthly" or "quarterly."

2. **Two disconnected meeting systems exist.** The Calendar page shows `calendar_events` (used for All-Hands), while supervision meetings live in the `supervision_meetings` table. The Calendar page filters for `event_type = 'supervision_meeting'` in `calendar_events`, but supervision meetings are never written there -- they go to a completely different table.

3. **No company-wide collaborative meetings exist yet.** The `CompanyMeetingWizard` is built and ready, but no `is_company_wide = true` meetings have been created. All 10 existing `supervision_meetings` are per-agreement, legacy-style records.

4. **Agreement detail pages show "No meeting scheduled"** because meetings are queried by `agreement_id`, but the company-wide model doesn't link meetings to individual agreements.

---

## What Needs to Happen

### Step 1: Populate Meeting Cadence for Each State

Set the `meeting_months` array for each CA-required state based on actual cadence. For example:

| State | Cadence | meeting_months |
|-------|---------|---------------|
| TX | Monthly | [1,2,3,4,5,6,7,8,9,10,11,12] |
| NC | Monthly | [1,2,3,4,5,6,7,8,9,10,11,12] |
| VA | Quarterly | [1,4,7,10] |
| AR | Quarterly | [1,4,7,10] |
| CA | Quarterly then Annual | [1,4,7,10] |
| OH, OK, PA, WV, WI, NJ, NY | TBD | Need your input |

This is a data update, not a schema change. Admins can also edit these via the existing Meeting Months Editor in the States & Compliance hub.

### Step 2: Surface Supervision Meetings on the Calendar Page

Update the Calendar page to also query and display `supervision_meetings` alongside `calendar_events`. This means:

- Fetching upcoming company-wide supervision meetings and rendering them as calendar cards
- Adding a "Schedule Collaborative Meeting" button (for admins) that opens the existing `CompanyMeetingWizard`
- Showing the provider count, RSVP status, and state breakdown for each meeting

### Step 3: Connect Agreement Detail Pages to Company-Wide Meetings

Instead of only looking for meetings by `agreement_id`, also check for company-wide meetings where the provider is an attendee. The "Supervision Meetings" section on agreement pages should show:

- The next company-wide meeting the provider is invited to
- Whether the provider has RSVPed
- The state cadence requirement (e.g., "Texas requires monthly meetings")

### Step 4: Add Provider Meeting Compliance Tracking

Create a small "Meeting Compliance" widget that shows, per provider:

- Required meetings this year (based on their most frequent state cadence)
- Attended meetings
- Next required meeting
- Compliance status (on track / behind)

This would appear on the Provider Dashboard and Agreement Detail pages.

---

## Technical Details

### Files to Change

| File | Change |
|------|--------|
| `state_compliance_requirements` (data) | Populate `meeting_months` for TX, NC, VA, AR, CA. Ask user for remaining states. |
| `src/pages/CalendarPage.tsx` | Add supervision meeting display + "Schedule Collaborative Meeting" button using `CompanyMeetingWizard` |
| `src/hooks/useScheduledMeetings.ts` | Add helper to find company-wide meetings a provider is invited to (not just by agreement_id) |
| `src/pages/AgreementDetailPage.tsx` | Update supervision meetings section to check company-wide meetings by provider attendance |
| `src/components/meetings/ProviderComplianceView.tsx` | New widget showing per-provider meeting compliance (required vs. attended) |

### No Schema Changes Required

The database already has everything needed:
- `state_compliance_requirements.meeting_months` -- exists, just needs data
- `supervision_meetings` with `is_company_wide`, `meeting_month`, `time_slot` -- all present
- `meeting_attendees` with `has_rsvped`, `rsvp_slot`, `assigned_slot` -- all present

---

## Question for You

Before implementing, I need to confirm the cadence for the remaining states. For the ones I could infer from existing meetings:

- **Texas**: Monthly (correct?)
- **North Carolina**: Monthly (correct?)
- **Virginia**: Quarterly (correct?)
- **Arkansas**: Quarterly (correct?)
- **California**: Quarterly (correct?)

For these states, what cadence should be used?
- Ohio
- Oklahoma
- Pennsylvania
- West Virginia
- Wisconsin
- New Jersey
- New York
