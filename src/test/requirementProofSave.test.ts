import { it, expect, vi, beforeEach } from 'vitest';
const { upsert, upload } = vi.hoisted(() => ({ upsert:vi.fn(), upload:vi.fn() }));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({upsert}),storage:{from:()=>({upload})}}}));
import { saveRequirementProof } from '@/hooks/useRequirementProofs';
beforeEach(()=>{vi.clearAllMocks();upsert.mockResolvedValue({error:null});upload.mockResolvedValue({error:null});});
it('saves AR requirements independently without overwriting Rx when registration is added',async()=>{
  const input={profileId:'np',state:'AR',source:'Board',date:'2026-11-03',link:'https://example.org/proof',file:null};
  await saveRequirementProof({...input,key:'rx_authority'});await saveRequirementProof({...input,key:'board_registration'});
  expect(upsert).toHaveBeenNthCalledWith(1,expect.objectContaining({requirement_key:'rx_authority'}),{onConflict:'profile_id,state_abbreviation,requirement_key'});
  expect(upsert).toHaveBeenNthCalledWith(2,expect.objectContaining({requirement_key:'board_registration'}),{onConflict:'profile_id,state_abbreviation,requirement_key'});
});
it('rejects proofless verification before writing',async()=>{await expect(saveRequirementProof({profileId:'np',state:'DE',key:'rx_authority',source:'Board',date:'2026-11-03',link:'',file:null})).rejects.toThrow();expect(upsert).not.toHaveBeenCalled();});