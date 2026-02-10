import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChecklistItem {
  key: string;
  label: string;
  status: 'complete' | 'incomplete' | 'expired' | 'not_required';
  detail: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

export interface StateReadiness {
  state_abbreviation: string;
  license_status: string | null;
  license_expiration: string | null;
  license_verified: boolean;
  collab_required: boolean;
  collab_status: string | null; // 'active' | 'expired' | 'missing' | null
  collab_signed: boolean;
  meeting_scheduled: boolean;
  next_meeting_date: string | null;
  chart_review_linked: boolean;
  ehr_activation_status: string | null;
  ehr_approved: boolean;
  checklist: ChecklistItem[];
  computed_status: 'ready' | 'in_progress' | 'blocked';
  blocker_reason: string | null;
}

export interface ProviderReadiness {
  provider_id: string;
  provider_name: string;
  email: string;
  credentials: string | null;
  profession: string | null;
  avatar_url: string | null;
  employment_type: string | null;
  employment_status: string | null;
  agency_id: string | null;
  npi_number: string | null;
  chart_review_folder_url: string | null;
  states: StateReadiness[];
  overall_status: 'ready' | 'in_progress' | 'blocked';
  checklist_complete: number;
  checklist_total: number;
  next_action: NextAction | null;
  blocker_reasons: string[];
  expiring_soon: boolean; // any license/collab expiring within 30 days
}

export interface NextAction {
  label: string;
  type: 'initiate_collab' | 'upload_agreement' | 'schedule_meeting' | 'link_chart_review' | 'activate_ehr' | 'deactivate_ehr' | 'renew_license' | 'mark_ready';
  route?: string;
  provider_id: string;
  state_abbreviation?: string;
}

export function useProviderReadiness() {
  return useQuery({
    queryKey: ['provider-readiness'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

      // Fetch all needed data in parallel
      const [
        { data: profiles },
        { data: licenses },
        { data: stateRules },
        { data: agreements },
        { data: agreementProviders },
        { data: providerStatuses },
        { data: meetings },
        { data: meetingAttendees },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, credentials, profession, avatar_url, employment_type, employment_status, agency_id, npi_number, chart_review_folder_url, actively_licensed_states').order('full_name'),
        supabase.from('provider_licenses').select('profile_id, state_abbreviation, status, expiration_date, license_number, updated_at'),
        supabase.from('state_compliance_requirements').select('state_abbreviation, ca_required, collab_requirement_type'),
        supabase.from('collaborative_agreements').select('id, physician_name, state_abbreviation, workflow_status, start_date, end_date, terminated_at, physician_signed_at'),
        supabase.from('agreement_providers').select('agreement_id, provider_id, provider_name, is_active, signed_at, chart_review_url'),
        supabase.from('provider_state_status').select('provider_id, state_abbreviation, ehr_activation_status, ehr_activated_at, ehr_activated_by, readiness_status'),
        supabase.from('supervision_meetings').select('id, agreement_id, scheduled_date, status').gte('scheduled_date', today).order('scheduled_date', { ascending: true }).limit(500),
        supabase.from('meeting_attendees').select('meeting_id, provider_id'),
      ]);

      if (!profiles) return [];

      // Build lookup maps
      const licenseMap = new Map<string, typeof licenses>();
      licenses?.forEach(l => {
        const key = `${l.profile_id}:${l.state_abbreviation}`;
        if (!licenseMap.has(key)) licenseMap.set(key, []);
        licenseMap.get(key)!.push(l);
      });

      const stateRulesMap = new Map(stateRules?.map(r => [r.state_abbreviation, r]) || []);

      // Build provider+state -> agreement info
      const providerStateAgreementMap = new Map<string, { signed: boolean; status: string; end_date: string | null; physician_signed_at: string | null; agreement_id: string; chart_review_url: string | null }>();
      if (agreementProviders && agreements) {
        for (const ap of agreementProviders) {
          if (!ap.is_active || !ap.provider_id) continue;
          const agreement = agreements.find(a => a.id === ap.agreement_id);
          if (!agreement || agreement.terminated_at) continue;
          const key = `${ap.provider_id}:${agreement.state_abbreviation}`;
          providerStateAgreementMap.set(key, {
            signed: !!ap.signed_at,
            status: agreement.workflow_status,
            end_date: agreement.end_date,
            physician_signed_at: agreement.physician_signed_at,
            agreement_id: agreement.id,
            chart_review_url: ap.chart_review_url,
          });
        }
      }

      // Build provider -> has upcoming meeting map
      const providerMeetingMap = new Map<string, string>(); // provider_id -> next meeting date
      if (meetings && meetingAttendees) {
        const meetingDateMap = new Map(meetings.map(m => [m.id, m.scheduled_date]));
        meetingAttendees.forEach(ma => {
          const date = meetingDateMap.get(ma.meeting_id);
          if (date && (!providerMeetingMap.has(ma.provider_id) || date < providerMeetingMap.get(ma.provider_id)!)) {
            providerMeetingMap.set(ma.provider_id, date);
          }
        });
      }

      const statusMap = new Map<string, typeof providerStatuses extends (infer T)[] | null ? T : never>();
      providerStatuses?.forEach(s => {
        statusMap.set(`${s.provider_id}:${s.state_abbreviation}`, s);
      });

      const results: ProviderReadiness[] = [];

      for (const provider of profiles) {
        // Parse licensed states
        const stateAbbrs = provider.actively_licensed_states
          ? provider.actively_licensed_states.split(',').map(s => s.trim()).filter(s => s.length === 2)
          : [];

        const stateReadiness: StateReadiness[] = [];
        let totalChecklist = 0;
        let completeChecklist = 0;
        const blockerReasons: string[] = [];
        let expiringSoon = false;

        for (const stateAbbr of stateAbbrs) {
          const licenseKey = `${provider.id}:${stateAbbr}`;
          const provLicenses = licenseMap.get(licenseKey) || [];
          const bestLicense = provLicenses.find(l => l.status === 'active' || l.status === 'verified') || provLicenses[0];
          const stateRule = stateRulesMap.get(stateAbbr);
          const collabInfo = providerStateAgreementMap.get(licenseKey);
          const pss = statusMap.get(licenseKey);

          const collabRequired = stateRule?.ca_required === true || stateRule?.collab_requirement_type === 'always';
          const isMD = provider.profession === 'MD' || provider.credentials === 'MD';
          const effectiveCollabRequired = collabRequired && !isMD;

          // License checks
          const licenseVerified = bestLicense && (bestLicense.status === 'active' || bestLicense.status === 'verified');
          const licenseExpired = bestLicense?.expiration_date ? bestLicense.expiration_date < today : false;
          const licenseExpiringSoon = bestLicense?.expiration_date ? bestLicense.expiration_date >= today && bestLicense.expiration_date <= thirtyDaysOut : false;

          // Collab checks
          let collabStatus: string | null = null;
          let collabSigned = false;
          if (effectiveCollabRequired) {
            if (!collabInfo) {
              collabStatus = 'missing';
            } else if (collabInfo.end_date && collabInfo.end_date < today) {
              collabStatus = 'expired';
            } else if (collabInfo.status === 'active') {
              collabStatus = 'active';
              collabSigned = !!collabInfo.signed;
            } else {
              collabStatus = collabInfo.status;
            }
          }

          // Meeting check
          const hasMeeting = providerMeetingMap.has(provider.id);
          const nextMeetingDate = providerMeetingMap.get(provider.id) || null;

          // Chart review
          const hasChartReview = !!(provider.chart_review_folder_url || collabInfo?.chart_review_url);

          // EHR activation
          const ehrStatus = pss?.ehr_activation_status || 'inactive';
          const ehrApproved = ehrStatus === 'active';

          // Build checklist
          const checklist: ChecklistItem[] = [];

          // 1. License verified
          checklist.push({
            key: 'license_verified',
            label: `License verified (${stateAbbr})`,
            status: licenseExpired ? 'expired' : licenseVerified ? 'complete' : 'incomplete',
            detail: bestLicense ? `${bestLicense.status}${bestLicense.expiration_date ? ` • Exp: ${bestLicense.expiration_date}` : ''}` : 'No license on file',
            completed_at: bestLicense?.updated_at || null,
            completed_by: null,
          });

          // 2. Collab agreement required
          checklist.push({
            key: 'collab_required',
            label: 'Collaborative agreement required',
            status: effectiveCollabRequired ? (collabStatus === 'active' ? 'complete' : collabStatus === 'expired' ? 'expired' : 'incomplete') : 'not_required',
            detail: effectiveCollabRequired ? (collabStatus || 'Not started') : 'Not required for this state/provider',
            completed_at: null,
            completed_by: null,
          });

          // 3. Collab signed
          if (effectiveCollabRequired) {
            checklist.push({
              key: 'collab_signed',
              label: 'Agreement signed',
              status: collabSigned ? 'complete' : 'incomplete',
              detail: collabSigned ? 'Signed' : 'Awaiting signature',
              completed_at: collabInfo?.physician_signed_at || null,
              completed_by: null,
            });
          }

          // 4. Meeting scheduled (if collab required)
          if (effectiveCollabRequired) {
            checklist.push({
              key: 'meeting_scheduled',
              label: 'Supervision meeting scheduled',
              status: hasMeeting ? 'complete' : 'incomplete',
              detail: nextMeetingDate ? `Next: ${nextMeetingDate}` : 'No upcoming meeting',
              completed_at: null,
              completed_by: null,
            });
          }

          // 5. Chart review linked
          checklist.push({
            key: 'chart_review',
            label: 'Chart review linked',
            status: hasChartReview ? 'complete' : 'incomplete',
            detail: hasChartReview ? 'Linked' : 'Not linked',
            completed_at: null,
            completed_by: null,
          });

          // 6. EHR activation
          checklist.push({
            key: 'ehr_activation',
            label: 'EHR activation approved',
            status: ehrApproved ? 'complete' : 'incomplete',
            detail: ehrStatus,
            completed_at: pss?.ehr_activated_at || null,
            completed_by: null,
          });

          const stateTotal = checklist.filter(c => c.status !== 'not_required').length;
          const stateComplete = checklist.filter(c => c.status === 'complete').length;
          totalChecklist += stateTotal;
          completeChecklist += stateComplete;

          // Compute per-state status
          const hasExpired = checklist.some(c => c.status === 'expired');
          const allComplete = stateTotal > 0 && stateComplete === stateTotal;
          let computedStatus: 'ready' | 'in_progress' | 'blocked' = 'in_progress';
          let blockerReason: string | null = null;

          if (hasExpired || (licenseExpired)) {
            computedStatus = 'blocked';
            blockerReason = licenseExpired ? `Expired license (${stateAbbr})` : `Expired collaborative agreement (${stateAbbr})`;
            blockerReasons.push(blockerReason);
          } else if (!licenseVerified && bestLicense) {
            computedStatus = 'blocked';
            blockerReason = `License not verified (${stateAbbr})`;
            blockerReasons.push(blockerReason);
          } else if (!bestLicense) {
            computedStatus = 'blocked';
            blockerReason = `No license on file (${stateAbbr})`;
            blockerReasons.push(blockerReason);
          } else if (effectiveCollabRequired && collabStatus === 'missing') {
            computedStatus = 'blocked';
            blockerReason = `Missing collaborative agreement (${stateAbbr})`;
            blockerReasons.push(blockerReason);
          } else if (allComplete) {
            computedStatus = 'ready';
          }

          if (licenseExpiringSoon) expiringSoon = true;
          if (collabInfo?.end_date && collabInfo.end_date >= today && collabInfo.end_date <= thirtyDaysOut) expiringSoon = true;

          // Guardrail: If EHR is active but compliance incomplete, NOT ready
          if (ehrApproved && !allComplete) {
            computedStatus = 'blocked';
            if (!blockerReason) {
              blockerReason = `Active in EHR but compliance incomplete (${stateAbbr})`;
              blockerReasons.push(blockerReason);
            }
          }

          stateReadiness.push({
            state_abbreviation: stateAbbr,
            license_status: bestLicense?.status || null,
            license_expiration: bestLicense?.expiration_date || null,
            license_verified: !!licenseVerified,
            collab_required: effectiveCollabRequired,
            collab_status: collabStatus,
            collab_signed: collabSigned,
            meeting_scheduled: hasMeeting,
            next_meeting_date: nextMeetingDate,
            chart_review_linked: hasChartReview,
            ehr_activation_status: ehrStatus,
            ehr_approved: ehrApproved,
            checklist,
            computed_status: computedStatus,
            blocker_reason: blockerReason,
          });
        }

        // Compute overall status (roll up from states)
        let overallStatus: 'ready' | 'in_progress' | 'blocked' = 'ready';
        if (stateReadiness.length === 0) {
          overallStatus = 'in_progress'; // no states = not ready yet
        } else if (stateReadiness.some(s => s.computed_status === 'blocked')) {
          overallStatus = 'blocked';
        } else if (stateReadiness.some(s => s.computed_status === 'in_progress')) {
          overallStatus = 'in_progress';
        }

        // Compute next action
        const nextAction = computeNextAction(provider.id, stateReadiness, provider.chart_review_folder_url);

        results.push({
          provider_id: provider.id,
          provider_name: provider.full_name || 'Unknown',
          email: provider.email,
          credentials: provider.credentials,
          profession: provider.profession,
          avatar_url: provider.avatar_url,
          employment_type: provider.employment_type,
          employment_status: provider.employment_status,
          agency_id: provider.agency_id,
          npi_number: provider.npi_number,
          chart_review_folder_url: provider.chart_review_folder_url,
          states: stateReadiness,
          overall_status: overallStatus,
          checklist_complete: completeChecklist,
          checklist_total: totalChecklist,
          next_action: nextAction,
          blocker_reasons: blockerReasons,
          expiring_soon: expiringSoon,
        });
      }

      return results;
    },
  });
}

