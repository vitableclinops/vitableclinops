import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, ExternalLink, GraduationCap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useStateCompliance } from '@/hooks/useStateCompliance';

interface LicensureTemplate {
  id: string;
  state_abbreviation: string;
  designation_type: string;
  designation_label: string;
  sort_order: number;
  application_url: string | null;
  estimated_fee: number | null;
  estimated_timeline: string | null;
  notes: string | null;
  required_documents: string[] | null;
  steps: any[];
  kb_article_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FormData {
  state_abbreviation: string;
  designation_type: string;
  designation_label: string;
  sort_order: number;
  application_url: string;
  estimated_fee: string;
  estimated_timeline: string;
  notes: string;
  required_documents: string;
  is_active: boolean;
}

const emptyForm: FormData = {
  state_abbreviation: '',
  designation_type: 'initial_license',
  designation_label: 'NP License',
  sort_order: 0,
  application_url: '',
  estimated_fee: '',
  estimated_timeline: '',
  notes: '',
  required_documents: '',
  is_active: true,
};

const LicensureTemplateManager = () => {
  const { allData: states } = useStateCompliance();
  const [templates, setTemplates] = useState<LicensureTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filterState, setFilterState] = useState<string>('all');

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('state_licensure_templates')
      .select('*')
      .order('state_abbreviation')
      .order('sort_order');
    if (error) {
      toast.error('Failed to load templates');
    } else {
      setTemplates((data || []) as LicensureTemplate[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (t: LicensureTemplate) => {
    setEditingId(t.id);
    setForm({
      state_abbreviation: t.state_abbreviation,
      designation_type: t.designation_type,
      designation_label: t.designation_label,
      sort_order: t.sort_order,
      application_url: t.application_url || '',
      estimated_fee: t.estimated_fee?.toString() || '',
      estimated_timeline: t.estimated_timeline || '',
      notes: t.notes || '',
      required_documents: (t.required_documents || []).join('\n'),
      is_active: t.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.state_abbreviation) {
      toast.error('State is required');
      return;
    }
    setSaving(true);
    const payload = {
      state_abbreviation: form.state_abbreviation,
      designation_type: form.designation_type,
      designation_label: form.designation_label,
      sort_order: form.sort_order,
      application_url: form.application_url || null,
      estimated_fee: form.estimated_fee ? parseFloat(form.estimated_fee) : null,
      estimated_timeline: form.estimated_timeline || null,
      notes: form.notes || null,
      required_documents: form.required_documents
        ? form.required_documents.split('\n').map(s => s.trim()).filter(Boolean)
        : null,
      is_active: form.is_active,
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from('state_licensure_templates').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('state_licensure_templates').insert(payload));
    }

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingId ? 'Template updated' : 'Template created');
      setDialogOpen(false);
      fetchTemplates();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('state_licensure_templates').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Template deleted');
      fetchTemplates();
    }
  };

  const filtered = filterState === 'all' 
    ? templates 
    : templates.filter(t => t.state_abbreviation === filterState);

  // Unique states that have templates
  const statesWithTemplates = [...new Set(templates.map(t => t.state_abbreviation))].sort();
  const statesWithoutTemplates = states
    .filter(s => !statesWithTemplates.includes(s.state_abbreviation))
    .map(s => s.state_abbreviation)
    .sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {templates.length} template{templates.length !== 1 ? 's' : ''} across {statesWithTemplates.length} state{statesWithTemplates.length !== 1 ? 's' : ''}
            {statesWithoutTemplates.length > 0 && (
              <span className="text-warning ml-2">
                • {statesWithoutTemplates.length} state{statesWithoutTemplates.length !== 1 ? 's' : ''} without templates
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={filterState} onValueChange={setFilterState}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {statesWithTemplates.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Template
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading templates…</div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-4">No licensure templates configured yet.</p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[80px]">State</TableHead>
                <TableHead className="min-w-[160px]">Designation</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Timeline</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(t => (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className="font-bold text-primary">{t.state_abbreviation}</span>
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium text-sm">{t.designation_label}</span>
                      <span className="block text-xs text-muted-foreground">{t.designation_type.replace(/_/g, ' ')}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.estimated_fee ? `$${t.estimated_fee}` : '—'}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{t.estimated_timeline || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {t.required_documents?.length || 0} items
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={t.is_active ? 'default' : 'secondary'} className="text-xs">
                      {t.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit' : 'Create'} Licensure Template</DialogTitle>
            <DialogDescription>
              Define the licensure steps, fees, and requirements for a state designation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>State</Label>
                <Select value={form.state_abbreviation} onValueChange={v => setForm(f => ({ ...f, state_abbreviation: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {states.map(s => (
                      <SelectItem key={s.state_abbreviation} value={s.state_abbreviation}>
                        {s.state_abbreviation} — {s.state_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Designation Type</Label>
                <Select value={form.designation_type} onValueChange={v => setForm(f => ({ ...f, designation_type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="initial_license">Initial License</SelectItem>
                    <SelectItem value="autonomous_practice">Autonomous Practice</SelectItem>
                    <SelectItem value="telehealth_registration">Telehealth Registration</SelectItem>
                    <SelectItem value="prescriptive_authority">Prescriptive Authority</SelectItem>
                    <SelectItem value="renewal">Renewal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Designation Label</Label>
              <Input
                value={form.designation_label}
                onChange={e => setForm(f => ({ ...f, designation_label: e.target.value }))}
                placeholder="e.g. NP License, Autonomous Practice Designation"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimated Fee ($)</Label>
                <Input
                  type="number"
                  value={form.estimated_fee}
                  onChange={e => setForm(f => ({ ...f, estimated_fee: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Estimated Timeline</Label>
                <Input
                  value={form.estimated_timeline}
                  onChange={e => setForm(f => ({ ...f, estimated_timeline: e.target.value }))}
                  placeholder="e.g. 4-6 weeks"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Application URL</Label>
              <Input
                value={form.application_url}
                onChange={e => setForm(f => ({ ...f, application_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2">
              <Label>Required Documents (one per line)</Label>
              <Textarea
                value={form.required_documents}
                onChange={e => setForm(f => ({ ...f, required_documents: e.target.value }))}
                placeholder="Official transcripts&#10;Background check&#10;Passport photo"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Notes / Tips</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any gotchas, tips, or special requirements…"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export { LicensureTemplateManager };
