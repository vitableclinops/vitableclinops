# Vitable Clinical Ops — Usability Audit & User Guide

_Generated 2026-04-20 from a static review of every page in `src/pages/` plus a live crawl of the running dev server._

This one document has two halves:

1. **Part I — User Guide**: how to actually use the app, organized by role and by task.
2. **Part II — Usability Audit**: the top UX issues I found, with file paths, severity, and fix recommendations.

---

## PART I — USER GUIDE

### Roles at a glance

| Role | Who has it | What they can do |
|---|---|---|
| `admin` | You and core ops staff | Everything — state compliance, licensing, provider onboarding, ops dashboards, data imports, user roles |
| `pod_lead` | Team managers | Coverage & ops dashboards + their own pod, but not compliance / data imports / user roles |
| `provider` | NPs, RNs, LPCs, coaches | Their own tasks, licenses, onboarding, directory |
| `physician` | Supervising MD/DOs | Physician portal + collaborative agreements they are named on |

Roles come from the `user_roles` table. A single user can have multiple roles (e.g. `admin` + `pod_lead`). Admins assign roles at `/admin/roles`.

### Sign in

- URL: `/auth`
- Options: Google SSO, or email + password
- Providers who are signing in for the first time are forced through `/onboarding` before they can reach anything else (enforced in [ProtectedRoute.tsx:44](src/components/ProtectedRoute.tsx:44)).

### The main menus (sidebar groups)

The sidebar is defined in [AppSidebar.tsx](src/components/AppSidebar.tsx) — here's what each group is for:

1. **Home** — role-specific landing dashboard
2. **Providers** — directory, intake form, state × provider grid, activation queue
3. **Compliance** — states, collaborative agreements, license optimizer, data quality
4. **Coverage & Ops** — the ops "control tower" (8 pages, see below)
5. **Operations** — tasks, reimbursements, agencies, hiring, calendar
6. **Resources** — knowledge base, enhancement registry
7. **My Account** — (providers/pod leads) my licenses, my pod, edit onboarding
8. **Administration** — (admins) user roles, system settings

### Workflows by role

#### 🟦 Admin — common tasks

**"Where am I low on coverage today?"**
1. Go to **Coverage Hub** (`/admin/ops`)
2. Look at the coverage health pill at the top (ok/low/critical/zero)
3. Scroll the per-state table; red rows are states below SLA target today
4. Toggle "Week heatmap" to see the next 7 days at a glance
5. If a row says "No data," check the "Last slot import" timestamp; you may need to run sync (see next workflow)

**"I need fresh data — how do I refresh?"**
Nightly pipeline (automatic):
- 01:00 UTC — `sync-homebase` pulls shifts from Homebase API
- 02:00 UTC — `compute-availability-slots` converts shifts → slot forecasts
- 03:00 UTC — `compute-license-utilization` builds optimizer snapshots

Manual triggers:
- **System Settings → Homebase** tab → "Sync Homebase" button (one-shot pull)
- **License Optimizer** → "Recompute" button (re-runs the optimizer)
- **System Settings → CSV imports** for: SLA attainment, leftover slots, provider utilization, utilization daily, provider/licensure/supervision bulk imports

**"We need to add a new state."**
1. **States & Compliance** (`/admin/states`) → add the state
2. **State detail** (`/states/:abbr`) → set licensure rules, supervision requirements
3. Turn the state ON in the "state_activation" table (either via Ops Dashboard toggle or System Settings)
4. Wait for the next nightly pipeline, OR hit **License Optimizer → Recompute**

**"We hired a new provider."**
1. **Provider Intake** (`/admin/intake`) — collect their info
2. **Activation Queue** (`/admin/activation`) — track credentialing steps
3. **Add Provider** (`/admin/add-provider`) — creates the profile + user account
4. **Provider Grid** (`/grid`) — view their state × license matrix
5. (If NP) **Agreements** (`/admin/agreements`) — attach a collaborative agreement per state

**"What states should we grow into / scale back on?"**
→ **License Optimizer** (`/admin/license-optimizer`). The heatmap is states × dates, colored by supply/demand quadrant. KPI cards show deficit states, surplus states, wasted hours/day, avg SLA %. Recommendations panel tells you which providers to add licenses for, and which states have excess.

**"I need a leadership update."**
→ **Executive Briefing** (`/admin/executive-briefing`). High-level status cards only.

#### 🟩 Pod Lead — common tasks

