import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { refreshAgreementViews } from '@/lib/agreementRefresh';
import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import type { RequirementProof } from '@/lib/stateSheetRequirements';

export function useRequirementProofs(profileId: string) {
  return useQuery({ queryKey: ['directory-collaboration', 'requirement-proofs', profileId], refetchOnWindowFocus: true, refetchInterval: 60000,
    queryFn: async () => { const result = await supabase.from('provider_requirement_verifications').select('*').eq('profile_id', profileId); if (result.error) throw result.error; return result.data as RequirementProof[]; } });
}
export async function saveRequirementProof(input: { profileId: string; state: string; key: string; source: string; date: string; link: string; file: File | null; expiration?: string; verifiedBy?: string | null }) {
  if (!input.source.trim() || !input.date || (!input.file && !hasVerificationLink(input.link))) throw new Error('Source, date and a proof file or valid link are required.');
  let path: string | null = null;
  if (input.file) {
    path = `independent-verification/${input.profileId}/${input.state}-${input.key}-${Date.now()}-${input.file.name.replace(/[^\w.-]/g, '_')}`;
    const result = await supabase.storage.from('task-documents').upload(path, input.file);
    if (result.error) throw result.error;
  }
  const result = await supabase.from('provider_requirement_verifications').upsert({ profile_id: input.profileId, state_abbreviation: input.state, requirement_key: input.key,
    verified_source: input.source.trim(), verified_on: input.date, verified_link: input.link.trim() || null, verified_attachment_path: path, verified_attachment_name: input.file?.name ?? null,
    expiration_date: input.expiration || null, verified_by: input.verifiedBy ?? null, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,state_abbreviation,requirement_key' });
  if (result.error) throw result.error;
}
export { refreshAgreementViews };