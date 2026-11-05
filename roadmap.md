# Roadmap

- [x] Add Medallion-licensed, not-EHR-active provider lists and advance requirement review to States & Compliance, with state-card summaries.

- [x] Add red open-task count badge to the Tasks tab on the Agreements page (mirror States & Compliance Provider Requirements badge).
- [x] Confirm Metabase coverage fetch auto-flags providers newly added to a state so their state-practice requirements are audited — verified: `usePcpCoverage` diffs each snapshot (`addedActiveEhrStates`), feeds `newlyActiveStatesByProfile` into `activeStateAgreementFlags`; 39 tests pass.
- [x] Exclude MD/DO physicians (Gina Charles, Seth Dinowitz) from NP requirement reviews
