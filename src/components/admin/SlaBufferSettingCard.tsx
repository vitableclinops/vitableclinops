import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Sliders } from 'lucide-react';
import { useSystemConfig, useSlaBufferMultiplier, useUpdateSystemConfig } from '@/hooks/useSystemConfig';
import {
  slaTargetSlots,
  slaTargetHours,
  weeklyHoursWithBuffer,
  round1,
  DEFAULT_SLA_BUFFER,
} from '@/lib/slaFormulas';

export function SlaBufferSettingCard() {
  const buffer = useSlaBufferMultiplier();
  const { isLoading } = useSystemConfig('sla_buffer_multiplier');
  const update = useUpdateSystemConfig();
  const [draft, setDraft] = useState(String(buffer));

  useEffect(() => {
    setDraft(String(buffer));
  }, [buffer]);

  const numeric = Number(draft);
  const isValid = Number.isFinite(numeric) && numeric > 0 && numeric <= 5;
  const isDirty = isValid && Math.abs(numeric - buffer) > 1e-6;

  const handleSave = () => {
    if (!isValid) return;
    update.mutate({
      key: 'sla_buffer_multiplier',
      value: { value: numeric },
      description: 'Multiplier applied to expected daily demand to set the daily SLA target.',
    });
  };

  // Preview using a representative state (e.g. 100 weekly visits)
  const sampleVisits = 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sliders className="h-5 w-5" />
          SLA Buffer Multiplier
        </CardTitle>
        <CardDescription>
          Applied to expected daily demand from the weekly forecast to set the daily SLA
          target. <strong>Daily target = (weekly visits ÷ 5) × buffer</strong>. Default {DEFAULT_SLA_BUFFER}
          {' '}(50% headroom for no-shows, peak hours, urgent visits).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3 max-w-md">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="sla-buffer">Buffer (×)</Label>
            <Input
              id="sla-buffer"
              type="number"
              step="0.1"
              min="0.1"
              max="5"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isLoading || update.isPending}
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={!isDirty || update.isPending}
            className="gap-2"
          >
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>

        {!isValid && draft !== '' && (
          <p className="text-xs text-destructive">Enter a number between 0.1 and 5.</p>
        )}

        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-medium text-foreground">
            Preview: state with {sampleVisits} projected visits/week
          </p>
          <div className="grid grid-cols-3 gap-2 font-mono">
            <div>
              <p className="text-muted-foreground">Daily target</p>
              <p className="text-sm">{round1(slaTargetSlots(sampleVisits, isValid ? numeric : buffer))} slots</p>
            </div>
            <div>
              <p className="text-muted-foreground">Daily target</p>
              <p className="text-sm">{round1(slaTargetHours(sampleVisits, isValid ? numeric : buffer))} hours</p>
            </div>
            <div>
              <p className="text-muted-foreground">Weekly hours</p>
              <p className="text-sm">{round1(weeklyHoursWithBuffer(sampleVisits, isValid ? numeric : buffer))} hours</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
