# Scheduling Workbench: UI/UX Brief for Lovable (v2)

This brief tells you how the Scheduling Workbench should look and feel. It pairs with the technical brief (`scheduling-workbench-coding-agent-brief.md`) which covers the data model, Edge Functions, and recommendation engine.

The user is a single-operator clinical operations manager. She uses this app every day, often for hours at a time, sometimes through stress. The current version of the app feels overwhelming. The goal of this redesign is to make the work feel calm, focused, and obvious.

---

## The Two Scheduling Branches

Read this section first. It is the most important framing in the brief.

Vitable's scheduling work runs on two parallel branches, not one. Both happen every day, sometimes in the same hour:

### Branch 1: Monthly Cycle (Plan)
A batch process that produces the next month's schedule. Runs on a recurring monthly cadence:

1. Forecast next month's demand
2. Collect provider availability via Jotform (1st of the month, due by end of week 1)
3. Build the proposed schedule for next month
4. Fill remaining gaps via outreach
5. Publish the entire next month's schedule into Homebase and the EHR (one batch event)

This is what the user means when she says "today we want to figure out what of the June schedule we should accept and post."

### Branch 2: As-Needed (Operate)
Real-time work on the currently active month. No fixed cadence, happens continuously:

- Last-minute additional hour requests from providers
- Edits to already-published shifts
- Daily coverage triage (zero or critical states)
- No-shows and last-minute cancellations
- Time-off requests

This is what the user means when she says "we have people asking for last-minute additional hours in May" while working in early May.

### Why this matters for the design
- **Tabs are not all equal.** Forecast, Build, Publish are Plan-context. Coverage is Operate-context. Build is shared (works for any month). Inbox is universal (incoming work for either branch).
- **There is no weekly scheduling cadence.** Homebase forces per-week publish clicks because of how its product works, but that is a mechanic, not a workflow. The Publish tab is a single monthly action.
- **The user flips between branches all day.** Context indicators must always show which month and which branch the current view applies to.

Every screen below is annotated with which branch it serves.

---

## Design Philosophy

Five principles. Apply them everywhere.

1. **Workbench, not dashboard.** Every screen is a place to do work, not just look at numbers. Every view answers "what should I do here?" within two seconds.

2. **One screen at a time.** Tabs over modals. Inline editing over popovers. Side panels over new pages. The user should rarely lose context.

3. **Information density without noise.** Show a lot of data, but organize it so the eye lands on the action. Comfortable spacing, strong hierarchy, weak chrome.

4. **Status by color, action by button.** Every shift, submission, and gap has a visible status. The user should scan a screen and spot what needs attention without reading text.

5. **Calm by default.** No animations on data, no flashing alerts, no exclamation marks in copy. Use color and weight, not motion, to draw attention.

---

## App Shell

### Top navigation
A slim horizontal nav, three items:

```
[Vitable logo]   Workbench   Providers   Tools         [user avatar]
```

### Workbench tab bar
Six tabs, tagged by branch:

```
Inbox        Forecast      Build         Publish       Coverage      Archive
universal    plan          any month     plan          operate       read-only
  3
```

- The number badge on Inbox shows count of unread incoming items
- Each tab carries a quiet branch label below the tab name (small, muted)
- Tabs are clickable but URLs change so the user can deep-link

### Branch context bar (sits below tab bar)
Whenever the active tab targets a specific month, show a context bar:

```
Building schedule for:  June 2026  v      Status: 87% covered    Last sync: 2m ago
```

Or for an Operate-context tab:
```
Operating schedule for:  May 2026 (active)      Coverage today: 3 states critical
```

The month picker is a dropdown when the tab supports month switching (Forecast, Build, Publish, Archive). For Coverage it is locked to the active calendar month.

---

## Tab 1: Inbox (universal)

This is the universal incoming-work view. Submissions and requests from both branches land here. Users triage from one place.

### Layout
Two-column. Left rail filters, main area cards.

### Left rail
Group filters by branch first, then by type:

```
Planning (June 2026)
  All                    8
  New submissions        5
  Unmatched              1
  Overdue                2

Operating (May 2026)
  All                    11
  Edits to published     6
  Additional hours       3
  No-shows               1
  Time-off requests      1

History
  Resolved this week    23
```

Switching filters updates the main area without a page reload.

### Card patterns

**New submission card (Planning):**
```
+---------------------------------------------------------------+
| [PLANNING / June]  Jasmine Smith                  2 min ago   |
|                                                               |
| Submitted June availability                                   |
| 42 hrs across 14 shifts                                       |
| NP Telemedicine: 38 hrs    NP In-Home: 4 hrs                  |
|                                                               |
| [View shifts]    [Apply to recommendation]                    |
+---------------------------------------------------------------+
```

