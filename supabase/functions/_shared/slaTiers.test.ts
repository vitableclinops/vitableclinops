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

Deno.test('window check uses the window total as given, without re-adding days', () => {
  // PA floor is 5 across the window. Card 2431 already reports the
  // today+tomorrow window as one value, so it is passed straight through.
  assertEquals(
    checkPolicyFloors(rule('PA'), { windowSlots: 5, sameDaySlots: null }).windowShortfall,
    0,
  );
  assertEquals(
    checkPolicyFloors(rule('PA'), { windowSlots: 2, sameDaySlots: null }).windowShortfall,
    3,
  );
});

Deno.test('a same-day floor with no same-day count is unmeasurable, not met', () => {
  const floors = checkPolicyFloors(rule('PA'), { windowSlots: 49, sameDaySlots: null });
  assertEquals(floors.windowShortfall, 0);
  assertEquals(floors.sameDayShortfall, null);
  assertEquals(floors.sameDayMeasurable, false);
  // Crucially this must not be reported as a breach, nor as a pass.
  assertEquals(breachesPolicyFloor(floors), false);
});

Deno.test('a same-day floor is evaluated when a same-day count is supplied', () => {
  const met = checkPolicyFloors(rule('PA'), { windowSlots: 49, sameDaySlots: 8 });
  assertEquals(met.sameDayShortfall, 0);
  assertEquals(met.sameDayMeasurable, true);

  // 0 slots today against a window of 49: the window passes but the
  // member-facing same-day promise is broken.
  const broken = checkPolicyFloors(rule('PA'), { windowSlots: 49, sameDaySlots: 0 });
  assertEquals(broken.windowShortfall, 0);
  assertEquals(broken.sameDayShortfall, 1);
  assertEquals(breachesPolicyFloor(broken), true);
});

Deno.test('next_day has no same-day floor so it is always measurable', () => {
  const floors = checkPolicyFloors(rule('MD'), { windowSlots: 1, sameDaySlots: null });
  assertEquals(floors.windowShortfall, 1);
  assertEquals(floors.sameDayShortfall, null);
  assertEquals(floors.sameDayMeasurable, true);
  assertEquals(breachesPolicyFloor(floors), true);
});

Deno.test('within_48h has no floors to breach', () => {
  const floors = checkPolicyFloors(rule('CA'), { windowSlots: 0, sameDaySlots: 0 });
  assertEquals(floors.windowShortfall, null);
  assertEquals(floors.sameDayShortfall, null);
  assertEquals(breachesPolicyFloor(floors), false);
});

Deno.test('VA uses its lower window floor', () => {
  assertEquals(
    checkPolicyFloors(rule('VA'), { windowSlots: 2, sameDaySlots: null }).windowShortfall,
    0,
  );
  assertEquals(
    checkPolicyFloors(rule('VA'), { windowSlots: 1, sameDaySlots: null }).windowShortfall,
    1,
  );
});

Deno.test('an unknown state has no floors rather than defaulting to a tier', () => {
  const floors = checkPolicyFloors(getSlaTierRule(rules, 'ZZ'), {
    windowSlots: 0,
    sameDaySlots: 0,
  });
  assertEquals(floors.windowShortfall, null);
  assertEquals(floors.sameDayShortfall, null);
});

Deno.test('non-finite counts are treated as zero / unmeasurable rather than NaN', () => {
  const floors = checkPolicyFloors(rule('PA'), {
    windowSlots: Number.NaN,
    sameDaySlots: Number.NaN,
  });
  assertEquals(floors.windowShortfall, 5);
  assertEquals(floors.sameDayMeasurable, false);
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
