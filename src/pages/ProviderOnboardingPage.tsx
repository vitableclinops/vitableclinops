import { useNavigate, useSearchParams } from 'react-router-dom';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
import { providers } from '@/data/mockData';
import { toast } from '@/hooks/use-toast';

export default function ProviderOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const mode = (searchParams.get('mode') as 'new' | 'edit' | 'admin') || 'new';
  const providerId = searchParams.get('providerId');
  
  // Find existing provider if editing
  const existingProvider = providerId 
    ? providers.find(p => p.id === providerId)
    : undefined;

  const handleComplete = (data: OnboardingData) => {
    // In a real app, this would save to the backend
    console.log('Onboarding complete:', data);
    
    toast({
      title: mode === 'new' ? 'Onboarding Complete!' : 'Changes Saved',
      description: mode === 'new' 
        ? 'Welcome aboard! Clinical Operations will review your information.'
        : 'Your updates have been submitted for review.',
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
      existingProvider={existingProvider}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
}