**Edit card (Operating):**
```
+---------------------------------------------------------------+
| [OPERATING / May]  Daniyel Patel             Edit  18 min ago |
|                                                               |
| Updated May availability                                      |
|                                                               |
| Diff vs published:                                            |
| + Tue 5/12  9:00am-1:00pm  (added 4 hrs)                      |
| - Thu 5/14  10:00am-2:00pm  (removed 4 hrs)                   |
| ~ Fri 5/15  was 8a-12p, now 8a-2p  (+2 hrs)                   |
|                                                               |
| [Accept all]   [Accept partial]   [Reject]                    |
+---------------------------------------------------------------+
```

**Additional hours request card (Operating):**
```
+---------------------------------------------------------------+
| [OPERATING / May]  Cassondra Hawkins         Request  1h ago  |
|                                                               |
| Asking for additional hours                                   |
| Friday May 9, 10am-2pm (4 hrs, NP Telemedicine, PA)           |
|                                                               |
| Coverage on that date: PA at 100%, no gap                     |
| Provider currently scheduled: 32 hrs of 36 submitted          |
|                                                               |
| [Approve]   [Decline]   [Suggest alternative date]            |
+---------------------------------------------------------------+
```

The decision context (coverage status, provider current load) is rendered inline so the user can decide without leaving the card.

**Unmatched card (Planning):**
```
+---------------------------------------------------------------+
| [warning icon]  Unmatched submission             5 min ago    |
|                                                               |
| Email: jjeffries+test@gmail.com                               |
| Name on form: Jamie Jeffries                                  |
|                                                               |
| This email is not in the Provider Directory.                  |
|                                                               |
| [Match to existing provider]   [Create new provider]          |
| [Dismiss]                                                     |
+---------------------------------------------------------------+
```

**Overdue providers section (Planning):**
A compact table with multi-select:

```
[x] Provider              Last submitted     Days overdue
---------------------------------------------------------
[x] Antonia Jackson       April 1, 2026      5
[x] Rebecca Keuch         March 28, 2026     9
[ ] Steve Rutagarama      April 2, 2026      4

3 selected   [Generate reminder drafts]
```

Drafts open in a side panel with copy-button-per-channel and a "Mark sent" toggle.

### Visual treatment of branch labels
Branch tags appear as small pills at the top of each card:
- **PLANNING** in blue-100 background, blue-700 text
- **OPERATING** in amber-100 background, amber-700 text

This is the only place colors are used to distinguish branches. Everywhere else, semantic colors (status, conflicts, etc.) take precedence.

### Empty state
"Inbox clear. New submissions and requests appear here."

---

## Tab 2: Forecast (Plan)

A viewer with override capability. Always anchored to the upcoming month by default. Month picker in the context bar lets the user view past forecasts.

### Layout
Single wide table. One row per state, columns for each cohort.

```
              Core   Growth   021    DE    DMV    MD Only   ...
-----------------------------------------------------------------
Pennsylvania  85h    18h      14h    .     .      .
   override    .      .       .      .     .      .
-----------------------------------------------------------------
Texas         62h    8h       12h    .     .      .
   override   70h     .       .      .     .      .   <- adjusted
-----------------------------------------------------------------
...
```

- Each cell shows weekly target hours
- Hover reveals weekday vs weekend breakdown
- Click opens an inline override editor with reason field
- Overridden cells show a small accent dot
- Below the table: alerts for >120% state increases or MH increases >5 hrs/wk

---

## Tab 3: Build (any month, mode adapts)

The most important screen. Spreadsheet that knows things.

### Mode adapts based on month lifecycle
- **Upcoming month, not yet published:** full edit mode (default for Plan work)
- **Active month, already published:** read-mostly mode, shows actual schedule with edit overlays for in-flight requests from the Operating Inbox
- **Past month:** read-only

The mode indicator sits in the context bar:
```
Building schedule for: June 2026 v   Mode: Editable   Status: 87% covered
```
or
```
Viewing schedule for: May 2026 (active) v   Mode: Read-mostly   Pending edits: 4
```

### Layout
Three columns: filters left, grid center, sidebar right.

### Top status strip (above the columns)
```
Coverage: 87%   Scheduled: 412 hrs   Target: 473 hrs   Surplus: 14 hrs   Gaps: 47 hrs
[==========================================----------]
```

