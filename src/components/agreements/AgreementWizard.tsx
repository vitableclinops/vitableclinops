import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StateSelectionStep } from './wizard/StateSelectionStep';
import { PhysicianInfoStep } from './wizard/PhysicianInfoStep';
import { ProviderSelectionStep } from './wizard/ProviderSelectionStep';
import { AgreementDetailsStep } from './wizard/AgreementDetailsStep';
import { ReviewStep } from './wizard/ReviewStep';
import { useAgreementWorkflow } from '@/hooks/useAgreementWorkflow';
import { useStateCompliance } from '@/hooks/useStateCompliance';
import { usePhysicianCapacity } from '@/hooks/usePhysicianCapacity';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';
import type { State } from '@/types';

interface AgreementWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export interface AgreementFormData {
  // State
  selectedState: State | null;
  
  // Physician
  physicianName: string;
  physicianEmail: string;
  physicianNpi: string;
  
  // Providers
  providers: Array<{
    id?: string;
    name: string;
    email: string;
    npi?: string;
  }>;
  
  // Agreement Details
  startDate: Date | undefined;
  renewalCadence: 'annual' | 'biennial';
  meetingCadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  chartReviewRequired: boolean;
  chartReviewFrequency: string;
  
  // Provider Message
  providerMessage: string;
}

const STEPS = [
  { id: 'state', title: 'Select State', description: 'Choose the state for this agreement' },
  { id: 'physician', title: 'Physician Info', description: 'Enter collaborating physician details' },
  { id: 'providers', title: 'Add Providers', description: 'Select providers for this agreement' },
  { id: 'details', title: 'Agreement Details', description: 'Configure supervision requirements' },
  { id: 'review', title: 'Review & Create', description: 'Review and submit the agreement' },
];

export const AgreementWizard = ({ open, onOpenChange, onSuccess }: AgreementWizardProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createAgreementWithTasks } = useAgreementWorkflow();
  const { getStateCompliance } = useStateCompliance();
  const [formData, setFormData] = useState<AgreementFormData>({
    selectedState: null,
    physicianName: '',
    physicianEmail: '',
    physicianNpi: '',
    providers: [],
    startDate: undefined,
    renewalCadence: 'annual',
    meetingCadence: 'monthly',
    chartReviewRequired: false,
    chartReviewFrequency: '',
    providerMessage: '',
  });

  // Check physician capacity
  const stateCompliance = formData.selectedState ? 
    getStateCompliance(formData.selectedState.abbreviation) : null;
  const { capacity } = usePhysicianCapacity(
    formData.physicianEmail,
    formData.selectedState?.abbreviation,
    stateCompliance?.np_md_ratio_limit ?? null
  );

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const updateFormData = (updates: Partial<AgreementFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return formData.selectedState !== null;
      case 1:
        // Block if physician is at capacity
        if (capacity?.isAtCapacity) {
          return false;
        }
        return formData.physicianName.trim() !== '' && formData.physicianEmail.trim() !== '';
      case 2:
        return formData.providers.length > 0;
      case 3:
        return formData.startDate !== undefined;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!formData.selectedState) return;

    setIsSubmitting(true);
    try {
      await createAgreementWithTasks(
        {
          state_id: formData.selectedState.id,
          state_name: formData.selectedState.name,
          state_abbreviation: formData.selectedState.abbreviation,
          physician_name: formData.physicianName,
          physician_email: formData.physicianEmail,
          physician_npi: formData.physicianNpi || null,
          start_date: formData.startDate?.toISOString().split('T')[0],
          renewal_cadence: formData.renewalCadence,
          meeting_cadence: formData.meetingCadence,
          chart_review_required: formData.chartReviewRequired,
          chart_review_frequency: formData.chartReviewFrequency || null,
        },
        formData.providers,
        {
          chartReviewRequired: formData.chartReviewRequired,
          meetingCadence: formData.meetingCadence,
          providerMessage: formData.providerMessage || undefined,
        }
      );

      toast.success('Agreement created — In Progress', {
        description: `Required tasks have been generated for ${formData.selectedState.name}. Complete all tasks to activate.`,
      });

      onOpenChange(false);
      onSuccess?.();
      
      // Reset form
      setCurrentStep(0);
      setFormData({
        selectedState: null,
        physicianName: '',
        physicianEmail: '',
        physicianNpi: '',
        providers: [],
        startDate: undefined,
        renewalCadence: 'annual',
        meetingCadence: 'monthly',
        chartReviewRequired: false,
        chartReviewFrequency: '',
        providerMessage: '',
      });
    } catch (error) {
      console.error('Error creating agreement:', error);
      toast.error('Failed to create agreement', {
        description: 'Please try again or contact support.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <StateSelectionStep formData={formData} updateFormData={updateFormData} />;
      case 1:
        return <PhysicianInfoStep formData={formData} updateFormData={updateFormData} />;
      case 2:
        return <ProviderSelectionStep formData={formData} updateFormData={updateFormData} />;
      case 3:
        return <AgreementDetailsStep formData={formData} updateFormData={updateFormData} />;
      case 4:
        return <ReviewStep formData={formData} updateFormData={updateFormData} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{STEPS[currentStep].title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{STEPS[currentStep].description}</p>
        </DialogHeader>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step {currentStep + 1} of {STEPS.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 py-2">
          {STEPS.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                index < currentStep
                  ? 'bg-primary text-primary-foreground'
                  : index === currentStep
                  ? 'bg-primary/20 text-primary border-2 border-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {index < currentStep ? <Check className="h-4 w-4" /> : index + 1}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[300px] py-4">
          {renderStep()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          
          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Create Agreement
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
