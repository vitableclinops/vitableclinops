import { useState, useCallback, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Check, User, MapPin, FileCheck, ClipboardCheck, UserCog, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { StateSelectionStep } from './StateSelectionStep';
import { LicenseReportingStep } from './LicenseReportingStep';
import { ReviewStep } from './ReviewStep';
import { WelcomeStep } from './WelcomeStep';
import { ProviderTypeStep } from './ProviderTypeStep';
import { CollaborationConsentStep } from './CollaborationConsentStep';
import { PROVIDER_TYPE_CONFIG, type Provider, type ProviderType } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { 
  getCollabRequirementType, 
  isNPProhibitedState, 
  type CollabRequirementType 
} from '@/constants/stateRestrictions';

export interface OnboardingData {
  providerId?: string;
  providerType: ProviderType | null;
  providerName: string;
  providerEmail: string;
  npiNumber: string;
  selectedStates: string[];
  reportedLicenses: ReportedLicense[];
  avatarUrl?: string;
  bio?: string;
  minPatientAge?: string;
  pendingApplications?: PendingApplication[];
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

export interface PendingApplication {
  stateAbbr: string;
  submittedDate?: string;
  expectedTimeline?: string;
  notes?: string;
}

export interface CollabClassification {
  always: string[];
  conditional: string[];
  never: string[];
}

interface OnboardingWizardProps {
  mode: 'new' | 'edit' | 'admin';
  existingProvider?: Provider;
  userId?: string;
  onComplete: (data: OnboardingData, collabClassification: CollabClassification) => void;
  onCancel: () => void;
}

interface Step {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function OnboardingWizard({ mode, existingProvider, userId, onComplete, onCancel }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();
  const [collaborationConsent, setCollaborationConsent] = useState(false);
  const [collabClassification, setCollabClassification] = useState<CollabClassification>({
    always: [],
    conditional: [],
    never: [],
  });
  
  const [data, setData] = useState<OnboardingData>(() => {
    // Pre-populate from existing profile data if available
    if (profile) {
      return {
        providerId: profile.id,
        providerType: (profile.profession as ProviderType) || null,
        providerName: profile.full_name || '',
        providerEmail: profile.email,
        npiNumber: profile.npi_number || '',
        selectedStates: [],
        reportedLicenses: [],
        avatarUrl: profile.avatar_url || undefined,
        bio: profile.bio || undefined,
        minPatientAge: profile.min_patient_age || undefined,
        pendingApplications: [],
      };
    }
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
        pendingApplications: [],
      };
    }
    return {
      providerType: null,
      providerName: '',
      providerEmail: user?.email || '',
      npiNumber: '',
      selectedStates: [],
      reportedLicenses: [],
      pendingApplications: [],
    };
  });

  // Classify states by collaboration requirement type
  useEffect(() => {
    const classifyStates = async () => {
      if (!data.selectedStates.length) {
        setCollabClassification({ always: [], conditional: [], never: [] });
        return;
      }

      // Filter out NP-prohibited states if provider is NP
      const isNP = data.providerType === 'nurse_practitioner';
      const validStates = data.selectedStates.filter(s => 
        !isNP || !isNPProhibitedState(s)
      );

      // Classify states using constants (primary source of truth)
      const always: string[] = [];
      const conditional: string[] = [];
      const never: string[] = [];

      validStates.forEach(stateAbbr => {
        const type = getCollabRequirementType(stateAbbr);
        if (type === 'always') {
          always.push(stateAbbr);
        } else if (type === 'conditional') {
          conditional.push(stateAbbr);
        } else {
          never.push(stateAbbr);
        }
      });

      setCollabClassification({ always, conditional, never });
    };

    classifyStates();
  }, [data.selectedStates, data.providerType]);

  // Dynamic steps based on provider type
  const steps: Step[] = useMemo(() => {
    const baseSteps: Step[] = [
      { id: 'type', label: 'Provider Type', icon: UserCog },
      { id: 'welcome', label: 'Your Profile', icon: User },
    ];

    // If provider type requires licensure, add state and license steps
    const typeConfig = data.providerType ? PROVIDER_TYPE_CONFIG[data.providerType] : undefined;
    if (typeConfig?.requiresLicensure) {
      baseSteps.push(
        { id: 'states', label: 'Select States', icon: MapPin },
        { id: 'licenses', label: 'Report Licenses', icon: FileCheck }
      );
    }

    // Add collaboration consent step if there are "always" collab states
    if (collabClassification.always.length > 0) {
      baseSteps.push({ id: 'collaboration', label: 'Collaboration', icon: Users });
    }

    baseSteps.push({ id: 'review', label: 'Review & Submit', icon: ClipboardCheck });

    return baseSteps;
  }, [data.providerType, collabClassification.always.length]);

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

  const persistOnboardingData = async () => {
    if (!profile?.id) {
      throw new Error('No profile found');
    }

    // Parse name into first/last
    const nameParts = data.providerName.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Determine activation status based on collab classification
    let activationStatus = 'ready';
    if (collabClassification.always.length > 0) {
      activationStatus = 'pending_agreements';
    } else if (collabClassification.conditional.length > 0) {
      activationStatus = 'pending_review';
    }

    // Update profiles table with all onboarding data
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: data.providerName,
        first_name: firstName,
        last_name: lastName,
        npi_number: data.npiNumber || null,
        profession: data.providerType,
        avatar_url: data.avatarUrl || null,
        bio: data.bio || null,
        min_patient_age: data.minPatientAge || null,
        // actively_licensed_states removed — derived from provider_state_status
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        activation_status: activationStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    if (profileError) throw profileError;

    // Insert/update provider_licenses for each selected state
    for (const stateAbbr of data.selectedStates) {
      const reportedLicense = data.reportedLicenses.find(l => l.state === stateAbbr);
      const collabType = getCollabRequirementType(stateAbbr);
      const requiresCollab = collabType === 'always';

      // Check if license already exists
      const { data: existingLicense } = await supabase
        .from('provider_licenses')
        .select('id')
        .eq('profile_id', profile.id)
        .eq('state_abbreviation', stateAbbr)
        .maybeSingle();

      if (existingLicense) {
        // Update existing
        await supabase
          .from('provider_licenses')
          .update({
            license_number: reportedLicense?.licenseNumber || null,
            expiration_date: reportedLicense?.expirationDate || null,
            license_type: reportedLicense?.licenseType || 'APRN',
            requires_collab_agreement: requiresCollab,
            status: 'reported',
            notes: reportedLicense?.notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingLicense.id);
      } else {
        // Insert new
        await supabase
          .from('provider_licenses')
          .insert({
            profile_id: profile.id,
            provider_email: data.providerEmail,
            state_abbreviation: stateAbbr,
            license_number: reportedLicense?.licenseNumber || null,
            expiration_date: reportedLicense?.expirationDate || null,
            license_type: reportedLicense?.licenseType || 'APRN',
            requires_collab_agreement: requiresCollab,
            status: 'reported',
            notes: reportedLicense?.notes || null,
          });
      }
    }

    // Insert pending license applications
    if (data.pendingApplications && data.pendingApplications.length > 0) {
      for (const app of data.pendingApplications) {
        await supabase
          .from('provider_license_applications')
          .upsert({
            profile_id: profile.id,
            state_abbreviation: app.stateAbbr,
            application_submitted_date: app.submittedDate || null,
            expected_approval_date: app.expectedTimeline || null,
            notes: app.notes || null,
            status: 'pending',
          }, {
            onConflict: 'profile_id,state_abbreviation',
          });
      }
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Persist data to Supabase
      await persistOnboardingData();

      // Call onComplete with data and collab classification
      onComplete(data, collabClassification);

      const hasCollab = collabClassification.always.length > 0;
      const hasConditional = collabClassification.conditional.length > 0;

      toast({
        title: 'Onboarding Complete!',
        description: hasCollab
          ? 'Clinical Operations will contact you about collaborative agreements.'
          : hasConditional
            ? 'Some states require review by Clinical Operations.'
            : 'Your profile has been saved. Welcome aboard!',
      });
    } catch (error) {
      console.error('Error completing onboarding:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete onboarding. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
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
      case 'collaboration':
        return collaborationConsent;
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
            pendingApplications={data.pendingApplications}
            onPendingApplicationsUpdate={(apps) => updateData({ pendingApplications: apps })}
            showPendingOption={true}
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
       case 'collaboration':
         return (
           <CollaborationConsentStep
             statesRequiringCollab={collabClassification.always}
             conditionalStates={collabClassification.conditional}
             onConsent={(consented) => setCollaborationConsent(consented)}
             consented={collaborationConsent}
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
            <Button onClick={handleComplete} disabled={isSubmitting}>
              <Check className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Saving...' : mode === 'new' ? 'Complete Setup' : 'Save Changes'}
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
