import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Check, User, MapPin, FileCheck, ClipboardCheck, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StateSelectionStep } from './StateSelectionStep';
import { LicenseReportingStep } from './LicenseReportingStep';
import { ReviewStep } from './ReviewStep';
import { WelcomeStep } from './WelcomeStep';
import { ProviderTypeStep } from './ProviderTypeStep';
import { PROVIDER_TYPE_CONFIG, type Provider, type ProviderType } from '@/types';

export interface OnboardingData {
  providerId?: string;
  providerType: ProviderType | null;
  providerName: string;
  providerEmail: string;
  npiNumber: string;
  selectedStates: string[];
  reportedLicenses: ReportedLicense[];
}

export interface ReportedLicense {
  id: string;
  state: string;
  licenseType: string;
  licenseNumber: string;
  expirationDate: string;
  evidenceUploaded: boolean;
  notes: string;
}

interface OnboardingWizardProps {
  mode: 'new' | 'edit' | 'admin';
  existingProvider?: Provider;
  onComplete: (data: OnboardingData) => void;
  onCancel: () => void;
}

interface Step {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function OnboardingWizard({ mode, existingProvider, onComplete, onCancel }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(() => {
    if (existingProvider) {
      const fullName = `${existingProvider.firstName} ${existingProvider.lastName}`;
      return {
        providerId: existingProvider.id,
        providerType: existingProvider.providerType,
        providerName: fullName,
        providerEmail: existingProvider.email,
        npiNumber: existingProvider.npiNumber || '',
        selectedStates: existingProvider.states.map(s => s.state.abbreviation),
        reportedLicenses: existingProvider.states.flatMap(s => 
          s.licenses.map(l => ({
            id: `${s.state.abbreviation}-${l.type}`,
            state: s.state.abbreviation,
            licenseType: 'APRN',
            licenseNumber: l.licenseNumber || '',
            expirationDate: l.expirationDate ? new Date(l.expirationDate).toISOString().split('T')[0] : '',
            evidenceUploaded: false,
            notes: '',
          }))
        ),
      };
    }
    return {
      providerType: null,
      providerName: '',
      providerEmail: '',
      npiNumber: '',
      selectedStates: [],
      reportedLicenses: [],
    };
  });

  // Dynamic steps based on provider type
  const steps: Step[] = useMemo(() => {
    const baseSteps: Step[] = [
      { id: 'type', label: 'Provider Type', icon: UserCog },
      { id: 'welcome', label: 'Your Info', icon: User },
    ];

    // If provider type requires licensure, add state and license steps
    if (data.providerType && PROVIDER_TYPE_CONFIG[data.providerType].requiresLicensure) {
      baseSteps.push(
        { id: 'states', label: 'Select States', icon: MapPin },
        { id: 'licenses', label: 'Report Licenses', icon: FileCheck }
      );
    }

    baseSteps.push({ id: 'review', label: 'Review & Submit', icon: ClipboardCheck });

    return baseSteps;
  }, [data.providerType]);

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    onComplete(data);
  };

  const canProceed = () => {
    const currentStepId = steps[currentStep]?.id;
    switch (currentStepId) {
      case 'type':
        return data.providerType !== null;
      case 'welcome':
        if (data.providerType && PROVIDER_TYPE_CONFIG[data.providerType].requiresNPI) {
          return data.providerName.trim() !== '' && data.providerEmail.trim() !== '' && data.npiNumber.trim() !== '';
        }
        return data.providerName.trim() !== '' && data.providerEmail.trim() !== '';
      case 'states':
        return data.selectedStates.length > 0;
      case 'licenses':
        return true; // Licenses are optional for self-reporting
      case 'review':
        return true;
      default:
        return true;
    }
  };

  const getModeTitle = () => {
    switch (mode) {
      case 'new':
        return 'Provider Onboarding';
      case 'edit':
        return 'Update Your Information';
      case 'admin':
        return `Edit Provider: ${existingProvider ? `${existingProvider.firstName} ${existingProvider.lastName}` : 'New Provider'}`;
    }
  };

  const getModeDescription = () => {
    switch (mode) {
      case 'new':
        return 'Welcome! Let\'s get you set up to practice.';
      case 'edit':
        return 'Update your information and license details.';
      case 'admin':
        return 'Review and update provider information.';
    }
  };

  const renderStep = () => {
    const currentStepId = steps[currentStep]?.id;
    switch (currentStepId) {
      case 'type':
        return (
          <ProviderTypeStep
            mode={mode}
            selectedType={data.providerType}
            onSelect={(type) => updateData({ providerType: type })}
          />
        );
      case 'welcome':
        return (
          <WelcomeStep
            mode={mode}
            data={data}
            onUpdate={updateData}
          />
        );
      case 'states':
        return (
          <StateSelectionStep
            selectedStates={data.selectedStates}
            onUpdate={(states) => updateData({ selectedStates: states })}
            providerType={data.providerType}
          />
        );
      case 'licenses':
        return (
          <LicenseReportingStep
            selectedStates={data.selectedStates}
            reportedLicenses={data.reportedLicenses}
            onUpdate={(licenses) => updateData({ reportedLicenses: licenses })}
            providerType={data.providerType}
          />
        );
      case 'review':
        return (
          <ReviewStep
            data={data}
            mode={mode}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">{getModeTitle()}</h1>
          <p className="text-muted-foreground">{getModeDescription()}</p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              
              return (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-center gap-2',
                    index < steps.length - 1 && 'flex-1'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                      isCompleted && 'bg-primary border-primary text-primary-foreground',
                      isCurrent && 'border-primary text-primary',
                      !isCompleted && !isCurrent && 'border-muted text-muted-foreground'
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        'h-0.5 flex-1 mx-2',
                        isCompleted ? 'bg-primary' : 'bg-muted'
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            {steps.map((step, index) => (
              <span
                key={step.id}
                className={cn(
                  'text-center',
                  index === currentStep && 'text-primary font-medium'
                )}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            {renderStep()}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={currentStep === 0 ? onCancel : handleBack}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </Button>

          {currentStep === steps.length - 1 ? (
            <Button onClick={handleComplete}>
              <Check className="h-4 w-4 mr-2" />
              {mode === 'new' ? 'Complete Setup' : 'Save Changes'}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