- Same dashboard shortcut as admin, but Compliance and Administration groups are hidden.
- **My Pod** (`/provider/pod`) — overview of your team's utilization and task completion.
- **Coverage Hub** / **Utilization** / **SLA Aggregate** — track how your pod is performing.

#### 🟨 Provider — common tasks

- **My Dashboard** (`/provider`) — your tasks and their due dates. Click a task to open its detail view and complete it.
- **My Licenses** (`/provider/licenses`) — all your state licenses and their expirations.
- **Provider Directory** (`/directory`) — find coworkers.

#### 🟪 Physician — common tasks

- **Physician Portal** (`/physician`) — your supervision agreements and the NPs you oversee.
- **Agreements** (`/admin/agreements`) — read-only list of agreements where you're named.

### Glossary (terms you'll see everywhere)

| Term | Meaning |
|---|---|
| **Slot** | A 30-minute appointment window a provider has available. 1 scheduled hour = 2 slots. |
| **Leftover slots** | Slots that went unfilled on a given day. Two types: `historical` (actual) and `forecast` (projected from Homebase shifts). |
| **SLA** | Service Level Agreement — target % of demand we actually cover. "SLA attainment" = slots filled ÷ slots requested. |
| **State activation** | A state we're actively licensed + operating in. Rows in `state_activation`. |
| **Utilization** | % of a provider's scheduled hours that actually got booked. |
| **Collaborative agreement** | The contract between an NP and a supervising MD/DO — required in most states for NPs to practice. |
| **Pod** | A team of providers managed by a pod lead. |
| **Deficit / Surplus state** | Deficit = we're short on licensed-provider hours for the demand. Surplus = we're overstaffed. Drives optimizer recommendations. |
| **Quadrant (heatmap color)** | (high/low demand) × (high/low supply). Red = high demand + low supply. |
| **NP / RN / LPC / coach** | Provider types. NPs need collaborative agreements; RNs need state licensure only; LPCs are counselors; coaches are unlicensed. |
| **Homebase** | External scheduling system we pull shift data from via API. |
| **Metabase** | Our BI tool — the source of the CSVs you upload for historical slots/SLA. |

---

## PART II — USABILITY AUDIT

Full written audit with file paths. For the top 10 offenders see the ranked list at the bottom.

### Severity legend

- 🔴 **High** — blocks work, causes data loss, or actively confuses most users
- 🟠 **Medium** — creates friction or confusion on a specific task
- 🟡 **Low** — polish; doesn't block anyone

---

### 1. Destructive actions with no confirmation 🔴

**Where**
- [AgencyDetailPage.tsx:265](src/pages/AgencyDetailPage.tsx:265) — `deleteContact(c.id)` on click, no confirm
- [AgencyDetailPage.tsx:394](src/pages/AgencyDetailPage.tsx:394) — `deleteDocument(doc)` on click, no confirm
- [SystemSettingsPage.tsx:1088](src/pages/SystemSettingsPage.tsx:1088) — `deleteMappingMutation.mutate(m.id)` on click, no confirm

**Why it hurts**: One accidental click deletes a record permanently. There's no undo on any of these.

**Fix**: Wrap each in `<AlertDialog>` (shadcn component already in the project).

---

### 2. Silent redirects on access-denied 🔴

**Where**: [ProtectedRoute.tsx:32](src/components/ProtectedRoute.tsx:32)

**Why it hurts**: A pod_lead clicking a stray link to an admin-only page just gets redirected to `/` with no message. They think the link is broken.

**Fix**: Show a toast "You don't have access to that page" before redirecting.

---

### 3. Icon-only buttons missing `aria-label` 🟠

**Where**: Throughout — back buttons, password-eye toggle, edit/copy/download/delete icon buttons across `AgencyDetailPage`, `AdminAddProviderPage`, `TaskDetailView`, `ProviderDashboard`, etc.

**Why it hurts**: Screen readers announce "button" with no context. Mobile users can't hover to see a tooltip.

**Fix**: Add `aria-label` and `title` to every icon-only `<Button>`.

---

### 4. Submit buttons don't disable while mutation is pending 🟠

**Where**:
- [AgencyDetailPage.tsx:118-140](src/pages/AgencyDetailPage.tsx:118)
- [AdminAddProviderPage.tsx:74-160](src/pages/AdminAddProviderPage.tsx:74)
- [CollaborativeAgreementsPage.tsx](src/pages/CollaborativeAgreementsPage.tsx)

