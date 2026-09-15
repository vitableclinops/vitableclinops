import { assertEquals } from 'jsr:@std/assert@1';
import {
  breachesPolicyFloor,
  checkPolicyFloors,
  FALLBACK_SLA_TIER_RULES,
  getSlaTierRule,
  isSlaPhysicianOnlyState,
  loadSlaTierRules,
  type SlaTierRule,
} from './slaTiers.ts';

const rules = FALLBACK_SLA_TIER_RULES;

function rule(state: string): SlaTierRule {
  const found = getSlaTierRule(rules, state);
  if (!found) throw new Error(`no rule for ${state}`);
  return found;
}

// --- fallback shape -------------------------------------------------------

Deno.test('fallback covers 50 states plus DC', () => {
  assertEquals(rules.size, 51);
});

Deno.test('fallback tier membership matches the policy', () => {
  const byTier = { same_day: 0, next_day: 0, within_48h: 0 };
  for (const r of rules.values()) byTier[r.tier] += 1;
  assertEquals(byTier, { same_day: 7, next_day: 5, within_48h: 39 });
});

Deno.test('fallback flags exactly the eight physician-only states', () => {
  const flagged = [...rules.values()].filter((r) => r.physicianOnly).map((r) => r.state).sort();
  assertEquals(flagged, ['AL', 'GA', 'IN', 'LA', 'MO', 'MS', 'SC', 'TN']);
});

Deno.test('fallback carries the VA carve-out', () => {
  assertEquals(rule('PA').minSlotsWindow, 5);
  assertEquals(rule('VA').minSlotsWindow, 2);
  assertEquals(rule('MD').minSlotsWindow, 2);
  assertEquals(rule('CA').minSlotsWindow, null);
});

Deno.test('only same_day states have a same-day floor', () => {
  assertEquals(rule('PA').minSlotsSameDay, 1);
  assertEquals(rule('MD').minSlotsSameDay, null);
  assertEquals(rule('CA').minSlotsSameDay, null);
});

// --- physician-only lookup ------------------------------------------------

Deno.test('isSlaPhysicianOnlyState matches the previous hardcoded behaviour', () => {
  for (const state of ['AL', 'GA', 'IN', 'LA', 'MS', 'MO', 'SC', 'TN']) {
    assertEquals(isSlaPhysicianOnlyState(rules, state), true, state);
  }
  for (const state of ['PA', 'NJ', 'CA', 'MD']) {
    assertEquals(isSlaPhysicianOnlyState(rules, state), false, state);
  }
});

Deno.test('isSlaPhysicianOnlyState normalizes input and defaults unknown states to false', () => {
  assertEquals(isSlaPhysicianOnlyState(rules, 'al'), true);
  assertEquals(isSlaPhysicianOnlyState(rules, ' ga '), true);
  assertEquals(isSlaPhysicianOnlyState(rules, 'ZZ'), false);
  assertEquals(isSlaPhysicianOnlyState(rules, ''), false);
});

// --- policy floors --------------------------------------------------------

Deno.test('same_day counts the window across today and tomorrow', () => {
  // PA floor is 5 across the window, 1 today.
  assertEquals(checkPolicyFloors(rule('PA'), 3, 2), { windowShortfall: 0, sameDayShortfall: 0 });
  assertEquals(checkPolicyFloors(rule('PA'), 1, 1), { windowShortfall: 3, sameDayShortfall: 0 });
});

Deno.test('same_day flags a broken same-day promise even when the window is fine', () => {
  // 0 today, 9 tomorrow: window of 9 clears the floor of 5, but there is
  // no visit available today, which is the actual promise.
  const floors = checkPolicyFloors(rule('PA'), 0, 9);
  assertEquals(floors.windowShortfall, 0);
  assertEquals(floors.sameDayShortfall, 1);
  assertEquals(breachesPolicyFloor(floors), true);
});