function computeNextAction(
  providerId: string,
  states: StateReadiness[],
  chartReviewUrl: string | null,
): NextAction | null {
  // Priority order: fix blockers first, then progress items

  for (const s of states) {
    // Expired license -> renew
    if (s.license_status && s.license_expiration && s.license_expiration < new Date().toISOString().split('T')[0]) {
      return { label: `Renew License (${s.state_abbreviation})`, type: 'renew_license', provider_id: providerId, state_abbreviation: s.state_abbreviation, route: `/states/${s.state_abbreviation}` };
    }
    // Missing collab
    if (s.collab_required && s.collab_status === 'missing') {
      return { label: `Initiate Collab (${s.state_abbreviation})`, type: 'initiate_collab', provider_id: providerId, state_abbreviation: s.state_abbreviation, route: `/agreements` };
    }
    // Collab expired
    if (s.collab_required && s.collab_status === 'expired') {
      return { label: `Renew Agreement (${s.state_abbreviation})`, type: 'upload_agreement', provider_id: providerId, state_abbreviation: s.state_abbreviation, route: `/agreements` };
    }
  }

  for (const s of states) {
    // Collab not signed
    if (s.collab_required && s.collab_status === 'active' && !s.collab_signed) {
      return { label: `Get Signature (${s.state_abbreviation})`, type: 'upload_agreement', provider_id: providerId, state_abbreviation: s.state_abbreviation };
    }
    // No meeting
    if (s.collab_required && !s.meeting_scheduled) {
      return { label: `Schedule Meeting`, type: 'schedule_meeting', provider_id: providerId, route: `/calendar` };
    }
  }

  // Chart review not linked
  if (states.some(s => !s.chart_review_linked)) {
    return { label: 'Link Chart Review', type: 'link_chart_review', provider_id: providerId };
  }

  // EHR not activated but everything else is ready
  for (const s of states) {
    if (s.computed_status === 'in_progress' && !s.ehr_approved && s.license_verified) {
      // Check if all other items are complete
      const nonEhrComplete = s.checklist.filter(c => c.key !== 'ehr_activation' && c.status !== 'not_required').every(c => c.status === 'complete');
      if (nonEhrComplete) {
        return { label: `Activate EHR (${s.state_abbreviation})`, type: 'activate_ehr', provider_id: providerId, state_abbreviation: s.state_abbreviation, route: `/activation-queue` };
      }
    }
  }

  // Active in EHR but not compliant -> deactivate
  for (const s of states) {
    if (s.ehr_approved && s.computed_status === 'blocked') {
      return { label: `Deactivate EHR (${s.state_abbreviation})`, type: 'deactivate_ehr', provider_id: providerId, state_abbreviation: s.state_abbreviation, route: `/activation-queue` };
    }
  }

  // All ready
  if (states.length > 0 && states.every(s => s.computed_status === 'ready')) {
    return { label: 'All Ready', type: 'mark_ready', provider_id: providerId };
  }

  return null;
}
