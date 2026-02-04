import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { CalendarIcon, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgreementFormData } from '../AgreementWizard';

interface AgreementDetailsStepProps {
  formData: AgreementFormData;
  updateFormData: (updates: Partial<AgreementFormData>) => void;
}

export const AgreementDetailsStep = ({ formData, updateFormData }: AgreementDetailsStepProps) => {
  return (
    <div className="space-y-6">
      {/* Info */}
      <Card className="p-4 bg-muted/50">
        <div className="flex items-start gap-3">
          <Settings2 className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h4 className="font-medium text-sm">Agreement Configuration</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Configure the supervision requirements. Defaults are pre-filled based on{' '}
              <strong>{formData.selectedState?.abbreviation}</strong> state requirements.
            </p>
          </div>
        </div>
      </Card>

      {/* Start Date */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          Start Date <span className="text-destructive">*</span>
        </Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal',
                !formData.startDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {formData.startDate ? format(formData.startDate, 'PPP') : 'Pick a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={formData.startDate}
              onSelect={(date) => updateFormData({ startDate: date })}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Renewal Cadence */}
      <div className="space-y-2">
        <Label>Renewal Cadence</Label>
        <Select
          value={formData.renewalCadence}
          onValueChange={(value: 'annual' | 'biennial') => updateFormData({ renewalCadence: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Annual (every year)</SelectItem>
            <SelectItem value="biennial">Biennial (every 2 years)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          How often the agreement needs to be renewed.
        </p>
      </div>

      {/* Meeting Cadence */}
      <div className="space-y-2">
        <Label>Supervision Meeting Cadence</Label>
        <Select
          value={formData.meetingCadence}
          onValueChange={(value: 'weekly' | 'biweekly' | 'monthly' | 'quarterly') => 
            updateFormData({ meetingCadence: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="biweekly">Bi-weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {formData.selectedState?.collaborativeAgreementRequirements?.meetingCadence ? (
            <>State requires: <strong className="capitalize">{formData.selectedState.collaborativeAgreementRequirements.meetingCadence}</strong> meetings</>
          ) : (
            'How often supervision meetings should occur.'
          )}
        </p>
      </div>

      {/* Chart Review */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Chart Review Required</Label>
            <p className="text-xs text-muted-foreground">
              Enable if the physician must review patient charts.
            </p>
          </div>
          <Switch
            checked={formData.chartReviewRequired}
            onCheckedChange={(checked) => updateFormData({ chartReviewRequired: checked })}
          />
        </div>

        {formData.chartReviewRequired && (
          <div className="space-y-2">
            <Label htmlFor="chart-frequency">Review Frequency</Label>
            <Input
              id="chart-frequency"
              placeholder="e.g., 10% of charts monthly"
              value={formData.chartReviewFrequency}
              onChange={(e) => updateFormData({ chartReviewFrequency: e.target.value })}
            />
            {formData.selectedState?.collaborativeAgreementRequirements?.chartReviewFrequency && (
              <p className="text-xs text-muted-foreground">
                State requirement: {formData.selectedState.collaborativeAgreementRequirements.chartReviewFrequency}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