### Left filter rail
- **Cohort:** Core, Growth, 021, DE, MD Only, DMV, Therapy, MH Coaching, Health Coaching, In-Home (multi-select)
- **State:** dropdown with search (multi-select)
- **Status:** All, Proposed, Accepted, Conflicts only, Gaps only, Activation needed
- **Provider classification:** 1099, Salaried, Agency (multi-select, defaults to 1099)

### The grid
Rows are providers grouped by cohort, columns are days of the month. Horizontal scroll for full month.

**Row anatomy:**
```
+---------------------------------+----------------------------------+
| Provider name                   |  M  T  W  T  F  S  S  M  T  W   |
| Cohort tag                      |  X  X  X  X  X  .  .  X  X  X   |
| 38h submitted / 32h scheduled   |                                  |
+---------------------------------+----------------------------------+
```

**Cell states:**
- Empty: dot or whitespace, no submitted availability
- Proposed shift: filled cell with start time and shift type tag
- Activation needed: dashed border, purple-100 tint, "ACTIVATION" tag corner
- Conflict: red left border, conflict reason on hover
- Edit pending (active month only): filled cell with a small pending indicator showing an in-flight edit from the Inbox

**Cell click behavior:**
Inline editor expands below the row. No modal.

```
+----------------------------------------------------------------+
| Edit shift: Jasmine Smith, June 12                             |
|                                                                |
| Start: [09:00 AM]  End: [01:00 PM]  Hours: 4                   |
| State: [Pennsylvania v]   Cohort: [Core v]                     |
| Type: [NP Telemedicine v]                                      |
|                                                                |
| Provider availability that day: 9a-1p, 2p-6p (8h total)        |
| Eligible states: PA (active), NJ (active)                      |
|                                                                |
| [Save]  [Reject shift]  [Cancel]                               |
+----------------------------------------------------------------+
```

**Cohort grouping:**
Providers grouped by cohort with collapsible headers showing scheduled vs target hours per cohort.

```
v Core      32 of 38 providers, 412 / 473 hrs scheduled (87%)
  Jasmine Smith            X X X X X . . X X X ...
  Mei Lee                  X X X X X . . X X X ...
  ...
```

**Open Shifts row (always pinned at the bottom):**
```
--- Open Shifts (47 hrs unfilled) ---
  PA Core, June 12  9a-1p  4 hrs   [Suggest providers]
  TX Growth, June 14  10a-2p  4 hrs   [Suggest providers]
  ...
```

### Right sidebar (sticky, collapsible)

**Panel 1: Coverage by state**
```
PA       ================ 92%
TX       ============---- 76%
NJ       ===============- 89%
GA       ========-------- 51%   <- low
```
Click a state to filter the grid.

**Panel 2: Activation Recommendations**
```
+----------------------------------------------+
| Activation Recommendations                   |
|                                              |
| Activate Jasmine Smith's PA license          |
| Unlocks 12 hrs across 3 dates                |
| Closes 26% of PA gap                         |
| [Approve]  [Dismiss]                         |
|                                              |
| Activate Daniyel Patel's GA license          |
| Unlocks 8 hrs across 2 dates                 |
| Closes 41% of GA gap                         |
| [Approve]  [Dismiss]                         |
+----------------------------------------------+
```

Approve converts the speculative dashed cells into real proposed shifts and creates a follow-up tracker for the manual EHR activation.

**Panel 3: Conflicts**
```
4 conflicts

Mei Lee, June 14: exceeds submitted hours
Daniyel Patel, June 19: collab expired
Steve Rutagarama, June 22: provider double-booked
Antonia Jackson, June 28: license expires during month
```

### Bulk actions (top right of grid)
- "Accept all proposed (active)" with inline confirmation
- "Regenerate" with quiet progress indicator

---

## Tab 4: Publish (Plan, monthly action)

A single monthly checklist. Three checkboxes total. The Publish event is the moment the user batch-publishes the upcoming month into Homebase and the EHR.

### Layout
One large card per upcoming month being published.

```
+---------------------------------------------------------------+
| Publishing: June 2026                                         |
|                                                               |
| [x] Homebase published          Emily Z.    Jun 1, 2:14pm    |
| [x] EHR published               Emily Z.    Jun 1, 4:02pm    |
| [ ] QA confirmed                [Mark done]                   |
|                                                               |
| Status: Awaiting QA                                           |
|                                                               |
| Notes:                                                        |
| [Sarabjeet flagged 3 slot-splitting issues to fix in EHR]     |
|                                                               |
| [+ Add note]                                                  |
+---------------------------------------------------------------+
```