**Why it hurts**: Double-click creates duplicates. On a slow network, the user has no idea if the first click registered.

**Fix**: `disabled={mutation.isPending}` + `{mutation.isPending && <Loader2 className="animate-spin" />}`.

---

### 5. Bulk CSV imports execute with no preview 🟠

**Where**:
- [SystemSettingsPage.tsx](src/pages/SystemSettingsPage.tsx) — SLA, leftover slots, provider names imports
- [DemandForecastPage.tsx](src/pages/DemandForecastPage.tsx) — forecast CSV import

**Why it hurts**: Upload the wrong file → overwrite live operational data. No way to preview what will be inserted/updated.

**Fix**: Show "N rows will be inserted / M updated — continue?" dialog with a 5-row preview before committing.

---

### 6. Jargon with no in-app explanation 🟠

**Where**: `OpsDashboardPage`, `LicenseOptimizerPage`, `ContractorStrategyPage`, `SystemSettingsPage`

Terms used without tooltips: **SLA, leftover slots, pod lead, ICHRA, MEC, quadrant, window_type, state activation**.

**Why it hurts**: New hires and non-clinical staff are lost.

**Fix**: Add `<Tooltip>` (shadcn already available) on first mention, or link to a `/knowledge/glossary` page.

---

### 7. Loading states are inconsistent or missing 🟠

**Where**:
- [ProviderDirectoryPage.tsx](src/pages/ProviderDirectoryPage.tsx) — renders blank table while loading
- [SystemSettingsPage.tsx](src/pages/SystemSettingsPage.tsx) — many tabs show a blank card briefly
- [DemandForecastPage.tsx](src/pages/DemandForecastPage.tsx) — shows "Loading…" text, not a skeleton

**Why it hurts**: Perceived slowness. Users hit refresh thinking the page is broken.

**Fix**: Use `<Skeleton>` (shadcn primitive) matching the expected layout while `isLoading`.

---

### 8. Empty states with no guidance 🟠

**Where**: Various detail pages + `DemandForecastPage`. [OpsDashboardPage.tsx:641-653](src/pages/OpsDashboardPage.tsx:641) is actually good — use it as the template.

**Why it hurts**: Is it a bug? Is there no data? Do I need to upload something? Users can't tell.

**Fix**: Every empty state should answer three questions: _what's missing?_ / _where do I go to fix it?_ / _how long until data appears?_

---

### 9. Orphaned / duplicate pages 🟡

**Where**:
- [CompliancePage.tsx](src/pages/CompliancePage.tsx) — no route in `App.tsx`
- [DataImportPage.tsx](src/pages/DataImportPage.tsx) — functionality moved into `SystemSettingsPage`
- [StateConfigPage.tsx](src/pages/StateConfigPage.tsx) — no route

**Why it hurts**: Dead code; confusing for future devs; may contain stale logic that gets copy-pasted.

**Fix**: Delete them, or document why they're kept in the file header.

---

### 10. No client-side form validation 🟠

**Where**: [AdminAddProviderPage.tsx](src/pages/AdminAddProviderPage.tsx), [AgencyDetailPage.tsx](src/pages/AgencyDetailPage.tsx) contact form, licensure app forms.

**Why it hurts**: User submits, waits for network round-trip, gets a vague error, doesn't know which field.

**Fix**: Use `react-hook-form` + `zod` (both already in `package.json`) — give inline red outline + error message.

---

### 11. Inconsistent button vocabulary 🟡

"Save" vs "Save Document Link" vs "Update"; "Create Provider" vs "Add Provider" vs "Import Provider"; "Upload Document" vs "Add Document". Pick one verb per action class and use it everywhere.

---

### 12. Mobile responsiveness on tables 🟡

`CollaborativeAgreementsPage` has `min-w-[900px]` on the table. Dropdowns use fixed `w-[180px]`. Anything below tablet horizontal-scrolls awkwardly.

---

### 13. Inconsistent status badge styling 🟡

Some pages use `<Badge variant="default">`, others hand-roll `bg-orange-500/10`. Create one `<StatusBadge status="active|pending|inactive|error">` and use it everywhere.

---

### 14. No success feedback that persists 🟡

Toast appears for ~3 seconds then is gone. Users who glance away can't tell if their save worked. Add an inline "Saved at 14:03" indicator that lives on the page.

---

