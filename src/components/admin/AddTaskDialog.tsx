import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, User, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type TaskCategory = Database['public']['Enums']['agreement_task_category'];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'agreement_creation', label: 'Agreement Creation' },
  { value: 'signature', label: 'Signature' },
  { value: 'supervision_meeting', label: 'Supervision Meeting' },
  { value: 'chart_review', label: 'Chart Review' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'termination', label: 'Termination' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'document', label: 'Document' },
  { value: 'communication', label: 'Communication' },
  { value: 'all_hands_attestation', label: 'All-Hands Attestation' },
  { value: 'custom', label: 'Custom' },
];

const ROLE_LABELS = ['NP', 'Physician', 'Pod Lead'];

interface ProviderOption {
  id: string;
  full_name: string | null;
  email: string;
}

interface SelectedProvider {
  id: string;
  full_name: string | null;
  email: string;
  role_label: string;
}

interface AddTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddTaskDialog({ open, onClose, onSuccess }: AddTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState<string>('custom');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<SelectedProvider[]>([]);
  const [providerSearch, setProviderSearch] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setCategory('custom');
      setDueDate('');
      setSelectedProviders([]);
      setProviderSearch('');

      // Fetch all active providers
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .neq('employment_status', 'termed')
        .neq('activation_status', 'Terminated')
        .order('full_name')
        .then(({ data }) => setProviders(data || []));
    }
  }, [open]);

  const filteredProviders = providers.filter(p => {
    const alreadySelected = selectedProviders.some(sp => sp.id === p.id);
    if (alreadySelected) return false;
    if (!providerSearch) return true;
    const search = providerSearch.toLowerCase();
    return (
      (p.full_name?.toLowerCase().includes(search)) ||
      p.email.toLowerCase().includes(search)
    );
  });

  const addProvider = (provider: ProviderOption) => {
    if (selectedProviders.length >= 3) {
      toast({ title: 'Limit reached', description: 'Maximum 3 linked providers per task.', variant: 'destructive' });
      return;
    }
    setSelectedProviders(prev => [
      ...prev,
      { ...provider, role_label: 'NP' },
    ]);
    setProviderSearch('');
  };

  const removeProvider = (id: string) => {
    setSelectedProviders(prev => prev.filter(p => p.id !== id));
  };

  const updateRoleLabel = (id: string, role_label: string) => {
    setSelectedProviders(prev =>
      prev.map(p => (p.id === id ? { ...p, role_label } : p))
    );
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: newTask, error } = await supabase
        .from('agreement_tasks')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          category: category as any,
          due_date: dueDate || null,
          status: 'pending' as any,
          created_by: user?.id || null,
          provider_id: selectedProviders[0]?.id || null,
        })
        .select('id')
        .single();

      if (error) throw error;

      // Insert linked providers
      if (newTask && selectedProviders.length > 0) {
        const links = selectedProviders.map(sp => ({
          task_id: newTask.id,
          provider_id: sp.id,
          role_label: sp.role_label,
        }));
        await supabase.from('task_linked_providers').insert(links);
      }

      toast({ title: 'Task created', description: 'New task has been added.' });
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Task
          </DialogTitle>
          <DialogDescription>
            Create a new actionable task and link providers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-task-title">Title</Label>
            <Input
              id="new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-task-desc">Description</Label>
            <Textarea
              id="new-task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Task details…"
            />
          </div>

          <Separator />

          {/* Link Providers */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              Link Providers (up to 3)
            </Label>

            {selectedProviders.length > 0 && (
              <div className="space-y-1.5">
                {selectedProviders.map((sp) => (
                  <div
                    key={sp.id}
                    className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium flex-1 truncate">{sp.full_name || sp.email}</span>
                    <Select value={sp.role_label} onValueChange={(v) => updateRoleLabel(sp.id, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_LABELS.map(r => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeProvider(sp.id)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {selectedProviders.length < 3 && (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={providerSearch}
                    onChange={(e) => setProviderSearch(e.target.value)}
                    placeholder="Search providers…"
                    className="pl-8 h-9 text-sm"
                  />
                </div>
                {providerSearch && (
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
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-task-due">Due Date</Label>
            <Input
              id="new-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