- Three checkboxes only. No per-week breakdown. The user knows that Homebase requires per-week clicking; that is a Homebase mechanic, not workflow state worth tracking here.
- Each checkbox captures user and timestamp on click
- Notes section is freeform text for QA findings or post-publish issues
- A small audit log link expands a modal-free panel showing every state change for this month

### Below the active publishing card
Show recent publish events as compact rows:
```
May 2026   x Homebase  x EHR  x QA       Published April 28, 2026
April 2026 x Homebase  x EHR  x QA       Published March 27, 2026
```

These are clickable to drill into the audit log for that month.

### Empty state (no upcoming month ready)
"The next monthly publish will appear here once the schedule is built."

---

## Tab 5: Coverage (Operate, daily)

The daily live triage view. Always shows the active calendar month, today's snapshot. No month selector.

### Layout
Single sortable table, one row per state.

```
State   Target slots   Filled   Coverage   Status        Actions
-----------------------------------------------------------------
PA       42             38      90%        OK            -
TX       28             14      50%        Critical      [Suggest]
NJ       18             18      100%       OK            -
GA       12             0       0%         Zero          [Suggest]
```

- Status pills: Zero (red), Critical (orange), Low (amber), OK (green)
- Click "Suggest" to expand a list of ranked surplus providers eligible for that state
- Each suggestion has a "Generate outreach" button producing pre-filled Slack DM and SMS-friendly text

### Header strip
```
Today, May 6, 2026   |   Last refresh: 3m ago   [Refresh now]
```

### Sub-section
"Surplus today": providers who could pick up additional hours, sorted by surplus hours descending.

---

## Tab 6: Archive (read-only history)

Past months. Vertical list, each clickable to expand.

```
April 2026     Coverage 94%   8 edits   42 hrs surplus     [View]
March 2026     Coverage 89%   12 edits  18 hrs surplus     [View]
February 2026  Coverage 91%   6 edits   24 hrs surplus     [View]
```

Clicking "View" opens the read-only Build grid for that month with the publish checklist and audit log at the bottom.

---

## Providers Admin (top-level nav, separate from Workbench)

Replaces the Notion Provider Directory. Two sub-tabs: Directory and License/Collab Status.

### Directory
Editable table. Inline editing on click. Sticky filter bar at top: Status, Classification, Cohort. "+ Add provider" top right. Bulk CSV import for one-time Notion migration.

### License and Collab Status
Pivot view. Rows are providers, columns are states. Each cell shows three indicators:

```
                PA           NJ           TX           GA           ...
J. Smith        L+ C+ E+     L+ C+ E+     L+ C? E-     -            ...
M. Lee          -            L+ C+ E+     -            L+ C+ E-     ...
```

- L = License (+ valid, ! expiring soon, - expired, ? pending)
- C = Collab (+ active, ! expiring, - none, ? pending, n/a if not required)
- E = EHR active (+ activated, - dormant)

Hover for full detail. Click to open an inline editor.

A filter at the top: "Show only states with E = -" surfaces every dormant license, which feeds the Activation Recommendations engine.

---

## Visual System

### Colors
Use the existing app's Tailwind config as the base. Layer these functional roles on top:

- **Brand accent:** existing primary
- **Success / accepted / OK:** green-600 / green-100
- **Warning / gap / low:** amber-500 / amber-100
- **Error / conflict / critical:** red-600 / red-100
- **Info / proposed / submitted:** blue-600 / blue-100
- **Activation needed:** purple-500 / purple-100, dashed borders
- **Surplus:** teal-500
- **Plan branch tag:** blue-100 background, blue-700 text
- **Operate branch tag:** amber-100 background, amber-700 text
- **Neutral chrome:** slate-200 borders, slate-100 panel backgrounds, slate-700 body text, slate-500 muted text

One token per role. Do not introduce shades.

### Typography
- Existing font stack
- Page title: 20px / semibold
- Section heading: 16px / medium
- Body: 14px / regular
- Compact data: 13px / regular
- Caption: 12px / regular
- Tabular numbers for numeric columns

### Spacing
- Page padding: 32px desktop
- Card padding: 16px
- Form gap: 12px
- Tight table padding: 8px vertical, 12px horizontal
- Section gap: 24px

### Components (use shadcn/ui)
- **Button:** primary, secondary, ghost, destructive. 36px default height.
- **Tag/Badge:** small pill, 11px, subtle fill, no stroke.
- **Card:** white background, slate-200 border, 8px radius, no shadow by default.
- **Table:** zebra-free, single bottom border per row.
- **Tabs:** underline style.
- **Inline editor:** slate-50 background, slate-200 border, expands within row.

### Charts
recharts only. Use system color tokens. No 3D, no animation on data update. Always show numeric values alongside chart visuals.

