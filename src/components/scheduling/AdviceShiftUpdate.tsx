import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { diffProviderShifts, fmtEtMin, type ExistingShift, type ProposedShift } from '@/lib/scheduling/shiftUpdateDiff';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = clinopsSupabase as any;
type Row = ExistingShift & { provider_name: string; provider_id: string | null; submission_id: string | null; shift_type: string; assigned_state: string | null; decision_run_id: string | null };
type Plan = { buildId: string; provider: string; template: Row; add: ProposedShift[]; remove: Row[]; keep: Row[]; today: string };

const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function AdviceShiftUpdate({ advice, month }: { advice: string; month: string }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const monthStart = `${month.slice(0, 7)}-01`;

  const prepare = async () => {
    setLoading(true);
    try {
      const { data: ex, error: exErr } = await supabase.functions.invoke('gap-offer-ai', { body: { mode: 'extract', advice, month: monthStart } });
      if (exErr || ex?.error) throw new Error(ex?.error || exErr?.message);
      const { data: wf, error: wfErr } = await db.from('scheduling_month_workflows').select('active_build_id, locked_build_id').eq('target_month', monthStart).maybeSingle();
      if (wfErr) throw wfErr;
      const buildId = wf?.locked_build_id ?? wf?.active_build_id;
      if (!buildId) throw new Error('No built schedule exists for this month yet.');
      const { data: rows, error } = await db.from('schedule_build_rows')
        .select('id, shift_date, start_min, end_min, hours, provider_name, provider_id, submission_id, shift_type, assigned_state, decision_run_id')
        .eq('build_id', buildId).eq('recommendation', 'publish').range(0, 49999);
      if (error) throw error;
      const target = norm(ex.provider_name || '');
      const all = (rows ?? []) as Row[];
      let mine = all.filter((r) => norm(r.provider_name) === target);
      if (!mine.length) {
        const names = [...new Set(all.map((r) => r.provider_name))].filter((n) => target.split(' ').every((w) => norm(n).includes(w)));
        if (names.length === 1) mine = all.filter((r) => r.provider_name === names[0]);
        else throw new Error(names.length ? `More than one provider matches "${ex.provider_name}".` : `"${ex.provider_name}" has no shifts in this month's schedule.`);
      }
      const today = etToday();
      const d = diffProviderShifts(mine, ex.shifts ?? [], today);
      setPlan({ buildId, provider: mine[0].provider_name, template: mine[0], add: d.add, remove: d.remove as Row[], keep: d.keep as Row[], today });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare update');
    } finally { setLoading(false); }
  };

  const confirm = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      if (plan.remove.length) {
        const { error } = await db.from('schedule_build_rows').delete().eq('build_id', plan.buildId).in('id', plan.remove.map((r) => r.id));
        if (error) throw error;
      }
      if (plan.add.length) {
        const t = plan.template;
        const { error } = await db.from('schedule_build_rows').insert(plan.add.map((a) => ({
          build_id: plan.buildId, source_shift_recommendation_id: null, submission_id: t.submission_id, provider_id: t.provider_id,
          provider_name: t.provider_name, target_month: monthStart, shift_date: a.date, start_min: a.start_min, end_min: a.end_min,
          hours: Math.round(((a.end_min - a.start_min) / 60) * 100) / 100, shift_type: t.shift_type, assigned_state: t.assigned_state,
          recommendation: 'publish', recommendation_reason: 'Updated from Gap Finder AI advice', decision_run_id: t.decision_run_id,
          source_publish_status: 'pending', publish_status: 'pending',
        })));
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ['workbench'] });
      toast.success(`Updated ${plan.provider}'s shifts: ${plan.remove.length} removed, ${plan.add.length} added. Add them in Homebase from the Publish checklist.`);
      setPlan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setSaving(false); }
  };

  const hrs = (xs: { start_min: number; end_min: number }[]) => xs.reduce((s, x) => s + (x.end_min - x.start_min) / 60, 0);
  return (
    <>
      <Button size="sm" onClick={prepare} disabled={loading}>
        <CalendarClock className="h-4 w-4 mr-1" />{loading ? 'Reading schedule…' : 'Update shifts'}
      </Button>
      <Dialog open={!!plan} onOpenChange={(o) => !o && setPlan(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review changes for {plan?.provider}</DialogTitle>
            <DialogDescription>Only this provider's shifts after today change. All times Eastern. Nothing is saved until you confirm, and Homebase isn't changed.</DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="space-y-3 text-sm">
              <Section title={`Remove (${plan.remove.length})`} tone="text-destructive" items={plan.remove.map((r) => ({ date: r.shift_date, start_min: r.start_min, end_min: r.end_min }))} />
              <Section title={`Add (${plan.add.length})`} tone="text-primary" items={plan.add} />
              <p className="text-muted-foreground">{plan.keep.length} shifts stay as they are. Future hours: {hrs([...plan.keep, ...plan.remove]).toFixed(1)}h → {hrs([...plan.keep, ...plan.add]).toFixed(1)}h.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)}>Cancel</Button>
            <Button onClick={confirm} disabled={saving || !plan || (!plan.add.length && !plan.remove.length)}>{saving ? 'Saving…' : 'Confirm update'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, tone, items }: { title: string; tone: string; items: ProposedShift[] }) {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
  return (
    <div>
      <p className={`font-medium ${tone}`}>{title}</p>
      {sorted.length ? (
        <ul className="ml-4 list-disc">{sorted.map((s, i) => <li key={i}>{fmtDate(s.date)} · {fmtEtMin(s.start_min)}–{fmtEtMin(s.end_min)} ET ({((s.end_min - s.start_min) / 60).toFixed(1)}h)</li>)}</ul>
      ) : <p className="text-muted-foreground ml-4">None</p>}
    </div>
  );
}
