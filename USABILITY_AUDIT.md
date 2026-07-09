# Vitable ClinOps Scheduling Platform — Usability Audit

**Audience lens:** a full-time scheduling coordinator with no engineering background, who did not build the tool, runs the same monthly workflow under time pressure, follows a written SOP, and must get it right on the first try without pinging an engineer.

**Method:** source-code audit of the app at commit `d72fc93` (verified identical to `origin/main`, so it includes the latest Lovable-synced changes, e.g. "Added manual edit badge to shifts" and "Limited amber badge to today"). The live app and its Supabase backend were unreachable from the audit environment (network policy denial), so findings are grounded in the exact rendered strings, handlers, and component logic in the code rather than screenshots. Every finding cites `file:line`. Things a code audit cannot judge — real data volume, latency, visual density at runtime — are called out where relevant.

**Where the requested screens live:**

| Requested screen | Where it is in the app |
|---|---|
| Workbench, availability tab (`/scheduling/workbench?tab=availability`) | Legacy URL; `tab=availability` maps to the **Intake** section (`SchedulingWorkbenchPage.tsx:815`) |
| Provider decisions / pending approvals | Workbench **Review** section: "Needs decision", "Resubmits", "Pending recalculation" tabs |
| License Optimizer | `/admin/license-optimizer` (`LicenseOptimizerPage.tsx`) |
| Bulk actions ("HB All" / "EHR All") | Workbench **Publish → By Provider** rows, plus "Mark HB (N)" / "Mark EHR (N)" in **Publish → Publishing Queue** |
| Locked / published shifts | Publish checkboxes in the Workbench + the read-only Homebase Schedule mirror (`/scheduling/homebase-schedule`, `/admin/homebase-schedule`) |
| Declined hours / reasons | Workbench **Coverage Plan → Cut / declined hours** tab; prior decline context also matters in **Review → Resubmits** |
| Recalculate / re-run actions | "Recalculate schedule" (Workbench header + Pending recalculation panel), "Approve & recalculate" (Resubmits), "Sync Jotform now" (Intake), "Recompute" + "Sync Homebase" (License Optimizer) |

---

## 1. Recalculate actions

### 1.1 "Recalculate schedule" fires instantly — no confirmation, no undo, and the one warning it has is hidden in a hover tooltip
- **Location:** Workbench header, `SchedulingWorkbenchPage.tsx:1760-1781`; duplicate button in the Pending recalculation panel at `:4559-4566` (no tooltip at all there).
- **What the coordinator experiences:** an ordinary-looking outline button. One click immediately re-runs the whole month's evaluator (`reevaluateNow` → `runScheduleRecalculation`, `:1634-1665`). The only explanation — "Rebuilds the recommended schedule from the latest Jotform submissions. Already-published shifts keep their Homebase / EHR state — only shifts that change or disappear lose their progress" — appears only if they happen to hover and wait 200 ms. The tooltip says nothing about manually corrected hours or hand-edited shift rows. There is no "Are you sure?", no undo; the after-the-fact diff lives in a different tab (Review → Pending recalculation).
- **Why it causes mistakes:** this is exactly the reported pain point. A coordinator who has spent an hour hand-adjusting hours can wipe that work with one click and get a *success* toast ("Recalculated July 2026 schedule · 12 provider decisions"). They discover the damage later, if at all, via the history diff. The phrase "lose their progress" in the tooltip is also ambiguous — it means the HB/EHR checkmarks, but reads like it could mean the shifts themselves.
- **Suggested fix:** replace the direct `onClick` with a confirm dialog that states, in this order: (1) "This rebuilds all of {month}'s recommended shifts from the latest submissions." (2) "N shifts currently carry a *Manually edited* flag and will be rebuilt — manual time changes will be lost unless they were entered as corrections." (3) "Homebase/EHR checkmarks are kept for unchanged shifts." Buttons: "Recalculate" / "Cancel". Keep the toast, but append "View what changed →" linking to the history diff.
- **Priority: HIGH** — used every cycle; a mistake silently destroys manual work.

