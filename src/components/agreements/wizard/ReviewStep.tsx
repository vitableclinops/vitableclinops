import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { 
  MapPin, 
  UserRound, 
  Users, 
  Calendar, 
  RefreshCw, 
  ClipboardList,
  CheckCircle2
} from 'lucide-react';
import type { AgreementFormData } from '../AgreementWizard';

interface ReviewStepProps {
  formData: AgreementFormData;
}

export const ReviewStep = ({ formData }: ReviewStepProps) => {
  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Review the agreement details below. Once created, the agreement will be in 
          <Badge variant="secondary" className="mx-1">Draft</Badge> 
          status until signatures are collected.
        </p>
      </Card>

      {/* State */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="h-4 w-4 text-primary" />
          <h4 className="font-medium">State</h4>
        </div>
        <div className="pl-6">
          <p className="font-semibold">
            {formData.selectedState?.name} ({formData.selectedState?.abbreviation})
          </p>
          {formData.selectedState?.demandTag && (
            <Badge 
              variant={formData.selectedState.demandTag === 'critical' ? 'destructive' : 'secondary'} 
              className="mt-1 capitalize"
            >
              {formData.selectedState.demandTag.replace('_', ' ')}
            </Badge>
          )}
        </div>
      </Card>

      {/* Physician */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserRound className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Collaborating Physician</h4>
        </div>
        <div className="pl-6 space-y-1">
          <p className="font-semibold">{formData.physicianName}</p>
          <p className="text-sm text-muted-foreground">{formData.physicianEmail}</p>
          {formData.physicianNpi && (
            <p className="text-sm text-muted-foreground">NPI: {formData.physicianNpi}</p>
          )}
        </div>
      </Card>

      {/* Providers */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Providers ({formData.providers.length})</h4>
        </div>
        <div className="pl-6 space-y-2">
          {formData.providers.map((provider, index) => (
            <div key={index} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="font-medium text-sm">{provider.name}</span>
              <span className="text-xs text-muted-foreground">({provider.email})</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Details */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Agreement Details</h4>
        </div>
        <div className="pl-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start Date
            </p>
            <p className="font-medium text-sm">
              {formData.startDate ? format(formData.startDate, 'PPP') : 'Not set'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Renewal Cadence
            </p>
            <p className="font-medium text-sm capitalize">{formData.renewalCadence}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Meeting Cadence</p>
            <p className="font-medium text-sm capitalize">{formData.meetingCadence}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Chart Review</p>
            <p className="font-medium text-sm">
              {formData.chartReviewRequired ? formData.chartReviewFrequency || 'Required' : 'Not required'}
            </p>
          </div>
        </div>
      </Card>

      {/* What happens next */}
      <Card className="p-4 border-primary/20 bg-primary/5">
        <h4 className="font-medium mb-2">What happens next?</h4>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Agreement will be created in <strong>Draft</strong> status</li>
          <li>Send signature request to physician (manual trigger)</li>
          <li>Send signature requests to providers (manual trigger)</li>
          <li>Once all signatures collected, agreement becomes <strong>Active</strong></li>
          <li>Supervision meetings will be scheduled per the cadence</li>
        </ol>
      </Card>
    </div>
  );
};
