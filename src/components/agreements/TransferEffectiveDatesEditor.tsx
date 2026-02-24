import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Pencil, Save, X } from 'lucide-react';
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';

interface TransferEffectiveDatesEditorProps {
  transferId: string;
  terminationEffectiveDate?: string | null;
  initiationEffectiveDate?: string | null;
  effectiveDate?: string | null; // Legacy single date
  isAdmin: boolean;
  onUpdate: () => void;
}

export function TransferEffectiveDatesEditor({
  transferId,
  terminationEffectiveDate,
  initiationEffectiveDate,
  effectiveDate,
  isAdmin,
  onUpdate,
}: TransferEffectiveDatesEditorProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [termDate, setTermDate] = useState(terminationEffectiveDate || effectiveDate || '');
  const [initDate, setInitDate] = useState(initiationEffectiveDate || effectiveDate || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('agreement_transfers')
        .update({
          termination_effective_date: termDate || null,
          initiation_effective_date: initDate || null,
          effective_date: termDate || initDate || null, // Keep legacy field in sync
        })
        .eq('id', transferId);

      if (error) throw error;

      // Log activity
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        activity_type: 'dates_updated',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: 'Updated effective dates',
        metadata: {
          termination_effective_date: termDate,
          initiation_effective_date: initDate,
        },
      });

      toast({ title: 'Dates updated' });
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating dates:', error);
      toast({ title: 'Error', description: 'Failed to update dates.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin && !terminationEffectiveDate && !initiationEffectiveDate && !effectiveDate) {
    return null;
  }

  if (editing) {
    return (
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Effective Dates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Termination Effective Date</Label>
              <Input
                type="date"
                value={termDate}
                onChange={(e) => setTermDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Initiation Effective Date</Label>
              <Input
                type="date"
                value={initDate}
                onChange={(e) => setInitDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="h-3 w-3 mr-1" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
      <div className="flex items-center gap-4">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Termination: </span>
            <span className="font-medium">
              {terminationEffectiveDate || effectiveDate 
                ? format(parseLocalDate(terminationEffectiveDate || effectiveDate!), 'MMM d, yyyy')
                : 'Not set'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Initiation: </span>
            <span className="font-medium">
              {initiationEffectiveDate 
                ? format(parseLocalDate(initiationEffectiveDate), 'MMM d, yyyy')
                : 'Not set'}
            </span>
          </div>
        </div>
      </div>
      {isAdmin && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