### 1.2 Approving a correction triggers a full recalculation as a side effect
- **Location:** `SchedulingWorkbenchPage.tsx:1667-1705` (`handleResolveNeedsReview`); "Approve & recalculate" in the resubmission inbox, `ResubmissionInboxPanel.tsx:626-633`.
- **What the coordinator experiences:** they approve one provider's corrected hours in the Review tab; the app announces "Approved corrected hours for X. Recalculating July now." and yanks them to the recalculate tab. In the Resubmits inbox, the primary button is literally "Approve & recalculate" with no confirmation, even when the dialog's own signals card knows the change collides with already-published shifts (`ResubmissionInboxPanel.tsx:664-669` warns "Reverting Homebase / EHR is manual work" — but only as passive text, not attached to the button).
- **Why it causes mistakes:** the coordinator thinks they are approving *one person*; they are actually re-running the allocator for *everyone*, which can move other providers' hours (the history panel itself explains "when one provider gains hours, another provider can lose publishable hours", `:4273-4276`). One misclick can also overwrite published shifts that then require manual Homebase cleanup.
- **Suggested fix:** when a resubmission's signals include published-shift collisions, gate "Approve & recalculate" behind a confirm quoting the count: "Approving will overwrite 3 already-published shifts in Homebase/EHR and re-run the July schedule for all providers. Continue?" For the Needs-decision flow, add one line to the resolution dialog: "Approving with a correction re-runs the whole month's schedule."
- **Priority: HIGH.**

### 1.3 License Optimizer "Recompute" — same problem, fewer guardrails
- **Location:** `LicenseOptimizerPage.tsx:907-916`.
- **What the coordinator experiences:** a button labeled "Recompute" with a lightning-bolt icon, no tooltip, no confirmation. Success toast: "Optimization computed — N snapshots written." Nothing on screen says what it recalculates, what it overwrites, or that it must run *after* the month's CSVs are uploaded; the only explanation is inside a collapsed "How to use this page" panel that defaults closed (`:291`, `:928-935`).
- **Why it causes mistakes:** clicking Recompute before (or after a failed) CSV upload replaces good snapshot data with stale/partial data, and the coordinator then reports wrong coverage numbers to leadership. "Snapshots written" is engineer-speak — it confirms nothing meaningful to this user.
- **Suggested fix:** add subtext under the button ("Rebuilds the heatmap from the latest uploaded data — run only after uploading this month's CSVs"), a confirm dialog ("This replaces the current heatmap data. Continue?"), and a plain toast ("Heatmap rebuilt — 312 state/day rows updated").
- **Priority: HIGH.**

---

## 2. Pending / yellow-flagged shifts

### 2.1 The amber "Manually edited" flag self-destructs at midnight
- **Location:** `SchedulingWorkbenchPage.tsx:684-701` (`isShiftManuallyEdited`); rendered at `:2695-2711` and `:4759-4776`.
- **What the coordinator experiences:** a shift edited by hand gets an amber row and a "Manually edited" badge — but only if `updated_at` is *today*. Tomorrow morning, the same shift renders exactly like every system-generated shift. There is also no legend anywhere explaining what the amber row means.
- **Why it causes mistakes:** the badge exists precisely so the coordinator knows which shifts a recalculation would clobber (see 1.1) and which shifts differ from the system's recommendation. A flag that evaporates overnight defeats that purpose for a workflow that spans a week (the SOP card itself spans Mon→Fri, `:2547-2551`). The coordinator will either re-verify everything or trust nothing. The heuristic (comparing `created_at` vs `updated_at`) also can't distinguish a human edit from any backend PATCH.
- **Suggested fix:** store an explicit `manually_edited_at` / `edited_by` on the shift row when a human edits it, and show the badge permanently with hover detail ("Edited by Maddi · Jul 8, 3:12 PM"). Add a one-line legend above shift tables: "Amber rows were manually edited and will be rebuilt by Recalculate."
- **Priority: HIGH** — this flag is the linchpin for safe recalculation, and the current behavior was recently *narrowed* (commit "Limited amber badge to today"), likely to hide false positives; the fix is a real flag, not a time-window heuristic.

