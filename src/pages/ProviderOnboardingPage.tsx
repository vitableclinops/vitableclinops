import { useNavigate, useSearchParams } from 'react-router-dom';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAgreementTasks } from '@/hooks/useAgreementTasks';
import { toast } from '@/hooks/use-toast';

export default function ProviderOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { generateAgreementTasks } = useAgreementTasks();
  
  const mode = (searchParams.get('mode') as 'new' | 'edit' | 'admin') || 'new';
  const providerId = searchParams.get('providerId');

  const createPendingAgreements = async (
    data: OnboardingData,
    statesRequiringCollab: string[]
  ) => {
    if (!profile?.id || statesRequiringCollab.length === 0) return;

    try {
      // Fetch state names for each abbreviation
      const { data: stateData } = await supabase
        .from('state_compliance_requirements')
        .select('state_abbreviation, state_name')
        .in('state_abbreviation', statesRequiringCollab);

      const stateMap = new Map(
        (stateData || []).map(s => [s.state_abbreviation, s.state_name])
      );

      // Create pending collaborative agreements for each state requiring one
      for (const stateAbbr of statesRequiringCollab) {
        const stateName = stateMap.get(stateAbbr) || stateAbbr;

        // Check if agreement already exists for this provider/state
        const { data: existingAgreement } = await supabase
          .from('collaborative_agreements')
          .select('id')
          .eq('state_abbreviation', stateAbbr)
          .maybeSingle();

        // For now, check via agreement_providers if this provider is already linked
        if (existingAgreement) {
          const { data: existingLink } = await supabase
            .from('agreement_providers')
            .select('id')
            .eq('agreement_id', existingAgreement.id)
            .eq('provider_id', profile.id)
            .maybeSingle();

          if (existingLink) {
            console.log(`Agreement already exists for ${stateAbbr}, skipping`);
            continue;
          }
        }

        // Create a placeholder pending agreement
        // Note: physician details are TBD - Clinical Ops will assign later
        const { data: newAgreement, error: agreementError } = await supabase
          .from('collaborative_agreements')
          .insert({
            state_abbreviation: stateAbbr,
            state_id: stateAbbr, // Using abbreviation as ID placeholder
            state_name: stateName,
            physician_name: 'TBD - Pending Assignment',
            physician_email: 'pending@assignment.com',
            workflow_status: 'draft',
            created_by: profile.id,
            source: 'onboarding',
          })
          .select()
          .single();

        if (agreementError) {
          console.error('Error creating agreement:', agreementError);
          continue;
        }

        // Link provider to the agreement
        await supabase
          .from('agreement_providers')
          .insert({
            agreement_id: newAgreement.id,
            provider_id: profile.id,
            provider_name: data.providerName,
            provider_email: data.providerEmail,
            provider_npi: data.npiNumber || null,
            is_active: true,
            signature_status: 'pending',
          });

        // Generate admin tasks for this agreement
        await generateAgreementTasks(
          newAgreement.id,
          stateAbbr,
          stateName,
          profile.id,
          null // No physician assigned yet
        );

        // Create a specific "Assign collaborating physician" task
        await supabase
          .from('agreement_tasks')
          .insert({
            agreement_id: newAgreement.id,
            provider_id: profile.id,
            title: `Assign collaborating physician for ${stateName}`,
            description: `A new provider has completed onboarding and requires a collaborating physician in ${stateName}. Review available physicians and make an assignment.`,
            category: 'agreement_creation',
            status: 'pending',
            priority: 'high',
            assigned_role: 'admin',
            is_auto_generated: true,
            auto_trigger: 'onboarding_completion',
            state_abbreviation: stateAbbr,
            state_name: stateName,
          });
      }

      // Create a general notification task for Clinical Ops
      await supabase
        .from('agreement_tasks')
        .insert({
          provider_id: profile.id,
          title: `New provider onboarded: ${data.providerName}`,
          description: `${data.providerName} has completed onboarding and selected ${statesRequiringCollab.length} state(s) requiring collaborative agreements: ${statesRequiringCollab.join(', ')}. Please review and initiate the collaboration process.`,
          category: 'compliance',
          status: 'pending',
          priority: 'high',
          assigned_role: 'admin',
          is_auto_generated: true,
          auto_trigger: 'onboarding_completion',
        });

    } catch (error) {
      console.error('Error creating pending agreements:', error);
      toast({
        title: 'Warning',
        description: 'Onboarding saved, but there was an issue creating collaboration records. Clinical Ops will follow up.',
        variant: 'destructive',
      });
    }
  };

  const handleComplete = async (data: OnboardingData, statesRequiringCollab: string[]) => {
    // Create pending agreements if consent was given
    if (statesRequiringCollab.length > 0) {
      await createPendingAgreements(data, statesRequiringCollab);
    }

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
      // Navigate to provider dashboard which will now show readiness screen
      navigate('/provider');
    }
  };

  const handleCancel = () => {
    if (mode === 'admin') {
      navigate('/providers');
    } else if (mode === 'edit') {
      navigate('/provider');
    } else {
      // For new onboarding, they can't really cancel - redirect to home
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
