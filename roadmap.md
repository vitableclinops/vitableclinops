# Roadmap

- [ ] Correct Desire Brown’s December 22–31 Wednesday/Friday shifts from her one-off availability, preserving Monday/Thursday recurrence.
- [ ] Restore Michelle Diederich’s correct December shifts and verify both corrections without reallocating other providers.

- [x] Show the last successful Medallion directory update time and add a working Refresh now button beside it.
- [x] Remove the Active states in EHR data freshness section from the flagged-provider dropdown.

- [x] Add and verify a per-provider Licenses export with EHR state groups and fulfilled requirements.

- [x] Move provider requirement reviews and their missing-requirements badge into Compliance; update correction links and preserve existing tracking and proof.

- [x] Simplify provider requirement reviews into compact expandable rows for both active and licensed providers.

- [x] Add Medallion-licensed, not-EHR-active provider lists and advance requirement review to States & Compliance, with state-card summaries.

- [x] Add red open-task count badge to the Tasks tab on the Agreements page (mirror States & Compliance Provider Requirements badge).
- [x] Confirm Metabase coverage fetch auto-flags providers newly added to a state so their state-practice requirements are audited — verified: `usePcpCoverage` diffs each snapshot (`addedActiveEhrStates`), feeds `newlyActiveStatesByProfile` into `activeStateAgreementFlags`; 39 tests pass.
- [x] Exclude MD/DO physicians (Gina Charles, Seth Dinowitz) from NP requirement reviews

- [x] Make state requirement text consistent on every page/tab (spreadsheet rules + MN/NE/DC)
- [x] Show a Last Refreshed date/time under the Refresh sources button on States & Compliance and the Provider Directory; verified it updates after a refresh and persists across reloads.
- [x] Add Sara Hammond’s verified 84-hour December form to the locked draft without changing existing shift dates, times or hours.
- [x] Leave Andrea Leffet out of December scheduling; Maddi confirmed she is on leave and no hours should be added.
