import { useNavigate, useSearchParams } from 'react-router-dom';
import { OnboardingWizard, OnboardingData, CollabClassification } from '@/components/onboarding/OnboardingWizard';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAgreementTasks } from '@/hooks/useAgreementTasks';
import { toast } from '@/hooks/use-toast';

export default function ProviderOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile, refreshProfile } = useAuth();
  const { generateAgreementTasks } = useAgreementTasks();
  
  const mode = (searchParams.get('mode') as 'new' | 'edit' | 'admin') || 'new';

  const createPendingAgreements = async (
    data: OnboardingData,
    alwaysCollabStates: string[]
  ) => {
    if (!profile?.id || alwaysCollabStates.length === 0) return;

    try {
      // Fetch state names for each abbreviation
      const { data: stateData } = await supabase
        .from('state_compliance_requirements')
        .select('state_abbreviation, state_name')
        .in('state_abbreviation', alwaysCollabStates);

      const stateMap = new Map(
        (stateData || []).map(s => [s.state_abbreviation, s.state_name])
      );

      // Create pending collaborative agreements for each state requiring one
      for (const stateAbbr of alwaysCollabStates) {
        const stateName = stateMap.get(stateAbbr) || stateAbbr;

        // Check if this specific provider already has an agreement for this state
        // (dedupe by provider_id + state_abbreviation, NOT just state)
        const { data: existingLink } = await supabase
          .from('agreement_providers')
          .select(`
            id,
            agreement:agreement_id (
              id,
              state_abbreviation
            )
          `)
          .eq('provider_id', profile.id);

        const hasExistingAgreement = existingLink?.some(
          link => link.agreement?.state_abbreviation === stateAbbr
        );

        if (hasExistingAgreement) {
          console.log(`Agreement already exists for provider in ${stateAbbr}, skipping`);
          continue;
        }

        // Create a placeholder pending agreement with NULL physician (awaiting assignment)
        const { data: newAgreement, error: agreementError } = await supabase
          .from('collaborative_agreements')
          .insert({
            state_abbreviation: stateAbbr,
            state_id: stateAbbr,
            state_name: stateName,
            physician_name: null,
            physician_email: null,
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
          null
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
          description: `${data.providerName} has completed onboarding and selected ${alwaysCollabStates.length} state(s) requiring collaborative agreements: ${alwaysCollabStates.join(', ')}. Please review and initiate the collaboration process.`,
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

  const createConditionalReviewTasks = async (
    data: OnboardingData,
    conditionalStates: string[]
  ) => {
    if (!profile?.id || conditionalStates.length === 0) return;

    try {
      // Fetch state names
      const { data: stateData } = await supabase
        .from('state_compliance_requirements')
        .select('state_abbreviation, state_name')
        .in('state_abbreviation', conditionalStates);

      const stateMap = new Map(
        (stateData || []).map(s => [s.state_abbreviation, s.state_name])
      );

      for (const stateAbbr of conditionalStates) {
        const stateName = stateMap.get(stateAbbr) || stateAbbr;

        // Check if a decision already exists for this provider-state
        const { data: existingDecision } = await supabase
          .from('provider_state_collab_decisions')
          .select('id')
          .eq('profile_id', profile.id)
          .eq('state_abbreviation', stateAbbr)
          .maybeSingle();

        if (!existingDecision) {
          // Create a pending_review decision record
          await supabase
            .from('provider_state_collab_decisions')
            .insert({
              profile_id: profile.id,
              state_abbreviation: stateAbbr,
              decision: 'pending_review',
            });
        }

        // Check if task already exists to avoid duplicates
        const { data: existingTask } = await supabase
          .from('agreement_tasks')
          .select('id')
          .eq('provider_id', profile.id)
          .eq('state_abbreviation', stateAbbr)
          .ilike('title', '%FPA eligibility%')
          .maybeSingle();

        if (!existingTask) {
          // Create admin review task
          await supabase
            .from('agreement_tasks')
            .insert({
              provider_id: profile.id,
              title: `Confirm FPA eligibility for ${data.providerName} in ${stateName}`,
              description: `${stateName} has conditional collaboration requirements. Review the provider's credentials to determine if they meet Full Practice Authority requirements, or if a collaborative agreement is needed.`,
              category: 'compliance',
              status: 'pending',
              priority: 'medium',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'conditional_state_review',
              state_abbreviation: stateAbbr,
              state_name: stateName,
            });
        }
      }
    } catch (error) {
      console.error('Error creating conditional review tasks:', error);
    }
  };

  const handleComplete = async (data: OnboardingData, collabClassification: CollabClassification) => {
    // Create pending agreements for "always" states
    if (collabClassification.always.length > 0) {
      await createPendingAgreements(data, collabClassification.always);
    }

    // Create review tasks for "conditional" states (DO NOT auto-create agreements)
    if (collabClassification.conditional.length > 0) {
      await createConditionalReviewTasks(data, collabClassification.conditional);
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