### 15. Auth page is the only unauthenticated page 🟡

If a user's session expires mid-action, they lose their form data on redirect to `/auth`. Consider preserving form state in sessionStorage and restoring after re-login.

---

### Accessibility gaps

- Icon-only buttons lack `aria-label` (see #3)
- Color-only status indicators on some state badges
- Focus ring not visible on some `<div role="button">` (and there shouldn't be a div-as-button at all)
- No `<main>` landmark on some pages — screen reader users can't skip nav

---

### Inconsistency hotspots

1. **Date formatting** — ISO strings vs "Apr 20, 2026" vs "2 days ago" all appear. Pick one formatter (e.g. `format(d, 'MMM d, yyyy')`) and use it.
2. **Number formatting** — `3.5%` vs `0.035` vs `3.5` shown for the same SLA metric in different places.
3. **Page headers** — some pages have `<h1>`, some `<h2>`, some are styled divs.
4. **"Admin" vs "Administrator"** in copy.

---

## TOP 10 FIXES TO DO FIRST

| # | Fix | File | Severity |
|---|---|---|---|
| 1 | Confirm dialog on all delete actions | `AgencyDetailPage.tsx`, `SystemSettingsPage.tsx` | 🔴 |
| 2 | Show "access denied" toast before redirect | `ProtectedRoute.tsx` | 🔴 |
| 3 | `aria-label` on every icon-only button | multiple pages | 🟠 |
| 4 | `disabled={mutation.isPending}` on all save/submit buttons | multiple pages | 🟠 |
| 5 | CSV import preview + confirm | `SystemSettingsPage.tsx`, `DemandForecastPage.tsx` | 🟠 |
| 6 | Tooltips on jargon (SLA, pods, ICHRA, leftover slots) | `OpsDashboardPage.tsx`, `LicenseOptimizerPage.tsx` | 🟠 |
| 7 | Loading skeletons instead of blank | `ProviderDirectoryPage.tsx`, `DemandForecastPage.tsx` | 🟠 |
| 8 | Standardize empty-state template (what/where/when) | everywhere | 🟠 |
| 9 | Client-side form validation (rhf + zod) | `AdminAddProviderPage.tsx`, `AgencyDetailPage.tsx` | 🟠 |
| 10 | Delete orphan pages (`CompliancePage`, `DataImportPage`, `StateConfigPage`) | those 3 files | 🟡 |

---

## Implementation note

### Session 1 — landed

- ✅ `<ConfirmDialog>` reusable component ([ConfirmDialog.tsx](src/components/ConfirmDialog.tsx))
- ✅ Destructive-action confirms: agency contact, document, unlink provider, Homebase name-mapping delete
- ✅ `ProtectedRoute` now shows a destructive toast explaining the missing role before redirecting

### Session 3 — landed

- ✅ Reusable `<CsvPreviewDialog>` in [CsvPreviewDialog.tsx](src/components/CsvPreviewDialog.tsx) — shows row count + first 5 rows + meta strip before any CSV import writes to the DB
- ✅ Wired into **SystemSettings → SLA** import — "Preview & Import" button opens dialog showing State/SLA columns, window label, row count; confirm triggers the edge function
- ✅ Wired into **SystemSettings → Slots** import — same flow, shows State/Day/Slots + window type
- ✅ Wired into **DemandForecast** CSV import — handles multi-file batches, shows flat preview of all parsed rows + file list
- ✅ **AdminAddProviderPage** converted to `react-hook-form` + `zod` — inline validation for full name, email format, provider type, NPI (10 digits when required), phone (10+ digits when present); errors appear under each field on blur
- ✅ **AgencyDetailPage** contact form converted to rhf + zod — required contact name, email format check, phone length check; replaces 6 useState hooks
- ✅ Typecheck clean, no new lint errors introduced (zodResolver casts removed cleanly)

### Session 5 — landed (2026-04-21, post-login crawl)

Live click-through of every admin page surfaced two real bugs the static audits had missed:

- 🔴 **Sidebar nav-highlight was wrong on leaf pages.** The active check was `pathname.startsWith(item.href)` — which meant every `/admin/*` page also matched the `/admin` ("Admin Dashboard") entry, so visiting Hiring Pipeline / System Settings / etc. highlighted the Admin Dashboard in the sidebar instead of the actual page. Fixed with longest-prefix-wins in [AppSidebar.tsx:181-186](src/components/AppSidebar.tsx:181).
- 🔴 **Every page had the same browser tab title.** `document.title` was never updated after initial HTML load, so all tabs/bookmarks/browser history showed "Vitable Health — Provider Operations Hub." Fixed by adding a `DocumentTitleWatcher` in [App.tsx](src/App.tsx) that maps route → title on navigation. Verified: `/admin/ops` → "Coverage Hub · Vitable Ops", `/admin/hiring` → "Hiring Pipeline · Vitable Ops", etc.

### Session 4 — landed (2026-04-21)

- ✅ `<StatusChip>` migration: replaced hand-rolled status badges in [OpsDashboardPage.tsx:227-235](src/pages/OpsDashboardPage.tsx:227), [ContractorStrategyPage.tsx:200-208](src/pages/ContractorStrategyPage.tsx:200), [DemandMatchingEnginePage.tsx:320-326](src/pages/DemandMatchingEnginePage.tsx:320), and [AgreementDetailPage.tsx:244-269](src/pages/AgreementDetailPage.tsx:244) — removes `bg-emerald-500 text-white` / `bg-success/10 text-success` duplicates and routes all status rendering through the shared chip
- ✅ `aria-label` + `title` on icon-only refresh buttons: [OpsDashboardPage.tsx:448](src/pages/OpsDashboardPage.tsx:448), [SlaAggregatePage.tsx:104](src/pages/SlaAggregatePage.tsx:104), [AdminTaskQueue.tsx:197](src/components/admin/AdminTaskQueue.tsx:197)
- ✅ Mobile responsiveness: `Index.tsx` quick-stats (`grid-cols-3` → `grid-cols-1 sm:grid-cols-3`); `HiringPipelinePage.tsx` stage summary (`grid-cols-6` → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`); fixed-width selects made responsive (`w-[170-180px]` → `w-full sm:w-[170-180px]`) on `CollaborativeAgreementsPage` (physician + meeting filters), `CalendarPage` (event type filter), `ActivationQueuePage` (state filter), `StateCompliancePage` (FPA filter)
- ✅ Typecheck clean; dev server + HMR happy, no console errors

### Session 2 — landed

- ✅ Deleted 3 orphan pages (`CompliancePage`, `DataImportPage`, `StateConfigPage`) and removed the dangling `App.tsx` import
- ✅ Shared `formatDisplayDate()`, `formatPercent()`, `formatCount()` in [src/lib/utils.ts](src/lib/utils.ts) — use these everywhere going forward
- ✅ `<StatusChip>` generic status chip in [StatusChip.tsx](src/components/StatusChip.tsx) with `toneForStatus()` mapper
- ✅ `<InfoTooltip>` component in [InfoTooltip.tsx](src/components/InfoTooltip.tsx) for jargon definitions
- ✅ Jargon tooltips on `OpsDashboardPage` table headers (Available / SLA Target / Coverage / SLA % / Status)
- ✅ Jargon tooltips on `LicenseOptimizerPage` KPI cards (Deficit / Surplus / Wasted hrs/day / Avg SLA)
- ✅ Loading skeleton (replaces "Loading…" text) + improved empty-state copy on `DemandForecastPage`
- ✅ `aria-label` + `title` on 16 icon-only buttons across 8 pages (`UserRolesPage`, `ProviderDashboard`, `AdminAddProviderPage`, `PhysicianPortal`, `ProfileSettingsPage`, `StateCompliancePage`, `TaskDetailView`, `ProviderDirectoryPage`)
- ✅ `aria-pressed` on the table/grid view toggle buttons so screen readers announce the current view

### Audit correction

The initial static audit flagged `ProviderDirectoryPage.tsx` as missing loading skeletons. That was wrong — the page already has animated card skeletons at lines 619-634 and 931-946. No fix needed.

### Still open (deferred)

- Migrating hand-rolled status badges to `<StatusChip>` across pages (StatusChip is ready, just needs call sites swapped)
- Migrating raw date strings/ISO to `formatDisplayDate()` call sites
- Standardizing button vocabulary (pick one verb per action)
- Mobile responsive fixes on tables (`min-w-[900px]`, fixed-width dropdowns)
- Full `aria-label` sweep across the remaining pages (I hit the 8 highest-traffic ones)
- Session-expired form-state preservation

The deferred items are each small/medium in isolation — the work is mostly turning new utilities into call sites. Good candidates for a follow-up "UX polish" sweep.
