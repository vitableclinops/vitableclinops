import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MeetingMonthsEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stateAbbreviation: string;
  stateName: string;
  currentMonths: number[];
  onSave: () => void;
}

const MONTHS = [
  { value: 1, label: 'January', short: 'Jan' },
  { value: 2, label: 'February', short: 'Feb' },
  { value: 3, label: 'March', short: 'Mar' },
  { value: 4, label: 'April', short: 'Apr' },
  { value: 5, label: 'May', short: 'May' },
  { value: 6, label: 'June', short: 'Jun' },
  { value: 7, label: 'July', short: 'Jul' },
  { value: 8, label: 'August', short: 'Aug' },
  { value: 9, label: 'September', short: 'Sep' },
  { value: 10, label: 'October', short: 'Oct' },
  { value: 11, label: 'November', short: 'Nov' },
  { value: 12, label: 'December', short: 'Dec' },
];

const PRESETS = [
  { label: 'Monthly', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { label: 'Quarterly (Jan)', months: [1, 4, 7, 10] },
  { label: 'Quarterly (Feb)', months: [2, 5, 8, 11] },
  { label: 'Quarterly (Mar)', months: [3, 6, 9, 12] },
  { label: 'Bi-annually', months: [1, 7] },
  { label: 'Annually', months: [1] },
  { label: 'None', months: [] },
];

export function MeetingMonthsEditor({
  open,
  onOpenChange,
  stateAbbreviation,
  stateName,
  currentMonths,
  onSave,
}: MeetingMonthsEditorProps) {
  const { toast } = useToast();
  const [selectedMonths, setSelectedMonths] = useState<number[]>(currentMonths);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedMonths(currentMonths);
    }
  }, [open, currentMonths]);

  const toggleMonth = (month: number) => {
    setSelectedMonths(prev => 
      prev.includes(month)
        ? prev.filter(m => m !== month)
        : [...prev, month].sort((a, b) => a - b)
    );
  };

  const applyPreset = (months: number[]) => {
    setSelectedMonths(months);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('state_compliance_requirements')
        .update({ 
          meeting_months: selectedMonths,
          updated_at: new Date().toISOString(),
        })
        .eq('state_abbreviation', stateAbbreviation);

      if (error) throw error;

      toast({
        title: 'Meeting months updated',
        description: `${stateName} now requires meetings in ${selectedMonths.length} months.`,
      });
      
      onSave();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving meeting months:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save meeting months.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const getCadenceDescription = () => {
    if (selectedMonths.length === 0) return 'No meetings required';
    if (selectedMonths.length === 12) return 'Monthly meetings';
    if (selectedMonths.length === 4) return 'Quarterly meetings';
    if (selectedMonths.length === 2) return 'Bi-annual meetings';
    if (selectedMonths.length === 1) return 'Annual meeting';
    return `${selectedMonths.length} meetings per year`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Configure Meeting Months
          </DialogTitle>
          <DialogDescription>
            Set which months require collaborative meetings for {stateName} ({stateAbbreviation})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset.months)}
                  className={cn(
                    JSON.stringify(selectedMonths) === JSON.stringify(preset.months) &&
                    'border-primary bg-primary/5'
                  )}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Month Grid */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Select Months</Label>
            <div className="grid grid-cols-4 gap-2">
              {MONTHS.map(month => (
                <div
                  key={month.value}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                    selectedMonths.includes(month.value)
                      ? 'bg-primary/10 border-primary'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => toggleMonth(month.value)}
                >
                  <Checkbox
                    checked={selectedMonths.includes(month.value)}
                    onCheckedChange={() => toggleMonth(month.value)}
                  />
                  <span className="text-sm">{month.short}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cadence:</span>
                <Badge variant="secondary">{getCadenceDescription()}</Badge>
              </div>
              {selectedMonths.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedMonths.map(m => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {MONTHS.find(month => month.value === m)?.short}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}