Deno.test('next_day excludes same-day from its window', () => {
  // MD floor is 2, counted on tomorrow only. 5 today / 1 tomorrow is short.
  const floors = checkPolicyFloors(rule('MD'), 5, 1);
  assertEquals(floors.windowShortfall, 1);
  assertEquals(floors.sameDayShortfall, null);
  assertEquals(breachesPolicyFloor(floors), true);
});

Deno.test('next_day with no slots today still passes on tomorrow alone', () => {
  const floors = checkPolicyFloors(rule('MD'), 0, 2);
  assertEquals(floors.windowShortfall, 0);
  assertEquals(breachesPolicyFloor(floors), false);
});

Deno.test('within_48h has no floors to breach', () => {
  const floors = checkPolicyFloors(rule('CA'), 0, 0);
  assertEquals(floors, { windowShortfall: null, sameDayShortfall: null });
  assertEquals(breachesPolicyFloor(floors), false);
});

Deno.test('VA uses its lower window floor', () => {
  assertEquals(checkPolicyFloors(rule('VA'), 1, 1).windowShortfall, 0);
  assertEquals(checkPolicyFloors(rule('VA'), 0, 1).windowShortfall, 1);
});

Deno.test('an unknown state has no floors rather than defaulting to a tier', () => {
  const floors = checkPolicyFloors(getSlaTierRule(rules, 'ZZ'), 0, 0);
  assertEquals(floors, { windowShortfall: null, sameDayShortfall: null });
});

Deno.test('non-finite slot counts are treated as zero rather than propagating NaN', () => {
  const floors = checkPolicyFloors(rule('PA'), Number.NaN, 2);
  assertEquals(floors.windowShortfall, 3);
  assertEquals(floors.sameDayShortfall, 1);
});

// --- loader ---------------------------------------------------------------

function stubClient(response: { data: unknown; error: unknown }) {
  return { from: () => ({ select: () => Promise.resolve(response) }) };
}

Deno.test('loadSlaTierRules parses table rows', async () => {
  const result = await loadSlaTierRules(stubClient({
    data: [{
      state: 'pa',
      sla_tier: 'same_day',
      horizon_days: 1,
      physician_only: false,
      min_slots_window: 31,
      min_slots_sameday: 8,
    }],
    error: null,
  }));

  assertEquals(result.source, 'table');
  assertEquals(result.warning, null);
  assertEquals(result.rules.size, 1);
  assertEquals(getSlaTierRule(result.rules, 'PA')?.minSlotsWindow, 31);
});

Deno.test('loadSlaTierRules falls back and warns on a read error', async () => {
  const result = await loadSlaTierRules(stubClient({
    data: null,
    error: new Error('permission denied'),
  }));

  assertEquals(result.source, 'fallback');
  assertEquals(result.rules.size, 51);
  // The physician-only rule must survive a database failure.
  assertEquals(isSlaPhysicianOnlyState(result.rules, 'AL'), true);
  assertEquals(result.warning?.includes('permission denied'), true);
});

Deno.test('loadSlaTierRules falls back when the table is empty', async () => {
  const result = await loadSlaTierRules(stubClient({ data: [], error: null }));
  assertEquals(result.source, 'fallback');
  assertEquals(result.rules.size, 51);
});

Deno.test('loadSlaTierRules skips unusable rows but keeps valid ones', async () => {
  const result = await loadSlaTierRules(stubClient({
    data: [
      { state: 'PA', sla_tier: 'same_day', horizon_days: 1, physician_only: false },
      { state: '', sla_tier: 'same_day', horizon_days: 1 },
      { state: 'XX', sla_tier: 'nonsense', horizon_days: 1 },
    ],
    error: null,
  }));

  assertEquals(result.source, 'table');
  assertEquals(result.rules.size, 1);
  assertEquals(getSlaTierRule(result.rules, 'PA')?.tier, 'same_day');
});

Deno.test('loadSlaTierRules never throws when the client itself blows up', async () => {
  const exploding = {
    from: () => {
      throw new Error('connection reset');
    },
  };
  const result = await loadSlaTierRules(exploding as never);
  assertEquals(result.source, 'fallback');
  assertEquals(result.warning?.includes('connection reset'), true);
});
