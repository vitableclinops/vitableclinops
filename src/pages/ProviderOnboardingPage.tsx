import { useNavigate, useSearchParams } from 'react-router-dom';
import { OnboardingWizard, OnboardingData, CollabClassification } from '@/components/onboarding/OnboardingWizard';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export default function ProviderOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile, refreshProfile } = useAuth();
  
  const mode = (searchParams.get('mode') as 'new' | 'edit' | 'admin') || 'new';

  const handleComplete = async (data: OnboardingData, collabClassification: CollabClassification) => {
    try {
      // Call the edge function to create agreements, tasks, and license review tasks
      // This runs with service role to bypass RLS on admin-only tables
      const { data: result, error } = await supabase.functions.invoke('complete-onboarding', {
        body: {
          alwaysCollabStates: collabClassification.always,
          conditionalStates: collabClassification.conditional,
          reportedLicenses: data.reportedLicenses || [],
          providerName: data.providerName,
          providerEmail: data.providerEmail,
          npiNumber: data.npiNumber,
        },
      });

      if (error) {
        console.error('Error in onboarding completion:', error);
        toast({
          title: 'Warning',
          description: 'Onboarding saved, but there was an issue creating some records. Clinical Ops will follow up.',
          variant: 'destructive',
        });
      } else if (result?.errors?.length > 0) {
        console.warn('Partial onboarding errors:', result.errors);
      }
    } catch (error) {
      console.error('Error completing onboarding tasks:', error);
      toast({
        title: 'Warning',
        description: 'Onboarding saved, but there was an issue creating collaboration records. Clinical Ops will follow up.',
        variant: 'destructive',
      });
    }

    // Refresh the profile in auth context so ProtectedRoute sees onboarding_completed = true
    await refreshProfile();

    toast({
      title: mode === 'new' ? 'Onboarding Complete!' : 'Changes Saved',
      description: mode === 'new' 
        ? 'Welcome aboard! You\'ll be redirected to your dashboard.'
        : 'Your updates have been saved.',
    });

    // Navigate based on mode
    if (mode === 'admin') {
      navigate('/providers');
    } else {
      navigate('/provider');
    }
  };

  const handleCancel = () => {
    if (mode === 'admin') {
      navigate('/providers');
    } else if (mode === 'edit') {
      navigate('/provider');
    } else {
      navigate('/');
    }
  };

  return (
    <OnboardingWizard
      mode={mode}
      userId={profile?.user_id || undefined}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
}