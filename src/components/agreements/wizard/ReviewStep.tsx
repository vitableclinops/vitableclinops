import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { 
  MapPin, 
  UserRound, 
  Users, 
  Calendar, 
  RefreshCw, 
  ClipboardList,
  CheckCircle2,
  MessageSquare,
} from 'lucide-react';
import type { AgreementFormData } from '../AgreementWizard';

interface ReviewStepProps {
  formData: AgreementFormData;
  updateFormData?: (updates: Partial<AgreementFormData>) => void;
}

export const ReviewStep = ({ formData, updateFormData }: ReviewStepProps) => {
  const [templates, setTemplates] = useState<Array<{ id: string; template_name: string; body_template: string; subject_template: string }>>([]);

  useEffect(() => {
    const fetchTemplates = async () => {
      const { data } = await supabase
        .from('workflow_message_templates')
        .select('id, template_name, body_template, subject_template')
        .eq('workflow_type', 'initiation');
      setTemplates(data || []);
    };
    fetchTemplates();
  }, []);

  const applyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template || !updateFormData) return;
    
    let body = template.body_template;
    body = body.replace(/\{\{provider_name\}\}/g, formData.providers[0]?.name || '[Provider Name]');
    body = body.replace(/\{\{physician_name\}\}/g, formData.physicianName || '[Physician Name]');
    body = body.replace(/\{\{state_name\}\}/g, formData.selectedState?.name || '[State]');
    body = body.replace(/\{\{admin_name\}\}/g, '[Your Name]');
    
    updateFormData({ providerMessage: body });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Review the agreement details below. Once created, the agreement will be in 
          <Badge variant="default" className="mx-1">In Progress</Badge> 
          status with required tasks auto-generated.
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

      {/* Provider Message */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h4 className="font-medium">Provider-Facing Message</h4>
        </div>
        <div className="pl-6 space-y-3">
          {templates.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Load from template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a message template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Textarea
            placeholder="Enter a provider-facing message for this agreement (optional)..."
            value={formData.providerMessage}
            onChange={(e) => updateFormData?.({ providerMessage: e.target.value })}
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            This message is stored on the agreement record and shown to admins as a copy/paste email template.
          </p>
        </div>
      </Card>

      {/* What happens next */}
      <Card className="p-4 border-primary/20 bg-primary/5">
        <h4 className="font-medium mb-2">What happens next?</h4>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Agreement will be created in <strong>In Progress</strong> status</li>
          <li>Required setup tasks are auto-generated (confirm eligibility, signatures, etc.)</li>
          <li>Agreement <strong>cannot</strong> be marked Active until all required tasks are complete</li>
          <li>At minimum: signed document uploaded + provider notified</li>
          <li>Supervision meetings will be scheduled per the cadence</li>
        </ol>
      </Card>
    </div>
  );
};
