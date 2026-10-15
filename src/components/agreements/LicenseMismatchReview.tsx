import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDisplayDate } from '@/lib/utils';

type Row = {
  profileId: string;
  name: string;
  state: string;
  medallion: string;
  ours: string;
  issue: string;
};

const fmt = (d: string | null) => (d ? formatDisplayDate(d) : 'no expiration');

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as any)
      .from(table).select(cols).not('profile_id', 'is', null).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function LicenseMismatchReview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['license-mismatch-review'],
    queryFn: async (): Promise<Row[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const med = await fetchAll<any>('medallion_licenses', 'profile_id, state, status, expiration_date');
      const ours = await fetchAll<any>('provider_licenses', 'profile_id, state_abbreviation, status, expiration_date');

      const best = (list: any[], valid: (l: any) => boolean) => {
        const v = list.filter(valid);
        const pool = v.length ? v : list;
        return pool.sort((a, b) => (b.expiration_date || '9999') .localeCompare(a.expiration_date || '9999'))[0];
      };
      const medValid = (l: any) => l.status === 'active' && (!l.expiration_date || l.expiration_date >= today);
      const ourValid = (l: any) => ['active', 'verified'].includes(l.status) && (!l.expiration_date || l.expiration_date >= today);

      const group = (list: any[], stateKey: string) => {
        const m = new Map<string, any[]>();
        for (const l of list) {
          if (!l[stateKey]) continue;
          const k = `${l.profile_id}|${l[stateKey]}`;
          m.set(k, [...(m.get(k) || []), l]);
        }
        return m;
      };
      const medMap = group(med, 'state');
      const ourMap = group(ours, 'state_abbreviation');
      const linked = new Set(med.map((l) => l.profile_id));

      const rows: Omit<Row, 'name'>[] = [];
      const keys = new Set([...medMap.keys(), ...[...ourMap.keys()].filter((k) => linked.has(k.split('|')[0]))]);
      for (const k of keys) {
        const [profileId, state] = k.split('|');
        const m = medMap.get(k) || [];
        const o = ourMap.get(k) || [];
        const mb = m.length ? best(m, medValid) : null;
        const ob = o.length ? best(o, ourValid) : null;
        const mv = mb ? medValid(mb) : false;
        const ov = ob ? ourValid(ob) : false;
        let issue = '';
        if (mv && !ob) issue = 'Active in Medallion, missing here';
        else if (mv && !ov) issue = 'Active in Medallion, expired/inactive here';
        else if (!mv && ov) issue = mb ? 'Valid here, inactive/expired in Medallion' : 'Valid here, not in Medallion';
        else if (mv && ov && (mb.expiration_date || '') !== (ob.expiration_date || '')) issue = 'Expiration dates differ';
        if (!issue) continue;
        rows.push({
          profileId, state, issue,
          medallion: mb ? `${mb.status}, ${fmt(mb.expiration_date)}` : 'none',
          ours: ob ? `${ob.status}, ${fmt(ob.expiration_date)}` : 'none',
        });
      }

      const ids = [...new Set(rows.map((r) => r.profileId))];
      const names = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: p } = await supabase.from('profiles').select('id, full_name, employment_status').in('id', ids.slice(i, i + 200));
        (p || []).forEach((x: any) => { if (x.employment_status !== 'termed') names.set(x.id, x.full_name || 'Unknown'); });
      }
      return rows
        .filter((r) => names.has(r.profileId))
        .map((r) => ({ ...r, name: names.get(r.profileId)! }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>License review: Medallion vs. our records</CardTitle>
        <CardDescription>
          Places where Medallion and our license records disagree, for manual review. Nothing here is changed automatically.
          The nightly agreement check now keeps an agreement active if Medallion shows a current license.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Could not load: {(error as Error).message}</p>}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No disagreements found.</p>}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <p className="text-sm text-muted-foreground mb-2">{data.length} flagged</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Provider</th><th className="pr-3">State</th>
                  <th className="pr-3">Issue</th><th className="pr-3">Medallion</th><th>Our records</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.profileId + r.state} className="border-b last:border-0">
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="pr-3">{r.state}</td>
                    <td className="pr-3"><Badge variant="outline">{r.issue}</Badge></td>
                    <td className="pr-3">{r.medallion}</td>
                    <td>{r.ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
