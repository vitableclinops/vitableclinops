import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const ROLE_LABELS = ['NP', 'Physician', 'Pod Lead', 'Admin'];

export interface LinkedProviderItem {
  id: string; // junction row id or temp id
  provider_id: string;
  role_label: string;
  full_name: string | null;
  email: string | null;
}

interface ProviderOption {
  id: string;
  full_name: string | null;
  email: string;
}

interface LinkedProviderEditorProps {
  value: LinkedProviderItem[];
  onChange: (providers: LinkedProviderItem[]) => void;
  disabled?: boolean;
  maxProviders?: number;
}

export function LinkedProviderEditor({
  value,
  onChange,
  disabled = false,
  maxProviders = 3,
}: LinkedProviderEditorProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) {
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .neq('employment_status', 'termed')
        .neq('activation_status', 'Terminated')
        .order('full_name')
        .then(({ data }) => {
          setProviders(data || []);
          setLoaded(true);
        });
    }
  }, [loaded]);

  const filteredProviders = providers.filter(p => {
    if (value.some(v => v.provider_id === p.id)) return false;
    if (!search) return false;
    const s = search.toLowerCase();
    return (
      (p.full_name?.toLowerCase().includes(s)) ||
      p.email.toLowerCase().includes(s)
    );
  });

  const addProvider = (provider: ProviderOption) => {
    if (value.length >= maxProviders) return;
    onChange([
      ...value,
      {
        id: `new-${Date.now()}`,
        provider_id: provider.id,
        role_label: 'NP',
        full_name: provider.full_name,
        email: provider.email,
      },
    ]);
    setSearch('');
  };

  const removeProvider = (providerId: string) => {
    onChange(value.filter(v => v.provider_id !== providerId));
  };

  const updateRole = (providerId: string, role: string) => {
    onChange(value.map(v => v.provider_id === providerId ? { ...v, role_label: role } : v));
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1">
        <User className="h-3.5 w-3.5" />
        Linked Providers (up to {maxProviders})
      </Label>

      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((lp) => (
            <div
              key={lp.provider_id}
              className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium flex-1 truncate">{lp.full_name || 'Unknown'}</span>
              {disabled ? (
                <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                  {lp.role_label}
                </Badge>
              ) : (
                <Select value={lp.role_label} onValueChange={(v) => updateRole(lp.provider_id, v)}>
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_LABELS.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {lp.email && (
                <span className="text-muted-foreground text-xs truncate max-w-[120px] hidden sm:inline">{lp.email}</span>
              )}
              {!disabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeProvider(lp.provider_id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && value.length < maxProviders && (
        <div className="space-y-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search providers to link…"
              className="pl-8 h-9 text-sm"
            />
          </div>
          {search && (
            <ScrollArea className="max-h-32 border rounded-md">
              <div className="p-1">
                {filteredProviders.slice(0, 8).map(p => (
                  <button
                    key={p.id}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                    onClick={() => addProvider(p)}
                  >
                    <span className="font-medium">{p.full_name || 'Unknown'}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{p.email}</span>
                  </button>
                ))}
                {filteredProviders.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">No results</p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      {value.length === 0 && disabled && (
        <p className="text-xs text-muted-foreground">No providers linked to this task.</p>
      )}
    </div>
  );
}
