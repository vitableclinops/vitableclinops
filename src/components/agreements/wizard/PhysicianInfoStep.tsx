import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { UserRound, Mail, Hash, Info } from 'lucide-react';
import type { AgreementFormData } from '../AgreementWizard';

interface PhysicianInfoStepProps {
  formData: AgreementFormData;
  updateFormData: (updates: Partial<AgreementFormData>) => void;
}

export const PhysicianInfoStep = ({ formData, updateFormData }: PhysicianInfoStepProps) => {
  return (
    <div className="space-y-6">
      {/* Info card */}
      <Card className="p-4 bg-muted/50 border-muted">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h4 className="font-medium text-sm">Collaborating Physician</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the details of the physician who will be supervising the NPs in{' '}
              <strong>{formData.selectedState?.name || 'the selected state'}</strong>.
              They will receive an email to sign the agreement.
            </p>
          </div>
        </div>
      </Card>

      {/* Form fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="physician-name" className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Full Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="physician-name"
            placeholder="Dr. Jane Smith"
            value={formData.physicianName}
            onChange={(e) => updateFormData({ physicianName: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="physician-email" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="physician-email"
            type="email"
            placeholder="jane.smith@hospital.com"
            value={formData.physicianEmail}
            onChange={(e) => updateFormData({ physicianEmail: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            The physician will receive agreement documents at this email.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="physician-npi" className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            NPI Number <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="physician-npi"
            placeholder="1234567890"
            value={formData.physicianNpi}
            onChange={(e) => updateFormData({ physicianNpi: e.target.value })}
            maxLength={10}
          />
          <p className="text-xs text-muted-foreground">
            National Provider Identifier for verification purposes.
          </p>
        </div>
      </div>

      {/* State-specific requirements reminder */}
      {formData.selectedState?.collaborativeAgreementRequirements && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <h4 className="font-medium text-sm mb-2">
            {formData.selectedState.abbreviation} Requirements
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              • Meeting Cadence:{' '}
              <span className="capitalize font-medium">
                {formData.selectedState.collaborativeAgreementRequirements.meetingCadence}
              </span>
            </li>
            {formData.selectedState.collaborativeAgreementRequirements.chartReviewRequired && (
              <li>
                • Chart Review:{' '}
                <span className="font-medium">
                  {formData.selectedState.collaborativeAgreementRequirements.chartReviewFrequency}
                </span>
              </li>
            )}
            {formData.selectedState.prescriptiveAuthorityNotes && (
              <li>• {formData.selectedState.prescriptiveAuthorityNotes}</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
};