### 2.2 Pending resubmissions look like normal rows — the blocking reason is a dialog away
- **Location:** `ResubmissionInboxPanel.tsx:357-366` (row badges), `:594-599` (dialog explanation).
- **What the coordinator experiences:** in Review → Resubmits, a row that is Parked or Approved shows a badge; a **pending** row shows nothing. The fact that "the evaluator is gated on this group until you Approve or Park" is only stated inside the per-row dialog. Parked rows show "Parked" but not *why* (the note is dialog-only, `:582-587`), and the amber signal badges say just "off-hours" or "3 published" with no tooltip.
- **Why it causes mistakes:** the pending item silently blocks recalculation for that provider; a coordinator scanning the list sees nothing amber and moves on, then can't explain why the schedule never updated — a guaranteed support ping.
- **Suggested fix:** add an amber "Pending — blocks recalculation" badge to pending rows at `:357`; show the first line of the park note under the "Parked" badge; add tooltips to the signal badges reusing the dialog copy ("off-hours = outside 9a–9p ET weekdays; these hours get auto-trimmed").
- **Priority: HIGH.**

### 2.3 Six flavors of "not done" with no glossary
- **Location:** status vocabulary across the workbench: `Pending`, `Needs review`, `Review pending`, `Parked`, `Superseded`, `Needs recalculation` (`SchedulingWorkbenchPage.tsx:703-713`, `:3612-3627`, `:4600-4602`).
- **What the coordinator experiences:** near-synonymous badges in different tabs, each with a distinct color, none defined on screen. "Superseded" rows are also greyed *and* still listed among submissions (`:3563`).
- **Why it causes mistakes:** the coordinator can't tell which yellow-ish state requires *their* action versus a recalculation versus a ClinOps lead. They will either ask, or clear the wrong queue.
- **Suggested fix:** add tooltips to each `StatusBadge` variant with an action sentence ("Needs review → open Review tab and approve or decline"; "Superseded → replaced by a newer submission, no action"), and consolidate "Pending" vs "Review pending" into one term.
- **Priority: MEDIUM.**

---

## 3. Locked / published shifts

### 3.1 Publish checkmarks are records, not actions — and they un-check as easily as they check
- **Location:** `PublishCheckbox`, `SchedulingWorkbenchPage.tsx:2617-2658`; per-shift tables at `:2718-2741`, `:4783-4806`.
- **What the coordinator experiences:** green (Homebase) and blue (EHR) checkboxes per shift. Checking one records "this was posted in Homebase" — it does not post anything. Unchecking a published shift instantly "reverts" the record with no confirmation; the audit trail note ("marked by X · 2h ago") appears only on hover of a checked box.
- **Why it causes mistakes:** two failure modes. A new coordinator may believe checking the box *publishes* the shift (the section is called "Publish") and skip Homebase entirely; the four-step instructions card (`:8994-9020`) explains it, but is easy to skim past. Second, a stray click silently un-marks a published shift, and the completion percentages the whole team relies on (`:2259-2268`) drift.
- **Suggested fix:** relabel column headers from "Homebase"/"EHR" to "Posted in Homebase ✓" / "Entered in EHR ✓"; add a confirm on *uncheck only* ("This shift is recorded as posted by Maddi 2h ago. Mark as not posted?"). Consider making checked boxes require the confirm even for admins.
- **Priority: MEDIUM-HIGH** — used at high volume every cycle; individual errors are small but corrode trust in the tracker.

