import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function FlagProfileLookup({ open, onClose, profiles, onSelect, onAdd }: {
  open: boolean; onClose: () => void;
  profiles: { id: string; name: string; npi: string | null }[];
  onSelect: (id: string) => void; onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = profiles.filter(p => `${p.name} ${p.npi ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog open={open} onOpenChange={value => { if (!value) { setQuery(''); onClose(); } }}>
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Find provider profile</DialogTitle></DialogHeader>
      <Input aria-label="Search provider profiles" placeholder="Name or verified NPI" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="max-h-80 overflow-y-auto divide-y divide-border">
        {filtered.map(p => <div key={p.id} className="flex items-center justify-between gap-3 py-2">
          <span>{p.name}<span className="block text-xs text-muted-foreground">NPI: {p.npi ?? 'Not supplied'}</span></span>
          <Button variant="outline" size="sm" onClick={() => { onClose(); onSelect(p.id); }}>Open profile</Button>
        </div>)}
        {!filtered.length && <p className="py-3 text-muted-foreground">No matching profiles</p>}
      </div>
      <Button variant="outline" onClick={onAdd}>Add provider</Button>
    </DialogContent>
  </Dialog>;
}