---

## Patterns to Use Everywhere

### Loading
Inline skeleton, no full-screen spinner. No loader for fetches under 500ms.

### Empty
One-sentence friendly message plus next action if applicable.

### Error
Inline banner, slate-50 background with red-600 left border. One sentence, one action.

### Confirmation
Inline, not modal. Button text changes:
```
[Reject shift]  ->  [Click again to confirm]   [Cancel]
```
Holds for 4 seconds then resets.

### Toasts
shadcn's Sonner. Auto-dismiss in 3 seconds. Bottom-right. One at a time. Never for errors.

---

## Microinteractions

Three only:
1. Cell update: 150ms color fade. No bounce, no scale.
2. Tab switch: instant.
3. Inline editor expand: 100ms height transition, ease-out.

No page transitions. No hover scale on buttons.

---

## Things to Avoid

- Per-week scheduling chrome anywhere outside the Publish notes field. There is no weekly cadence.
- Conflating Plan and Operate work in the same view without branch labels
- Multiple dashboards showing variations of the same data
- Sidebar navigation deeper than two levels
- Modals for actions that affect a single row of data
- Carousel widgets, accordions inside accordions, tabs inside tabs
- Mixed icon libraries (lucide-react only)
- Decorative illustrations on empty states
- Progress percentages in more than two decimal places
- Onboarding tours, hint bubbles, blocking tooltips
- Status colors used for non-status purposes
- Em-dashes anywhere in copy
- Emoji in the UI

---

## Reference Flows

Five concrete walkthroughs to validate the design.

### Flow 1: Morning triage (both branches)
1. User opens app, lands on Inbox.
2. Sees grouped counts: Planning (June) 6 items, Operating (May) 4 items.
3. Works through Planning items first: applies 5 new June submissions to recommendation, resolves 1 unmatched.
4. Switches to Operating: accepts 2 May edits, declines 1 additional-hours request, marks 1 no-show with a follow-up.
5. Inbox is empty. Done in under 3 minutes.

### Flow 2: Building June (Plan branch)
1. User opens Build, context bar shows "Building schedule for: June 2026".
2. Coverage strip shows 87%.
3. Right sidebar Activation Recommendations shows three options.
4. User clicks "Approve" on the top recommendation. Dashed cells become solid. Coverage jumps to 91%.
5. Opens Open Shifts row, finds a 4-hour PA gap on June 12. Clicks "Suggest providers", picks Mei Lee, generates outreach.
6. Iterates until coverage is acceptable.
7. Switches to Publish. Three checkboxes wait. User publishes Homebase manually (separate tool), returns and clicks "Mark done" on Homebase row.
8. Repeats for EHR and QA over the next day or two.

### Flow 3: Handling an additional-hours request (Operate branch)
1. User receives notification that a card landed in Inbox.
2. Opens Inbox, filters to Operating > Additional hours.
3. Sees Cassondra Hawkins requesting Friday May 9, 10am-2pm in PA.
4. Card shows inline: PA is at 100% coverage that day, Cassondra is at 32 of 36 submitted hours.
5. User clicks "Decline" with one click. Inline confirmation. Sent.
6. Card collapses. Done in 30 seconds.

### Flow 4: Daily coverage triage (Operate branch)
1. User opens Coverage tab mid-morning.
2. Three states are critical or zero.
3. User clicks "Suggest" on TX (Critical, 50% coverage).
4. Sees three eligible surplus providers ranked.
5. Clicks "Generate outreach" on the top provider. Side panel produces Slack DM draft.
6. User copies, sends, marks "Sent" in panel.
7. Repeats for the other two states. Done.

### Flow 5: Closing out a planning cycle (Plan branch)
1. User has finished building June.
2. Opens Publish. Card shows "Publishing: June 2026" with three empty checkboxes.
3. User publishes Homebase week-by-week in Homebase itself (Homebase forces this), returns and clicks "Mark done" on Homebase. Timestamp captured.
4. Publishes EHR day-by-day in the EHR itself, returns and clicks "Mark done" on EHR.
5. Pings Sarabjeet in Slack to QA. Sarabjeet eventually clicks "Mark done" on QA.
6. June moves to "Recently published" list. Audit log captures everything.

---

## Final Notes for Lovable

If you have to choose between adding a feature and removing one, remove. The previous version of this app accumulated complexity until the user could not navigate it.

Build the Inbox first, then Build, then everything else. The Inbox and Build tabs are 80% of the value. Both must clearly support the two-branch model from the start.

When you encounter ambiguity, default to the simpler option and surface the question in conversation, not in the UI.