### 3.2 The Homebase Schedule mirror looks editable but is read-only — and nothing says so
- **Location:** `HomebaseSchedulePage.tsx:1335-1364` (rows have `hover:bg-muted/30` styling but no click handler, link, or edit control).
- **What the coordinator experiences:** rows highlight on hover, inviting a click. Clicking does nothing — no dialog, no toast, no error. There is no "locked" indicator because the entire table is a read-only mirror of Homebase, but that is never stated.
- **Why it causes mistakes:** the coordinator tries to fix a wrong time here, concludes the app is broken (support ping), or worse, believes their click did something. This is the exact "try to edit one without realizing it won't take effect" scenario.
- **Suggested fix:** add a caption above the table — "Read-only mirror of Homebase. To change a shift, edit it in Homebase, then click Sync Homebase." Remove the hover highlight, or make rows an explicit "Open in Homebase ↗" link.
- **Priority: HIGH.**

### 3.3 "Acknowledge" reads like a fix but is a snooze
- **Location:** `IssueActions.tsx:341-361`; the issue's fix text says "Publish this Homebase shift" (`HomebaseSchedulePage.tsx:515`).
- **What the coordinator experiences:** an unpublished-shift issue instructs "Publish this Homebase shift" and offers two buttons: "Open Homebase" and "Acknowledge" ("Snoozes this issue until the next sync" — text only in the confirm description). Clicking Acknowledge clears the yellow flag.
- **Why it causes mistakes:** the coordinator clicks Acknowledge, the flag disappears, and they believe the shift is published. It isn't; it resurfaces after the next sync, later in the cycle when it's more expensive.
- **Suggested fix:** rename the button to "Snooze until next sync" and make "Open Homebase" the visually primary action for publish-type issues.
- **Priority: HIGH.**

