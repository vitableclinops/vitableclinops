import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LicensureApplication {
  id: string;
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  state_abbreviation: string;
  state_name: string;
  designation_type: string;
  designation_label: string;
  template_id: string | null;
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'blocked' | 'withdrawn';
  initiated_at: string;
  initiated_by: string | null;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  ca_requirement_type: string | null;
  ca_awareness_dismissed: boolean;
  agreement_task_id: string | null;
  license_id: string | null;
  kb_article_id: string | null;
  notes: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LicensureStep {
  id: string;
  application_id: string;
  sort_order: number;
  title: string;
  description: string | null;
  is_required: boolean;
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  submitted_date: string | null;
  uploaded_file_url: string | null;
  uploaded_file_name: string | null;
  uploaded_at: string | null;
  provider_notes: string | null;
  admin_notes: string | null;
  fee_amount: number | null;
  fee_receipt_url: string | null;
  fee_receipt_uploaded_at: string | null;
  reimbursement_status: string;
  reimbursement_request_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LicensureTemplate {
  id: string;
  state_abbreviation: string;
  designation_type: string;
  designation_label: string;
  sort_order: number;
  application_url: string | null;
  estimated_fee: number | null;
  estimated_timeline: string | null;
  notes: string | null;
  required_documents: string[] | null;
  steps: { title: string; description: string; is_required: boolean; sort_order: number }[];
  kb_article_id: string | null;
  is_active: boolean;
}

// Fetch applications for a provider
export function useProviderLicensureApplications(providerId?: string) {
  const [applications, setApplications] = useState<LicensureApplication[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApplications = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    const { data } = await supabase
      .from('licensure_applications')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });
    setApplications((data as any[]) || []);
    setLoading(false);
  }, [providerId]);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  return { applications, loading, refetch: fetchApplications };
}

// Fetch all applications (admin view), optionally filtered by state
export function useAllLicensureApplications(stateAbbr?: string) {
  const [applications, setApplications] = useState<LicensureApplication[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('licensure_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (stateAbbr) query = query.eq('state_abbreviation', stateAbbr);
    const { data } = await query;
    setApplications((data as any[]) || []);
    setLoading(false);
  }, [stateAbbr]);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  return { applications, loading, refetch: fetchApplications };
}

// Fetch steps for an application
export function useLicensureSteps(applicationId?: string) {
  const [steps, setSteps] = useState<LicensureStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSteps = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    const { data } = await supabase
      .from('licensure_application_steps')
      .select('*')
      .eq('application_id', applicationId)
      .order('sort_order');
    setSteps((data as any[]) || []);
    setLoading(false);
  }, [applicationId]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  return { steps, loading, refetch: fetchSteps };
}

// Fetch templates for a state
export function useStateTemplates(stateAbbr?: string) {
  const [templates, setTemplates] = useState<LicensureTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    if (!stateAbbr) return;
    setLoading(true);
    const { data } = await supabase
      .from('state_licensure_templates')
      .select('*')
      .eq('state_abbreviation', stateAbbr)
      .eq('is_active', true)
      .order('sort_order');
    setTemplates((data as any[]) || []);
    setLoading(false);
  }, [stateAbbr]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  return { templates, loading, refetch: fetchTemplates };
}

// Create a licensure application with steps from template
export async function initiateLicensureApplication(params: {
  providerId: string;
  providerName: string;
  providerEmail: string;
  stateAbbr: string;
  stateName: string;
  designationType: string;
  designationLabel: string;
  templateId?: string;
  templateSteps?: { title: string; description: string; is_required: boolean; sort_order: number }[];
  caRequirementType?: string;
  kbArticleId?: string;
  initiatedBy: string;
}) {
  // Create the application
  const { data: app, error: appError } = await supabase
    .from('licensure_applications')
    .insert({
      provider_id: params.providerId,
      provider_name: params.providerName,
      provider_email: params.providerEmail,
      state_abbreviation: params.stateAbbr,
      state_name: params.stateName,
      designation_type: params.designationType,
      designation_label: params.designationLabel,
      template_id: params.templateId || null,
      ca_requirement_type: params.caRequirementType || null,
      kb_article_id: params.kbArticleId || null,
      initiated_by: params.initiatedBy,
      status: 'not_started' as any,
    })
    .select('id')
    .single();

  if (appError) throw appError;

  // Create steps from template
  const steps = params.templateSteps?.length ? params.templateSteps : [
    { title: 'Review state licensing requirements', description: 'Review the official licensing board website and understand what is needed.', is_required: true, sort_order: 0 },
    { title: 'Gather required documents', description: 'Collect transcripts, certifications, and identification documents.', is_required: true, sort_order: 1 },
    { title: 'Submit application', description: 'Complete and submit the online application with all required documents.', is_required: true, sort_order: 2 },
    { title: 'Pay application fee', description: 'Pay the state application fee and save the receipt for reimbursement.', is_required: true, sort_order: 3 },
    { title: 'Complete background check', description: 'If required, complete fingerprinting and background check.', is_required: true, sort_order: 4 },
    { title: 'Await approval', description: 'Wait for the state board to process your application.', is_required: true, sort_order: 5 },
  ];

  if (app) {
    await supabase
      .from('licensure_application_steps')
      .insert(
        steps.map((s) => ({
          application_id: app.id,
          title: s.title,
          description: s.description,
          is_required: s.is_required,
          sort_order: s.sort_order,
          status: 'not_started' as any,
        }))
      );

    // Also create an agreement_task for the provider
    const { data: task } = await supabase
      .from('agreement_tasks')
      .insert({
        title: `${params.designationLabel} Application — ${params.stateName}`,
        description: `Complete your ${params.designationLabel.toLowerCase()} application for ${params.stateName}. Track progress in your licensure dashboard.`,
        category: 'compliance' as any,
        status: 'pending' as any,
        priority: 'high',
        provider_id: params.providerId,
        state_abbreviation: params.stateAbbr,
        state_name: params.stateName,
        created_by: params.initiatedBy,
        external_url: `/licensure/${app.id}`,
      })
      .select('id')
      .single();

    if (task) {
      await supabase
        .from('licensure_applications')
        .update({ agreement_task_id: task.id })
        .eq('id', app.id);
    }
  }

  return app;
}
