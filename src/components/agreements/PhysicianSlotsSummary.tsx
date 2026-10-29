import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Users } from 'lucide-react';
import { usePhysicianSlots } from '@/hooks/usePhysicianSlots';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function PhysicianSlotsSummary() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data = [], isPending, isError } = usePhysicianSlots();
  const rows = data.filter(r => `${r.physicianName} ${r.state}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-6 border-y border-border py-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between h-auto whitespace-normal text-left gap-3">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" />Physician slots by state
            {!isPending && !isError && <Badge variant="secondary">{data.length}</Badge>}
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <Input aria-label="Search physician slots" placeholder="Search physician or state" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm mb-3" />
        {isPending ? <p className="text-sm text-muted-foreground">Checking slots…</p> : isError ? <p className="text-sm text-destructive">Could not load physician slots.</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No matching active agreements with a saved state limit.</p> : (
          <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(row => (
              <Collapsible key={row.key} className="border-b border-border py-3 min-w-0">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full h-auto justify-between gap-3 whitespace-normal text-left px-2">
                    <span className="min-w-0"><span className="block font-medium break-words">{row.physicianName}</span><span className="text-xs text-muted-foreground">{row.state}</span></span>
                    <span className="flex items-center gap-2 shrink-0"><Badge variant={row.filled > row.limit ? 'destructive' : row.filled === row.limit ? 'default' : 'secondary'}>{row.filled}/{row.limit} filled</Badge><ChevronDown className="h-3 w-3" /></span>
                  </Button>
                </CollapsibleTrigger>
                {row.verificationLimit !== null && <p className="px-2 pt-1 text-xs text-destructive">Saved limits differ: State Requirements {row.limit}; verification {row.verificationLimit}. <Link to={`/states/${row.state}`} className="underline">Review state</Link></p>}
                <CollapsibleContent className="px-2 pt-2 space-y-1">
                  {row.providers.map(p => <p key={p.id} className="text-sm">{p.full_name ?? 'Unnamed provider'}</p>)}
                  <p className="text-xs text-muted-foreground">{row.filled > row.limit ? `${row.filled - row.limit} over limit` : `${row.limit - row.filled} slots remaining`}</p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}