### 3.4 Issue-resolution buttons vanish entirely for non-admin roles
- **Location:** `IssueActions.tsx:56-58, 139-141` — renders `null` unless the user is `admin` or `pod_lead`.
- **What the coordinator experiences:** if their account is a plain provider-role (or misconfigured), they see the issue and the fix instructions but zero buttons, with no explanation.
- **Why it causes mistakes:** "the buttons in the SOP screenshot aren't there for me" is a classic first-week support ping.
- **Suggested fix:** when the role check fails, render a disabled hint instead of nothing: "Resolving issues requires admin or pod-lead access — ask an admin to update your role."
- **Priority: MEDIUM** (depends on the coordinator's actual role assignment).

---

## 4. Declined hours & decline reasons

### 4.1 The resubmission inbox loads decline data and then never shows it
- **Location:** `ResubmissionInboxPanel.tsx` (836 lines — zero references to `declined_hours` or `decision_notes`), even though the query fetches them (`useMonthlyPublish.ts:1491-1494, 1549`).
- **What the coordinator experiences:** reviewing a provider's *new* submission with no visibility into what the evaluator did with the *previous* one — whether it was declined, how many hours, or why. The single most decision-relevant fact is one join away in the data and zero pixels on screen.
- **Why it causes mistakes:** they approve resubmissions blind, or re-escalate something already resolved. This is likely a root cause of the reported "why were these hours declined?" confusion.
- **Suggested fix:** add a "Prior decision" line to the submission detail dialog: status badge + "accepted 12h / declined 8h" + the plain-language decision notes (the `formatDecisionNoteForStaff` translator at `SchedulingWorkbenchPage.tsx:3240-3285` already exists and does this well — reuse it here).
- **Priority: HIGH.**

### 4.2 The Cut/declined tab itself is decent — but the full reason still costs a click, and it's the *only* place reasons live
- **Location:** `DeclinedHoursPanel`, `SchedulingWorkbenchPage.tsx:7066-7262`; `ReasonSummary` at `:3375-3419`.
- **What the coordinator experiences:** plain-English reason *tags* ("Oversupply cut", "Outside hours", "Unavailable date") render inline — genuinely good. The sentence-level explanation is collapsed behind a tiny "Details" disclosure per row, and the fallback tag when nothing matches is a shrug ("Needs review").
- **Why it causes mistakes:** for a provider asking "why did I lose 6 hours?", the coordinator must expand row-by-row; tags alone ("Oversupply cut") aren't quotable to a provider. Minor, because the tag system is strong.
- **Suggested fix:** auto-expand the Details block when a row has ≤2 reasons; add a "Copy explanation" button per row that copies the formatted plain-English text for pasting into Slack/email to the provider.
- **Priority: MEDIUM.**

---

## 5. Bulk actions

### 5.1 "HB all" / "EHR all" — cryptic, tiny, unconfirmed, and self-relabeling
- **Location:** Publish → By Provider rows, `SchedulingWorkbenchPage.tsx:2391-2424`.
- **What the coordinator experiences:** ghost buttons (28 px tall, extra-small text) labeled "HB all" and "EHR all" — abbreviations with no tooltip. One click marks *every* shift for that provider as posted, instantly, no confirmation. Once all are marked, the same button silently becomes "Revert HB", so the identical click position now *un-marks* everything.
- **Why it causes mistakes:** exactly the reported pain point. A coordinator who clicks to "check what this does" has just claimed 15 shifts were posted to Homebase (or reverted a teammate's work — the flip-flop label means muscle memory works against them). The toast confirms after the fact, when the damage is done.
- **Suggested fix:** rename to "Mark all posted (HB)" / "Undo all HB marks"; add tooltips ("Marks all 15 of this provider's shifts as posted in Homebase — does not post anything itself"); require a confirm for the revert direction; keep the existing success toast.
- **Priority: HIGH.**

### 5.2 "Mark HB (N)" in the Publishing Queue marks N shifts across all providers, unconfirmed
- **Location:** `SchedulingWorkbenchPage.tsx:4716-4731`.
- **What the coordinator experiences:** a button whose count reflects the current filter — with the default filter ("Not posted to Homebase") and no provider typed, "Mark HB (47)" marks 47 shifts network-wide in one click. The count in the label is the only scope cue; there is no confirm and no bulk undo (reverting means per-provider "Revert HB" or shift-by-shift unchecking).
- **Why it causes mistakes:** it's positioned as the "I finished my Homebase batch" convenience, but a click at the wrong moment (before actually posting in Homebase) falsifies the entire publish tracker for the month.
- **Suggested fix:** add a confirm dialog: "Mark 47 shifts across 12 providers as posted in Homebase? Only do this after posting them in Homebase itself." Add a matching "Undo last bulk mark" toast action (the audit log already records the entries to revert).
- **Priority: HIGH.**

### 5.3 "Sync Homebase" scope is implied by two date inputs; presets change it silently
- **Location:** `HomebaseSchedulePage.tsx:853-888` (sync + date inputs), `:871-879` (quick-range buttons).
- **What the coordinator experiences:** Sync runs over whatever Start/End dates happen to be set — with **July 2026 hardcoded as the default** (see 8.1). The "July 2026 / Next 30 days / Current month" preset buttons change the range with no active-state highlight, and there's no pre-sync summary or confirmation.
- **Why it causes mistakes:** syncing the wrong month, or re-syncing repeatedly because nothing indicated the first sync's scope. The per-issue "Re-sync" button (`IssueActions.tsx:158-174`) re-runs the *entire range* while reading as if scoped to that one shift.
- **Suggested fix:** echo the scope on the button itself ("Sync Homebase · Jul 1–31"); highlight the active preset; relabel the per-issue button "Re-sync all (Jul 1–31)".
- **Priority: MEDIUM.**

### 5.4 License Optimizer bulk CSV upload: filename-based detection, no preview, green checks for wrong data
- **Location:** `LicenseOptimizerPage.tsx:751-868` (`detectAndUpload`), upload UI `:1520-1567`.
- **What the coordinator experiences:** they select six CSVs; the app classifies each *by filename substring* ("provider", "sla", "leftover", "future", "feb", "utilization"), falling back to positional columns (`Object.values(r)[0]`) when headers don't match. A mis-named file imports to the wrong table and still shows "N rows imported" with a green check. Nothing shows *which type* each file was classified as, and there is no 6-of-6 checklist — uploading 5 files reports "5 files imported" with no "missing: daily utilization" warning. Bonus contradiction: the in-app guide says "Drag all 6 files at once" but there is no drop handler; only clicking works, and the drop zone's own label says "Click…".
- **Why it causes mistakes:** this is the highest-stakes silent-corruption path in the app: wrong data imports cleanly, then Recompute (1.3) bakes it into the heatmap leadership reads.
- **Suggested fix:** show the detected type inline per file ("leftover_visits.csv → Leftover slots (historical)"); add a parsed-first-row preview with a Confirm button before import; render a six-slot checklist with missing types flagged; fix the guide text ("Drag" → "Click").
- **Priority: HIGH.**

---

## 6. Sorting, filtering, finding a provider

### 6.1 License Optimizer state filter is exact-match only
- **Location:** `LicenseOptimizerPage.tsx:305` — `s.state_abbreviation === filterState.toUpperCase()`.
- **What the coordinator experiences:** typing "Penn", "Pennsylvania", or even a partial "P" into "Filter by state (e.g. PA)" returns *nothing*. Only the exact two-letter code works. Combined with the detail table's hard 100-row cap and no column sorting (`:1480`, `:1507-1510`), the row they need may be simply invisible.
- **Why it causes mistakes:** an empty result reads as "no data for my state" — a wrong conclusion reported upward, or a support ping.
- **Suggested fix:** replace the free-text input with a Select populated from the states actually present (the `states` list already exists at `:314-316`); add column sorting (worst coverage first) to the detail table.
- **Priority: MEDIUM-HIGH.**

### 6.2 The Resubmits inbox has no search, no filter, no sort
- **Location:** `ResubmissionInboxPanel.tsx:332-420`.
- **What the coordinator experiences:** a fixed-order table; to find one provider or isolate "just the pending ones" they scan every row by eye.
- **Suggested fix:** add a status filter (Pending / Parked / Approved) and a provider-name search box in the card header. The workbench already has a good global provider search at the top (`ProviderStatusSearchPanel`, `:1807-1819`) and the Publish tab has a name filter (`:2313-2318`) — bring the same pattern here.
- **Priority: MEDIUM.**

### 6.3 Homebase raw table: search but no sort, no pagination, up to 50,000 rows
- **Location:** `HomebaseSchedulePage.tsx:1287-1304` (search + status filter), `:350` (`.range(0, 49999)`), rows rendered unvirtualized at `:1335`.
- **What the coordinator experiences:** a competent search box ("Search provider, role, department") but no column sorting and one endless scroll for a busy month. The reconciliation calendar view, meanwhile, has *no* provider search at all — finding one provider's issue means clicking through colored days one at a time (`:1049`, `:1146`).
- **Suggested fix:** add sortable Date/Provider/Status headers and pagination to the raw table; add a provider filter to the reconciliation view that highlights matching days.
- **Priority: MEDIUM.**

---

## 7. Icon-only buttons & jargon

### 7.1 Two identical circular-arrow icons doing different things (License Optimizer)
- **Location:** `LicenseOptimizerPage.tsx:897-923` — "Sync Homebase" uses a `RefreshCw` icon *and* an unlabeled ghost button two inches away is a bare `RefreshCw` with no text, no tooltip, no aria-label (it's a local re-read of the database, with no feedback beyond the icon spinning).
- **Why it causes mistakes:** the coordinator cannot distinguish "pull fresh data from Homebase" from "reload the table", clicks the wrong one, and sees nothing happen.
- **Suggested fix:** give the refetch button a tooltip/label ("Reload table — does not pull from Homebase") and a different glyph. Same fix for the icon-only refresh on Scheduled Hours (`ScheduledHoursPage.tsx:185-187`, no label, no aria-label).
- **Priority: MEDIUM.**

### 7.2 Internal system names leak into coordinator-facing text
- **Locations & strings:**
  - Intake header: "Source: Jotform form 252224341308043 → sync-jotform-submissions → schedule_submissions" (`SchedulingWorkbenchPage.tsx:3517-3520`) — a raw data-pipeline diagram shown as UI copy.
  - "Lovable" as a product noun: "Compare approved Lovable shifts against synced Homebase shifts" (`HomebaseSchedulePage.tsx:846`), buttons "Accept into Lovable" / "Accept Lovable time" (`IssueActions.tsx:246, 301, 319`).
  - "The evaluator is gated on this group" (`ResubmissionInboxPanel.tsx:597`); "active = false — provider will not appear in workbench" (`useMonthlyPublish.ts:1782`); literal `superseded` in dismiss copy (`UnmatchedSubmissionsPanel.tsx:410`); status enums "DEFICIT/SURPLUS/ANOMALY" and "Util" column in the optimizer (`LicenseOptimizerPage.tsx:1370, 1497`).
- **Why it causes mistakes:** the SOP won't say "Lovable" or "evaluator"; every unexplained term is a moment where the coordinator can't confirm they're doing the right thing without asking someone.
- **Suggested fix:** a plain-language pass: "Lovable" → "the approved schedule"; "evaluator is gated" → "recalculation is blocked until…"; drop the pipeline string for "Source: provider Jotform submissions (synced automatically)"; sentence-case the optimizer enums ("Under-covered / Over-covered / Balanced / Data issue").
- **Priority: MEDIUM** (cheap, broad payoff).

### 7.3 Hardcoded one-off content presented as live status
- **Location:** `PostHomebaseChangePlan`, `SchedulingWorkbenchPage.tsx:9023-9153` — July-2026-only card with hardcoded people and states: "Dr. Sara Hammond … Pending Sarabjeet confirmation", "Confirmed by Sarabjeet", named backfill candidates.
- **What the coordinator experiences:** an amber operational to-do card that looks data-driven but never updates — "Pending Sarabjeet confirmation" will still say that after it's confirmed, unless a developer edits source code.
- **Why it causes mistakes:** the coordinator acts on stale instructions with real provider names, or double-checks with a lead every time (defeating the point). Similar pattern: the Overflow tab badge is gated to August 2026 only (`:2174`).
- **Suggested fix:** move this content to a database-backed "cycle notes" card editable by ClinOps leads, or add a visible "Written Jul 3 — verify before acting" stamp and an owner.
- **Priority: MEDIUM.**

---

## 8. Wrong-month defaults (not on the checklist, but the biggest first-try trap found)

### 8.1 Three screens open on three different hardcoded months
- **Locations:**
  - Homebase Schedule: pinned to July 2026 (`HomebaseSchedulePage.tsx:75-76, 619-621`) — correct *this* month, wrong every month after.
  - Scheduled Hours: opens on **June 2026** (`ScheduledHoursPage.tsx:114-115` with 1-indexed months, `:68-81`) — already a past month today.
  - Workbench: defaults to **August 2026** (`SchedulingWorkbenchPage.tsx:868`) from a hardcoded list that ends at September 2026 (`:192`) — in October the current month won't even be selectable.
- **What the coordinator experiences:** they open a page mid-SOP and are silently looking at the wrong month's data — no banner, no "you are viewing June" warning. Exports (`scheduled-hours-…csv`) inherit the wrong month.
- **Why it causes mistakes:** for a *monthly* workflow this is the highest-probability wrong-data path in the app: every screen is right during the month it was coded and wrong forever after, in a way a non-technical user has no reason to suspect.
- **Suggested fix:** compute defaults from today's date (Homebase Schedule → current month; Scheduled Hours → current month; Workbench → current scheduling cycle) and generate the workbench month list dynamically (current − 1 through current + 2). Add a subtle "Viewing {month}" chip near the page title on all three.
- **Priority: HIGH.**

### 8.2 Error states disguised as empty states (License Optimizer)
- **Location:** `LicenseOptimizerPage.tsx:293` (only `isLoading` is handled — no `isError` branch), empty copy at `:1114-1117`, KPI math at `:451`, red threshold at `:1025`.
- **What the coordinator experiences:** if the data query *fails*, the page shows "No data yet. Click Sync Homebase then Recompute to populate" — instructing them to run the overwrite action as the remedy for a network error. Meanwhile the KPI row computes "Avg SLA attainment 0.0%" and colors it alarm-red purely because no rows loaded.
- **Why it causes mistakes:** the coordinator follows the on-screen instruction and recomputes over good data (compounding 1.3), or escalates a "0% SLA" panic that is actually a loading failure.
- **Suggested fix:** add an `isError` branch ("Couldn't load data — this is a system error, not missing data; don't recompute") and render KPI tiles as neutral "—" when there are zero snapshots.
- **Priority: MEDIUM-HIGH.**

---

## 9. Navigation & structure

### 9.1 Duplicate pages, missing links, and two things called a workbench
- **Locations:** identical Homebase Schedule page at both `/admin/homebase-schedule` and `/scheduling/homebase-schedule` under two different sidebars (`App.tsx:339-341, 415-417`); "Scheduled Hours" exists only in the admin sidebar (`AppSidebar.tsx:122`) and is absent from the scheduling sidebar (`SchedulingSidebar.tsx:39-48`); the admin sidebar lists both "Workbench" (`/admin/workbench`) and "Scheduling Dashboard" (`/scheduling/workbench`); "Homebase Schedule" uses a database-cylinder icon in both sidebars.
- **What the coordinator experiences:** an SOP that says "open Scheduled Hours" is impossible to follow from inside the scheduling workspace; the same screen appears with two different frames depending on which link they used; "Publish" (workbench) vs "Needs publish" (reconciliation) are different steps with near-identical names.
- **Suggested fix:** make one route canonical and redirect the other; add "Scheduled Hours" to `SchedulingSidebar.items`; rename one of the two workbenches; swap the `Database` icon for `CalendarRange`.
- **Priority: MEDIUM.**

### 9.2 Things that are genuinely good (keep and extend these patterns)
Worth stating so fixes copy the right internal precedents:
- The **PublishGateBanner** (`SchedulingWorkbenchPage.tsx:9156-9320`): "Stop before publishing" with the specific blocker and a jump button — exemplary.
- **ReasonSummary tags** (`:3375-3419`) translating evaluator output into plain-English chips.
- **IssueActions confirm dialogs with Undo** (`IssueActions.tsx:113-135, 370-399`) — the model that Recalculate, HB all, and Mark HB should follow.
- The **EHR-after-Homebase guard** with inline explanation ("Finish Homebase first…", `:2426-2430, 4732-4736`).
- The **recalculation history diff** with "Why this happened" per provider (`:4389-4438`) — it just needs to be a *before*-warning, not only an after-explanation.

---

## Top 5 fixes before the next scheduling cycle

1. **Put a confirmation in front of every recalculate/overwrite action** — "Recalculate schedule" (both buttons), "Approve & recalculate" when published shifts collide, and License Optimizer "Recompute". Each dialog states what gets overwritten in one sentence, including the count of manually edited shifts at risk. (Findings 1.1, 1.2, 1.3 — the single most-reported pain point, and the cheapest to fix.)
2. **Fix the hardcoded month defaults** on Homebase Schedule (July 2026), Scheduled Hours (June 2026), and the Workbench month list (ends Sept 2026) to derive from today's date. (Finding 8.1 — silent wrong-month data in a monthly workflow.)
3. **Make the "Manually edited" flag permanent** (a real column set on human edits, not the same-day `updated_at` heuristic) and reference it in the recalculate confirmation from fix #1. (Finding 2.1 — this flag is what makes fix #1 meaningful.)
4. **De-booby-trap the bulk publish buttons:** rename "HB all"/"EHR all" to "Mark all posted (HB/EHR)" with tooltips, confirm the revert direction, and confirm "Mark HB (N)" with its provider count. (Findings 5.1, 5.2.)
5. **Show the blocking/decline context in the Review tabs:** amber "Pending — blocks recalculation" badges on inbox rows, park reasons visible in the list, and the prior evaluator decision (status + declined hours + notes, already fetched) inside the resubmission dialog. (Findings 2.2, 4.1.)

Honorable mention if there's capacity: rename "Acknowledge" → "Snooze until next sync" (3.3) — a one-word change that prevents a "we thought it was published" incident.
