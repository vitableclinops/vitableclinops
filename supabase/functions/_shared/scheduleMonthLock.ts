// Months whose schedule is locked/published in scheduling_month_workflows.
// Re-runs must not rewrite these months unless ?force_locked=1 is passed.
// deno-lint-ignore no-explicit-any
export async function loadLockedMonths(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('scheduling_month_workflows')
    .select('target_month, current_stage')
    .in('current_stage', ['locked', 'published']);
  if (error) throw new Error(`month lock lookup failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ target_month: string }>).map(r => String(r.target_month).slice(0, 10)));
}
