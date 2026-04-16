

## Provider Coverage View — Ops Dashboard

Add a "By Provider" tab to the Ops Dashboard that shows each provider's Homebase shift hours for the selected date and how those hours are split across their licensed (active) states.

### What the user will see

A new tab alongside the existing state coverage table. When selected, it shows a table with:

| Provider | Total Hours | Slots | States | Allocation |
|----------|-------------|-------|--------|------------|
| Amanda Clement | 5h | 10 | AK, AZ, CA, … (48 states) | 0.10 hrs / 0.2 slots each |
| Lisa Brittmon | 7h | 14 | TX, FL, NY (3 states) | 2.33 hrs / 4.7 slots each |

Each row is expandable to show the per-state breakdown in a sub-table: State, Allocated Hours, Projected Slots.

A search/filter input for provider names, and a CSV export button.

### Data source

All data is already in the database — no new tables or edge functions needed. The view queries:
1. `homebase_shifts` (joined via `homebase_employees` to `profiles`) for the selected date — gets total scheduled hours per provider
2. `provider_licenses` (status = 'active') — gets each provider's licensed states
3. `state_activation` (is_active = true) — filters to operationally active states

The even-split math (same as `compute-availability-slots`) is done client-side:
- `eligible_states` = intersection of provider's active licenses and active states
- `hours_per_state` = total_hours / eligible_states.length
- `slots_per_state` = hours_per_state × 2 (30-min slots)

### Implementation

**File: `src/pages/OpsDashboardPage.tsx`**

1. Add a new `useProviderCoverage(date)` hook that fetches the three tables above and computes the per-provider, per-state allocation
2. Add a `viewMode` state (`'by_state' | 'by_provider'`) with tab triggers in the filter row
3. Add a `ProviderCoverageTable` component rendered when `viewMode === 'by_provider'`
   - Collapsible rows (click to expand per-state breakdown)
   - Provider name, total hours, total slots, number of eligible states, hours/state, slots/state
   - Sub-row table: state abbreviation, allocated hours, projected slots
4. Add CSV export for the provider view (provider, total_hours, state, allocated_hours, projected_slots)

No database changes required.

