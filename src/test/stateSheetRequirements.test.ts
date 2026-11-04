import { describe, it, expect } from 'vitest';
import { missingSheetRequirements, sheetLicenseStatus, type RequirementProof } from '@/lib/stateSheetRequirements';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
const day = new Date(2026,10,4);
const proof = (state: string, key: string): RequirementProof => ({ profile_id:'np', state_abbreviation:state, requirement_key:key, verified_source:'State board', verified_on:'2026-11-03', verified_link:'https://example.org/proof' });
const missing = (state: string, agreement = false, proofs: RequirementProof[] = []) => missingSheetRequirements('np',state,agreement,proofs,[],day);
describe('User supplied eight-state requirements', () => {
  it.each(['AK','AZ'])('%s active license needs no extra endorsements or agreement', state => {
    expect(missing(state)).toEqual([]);
    expect(sheetLicenseStatus('np',state,[],[],day)).toBe('unknown');
    expect(missingSheetRequirements('np',state,false,[],[{profileId:'np',state,status:'expired',expiration:'2025-01-01'}],day)).toEqual(['active_license']);
    expect(missingSheetRequirements('np',state,false,[],[{profileId:'np',state,status:'active',expiration:'2027-01-01'}],day)).toEqual([]);
  });
  it('AR needs Rx yes AND signed agreement AND board registration', () => {
    expect(missing('AR')).toEqual(['rx_authority','board_registration','collab_agreement']);
    expect(missing('AR',true,[proof('AR','rx_authority')])).toEqual(['board_registration']);
    expect(missing('AR',true,[proof('AR','rx_authority'),proof('AR','board_registration')])).toEqual([]);
  });
  it('CA needs furnishing license AND signed agreement', () => {
    expect(missing('CA',false,[proof('CA','furnishing_license')])).toEqual(['collab_agreement']);
    expect(missing('CA',true)).toEqual(['furnishing_license']);
    expect(missing('CA',true,[proof('CA','furnishing_license')])).toEqual([]);
  });
  it('CO needs C-RXN, not an agreement', () => { expect(missing('CO')).toEqual(['c_rxn_license']); expect(missing('CO',false,[proof('CO','c_rxn_license')])).toEqual([]); });
  it('CT needs practice-without-collab yes designation', () => { expect(missing('CT')).toEqual(['practice_without_collab']); expect(missing('CT',false,[proof('CT','practice_without_collab')])).toEqual([]); });
  it('DE needs prescriptive-authority endorsement', () => { expect(missing('DE')).toEqual(['rx_authority']); expect(missing('DE',false,[proof('DE','rx_authority')])).toEqual([]); });
  it('Florida accepts autonomous status OR signed agreement', () => { expect(missing('FL')).toEqual(['autonomous_status','collab_agreement']); expect(missing('FL',true)).toEqual([]); expect(missing('FL',false,[proof('FL','autonomous_status')])).toEqual([]); });
  it('requires source date and clickable evidence per fact', () => {
    for (const change of [{verified_source:''},{verified_on:''},{verified_link:null},{verified_link:'javascript:alert(1)'},{verified_on:'2027-01-01'},{expiration_date:'2025-01-01'}]) expect(missing('DE',false,[{...proof('DE','rx_authority'),...change}])).toEqual(['rx_authority']);
  });
  it('does not borrow proof from a different provider, state or requirement', () => {
    expect(missing('AR',true,[{...proof('AR','rx_authority'),profile_id:'other'},proof('DE','board_registration')])).toEqual(['rx_authority','board_registration']);
  });
  it('preserves DirectShifts document exemption without waiving AR requirements', () => {
    const agreement = [{profileId:'np',state:'AR',status:'active',document:null,documentExempt:true}];
    expect(activeStateAgreementFlags({id:'np',profession:'NP'},['AR'],[],agreement,[],day)[0]?.sheetReview).toBe(true);
    expect(activeStateAgreementFlags({id:'np',profession:'NP'},['AR'],[],agreement,[],day,[],[],[proof('AR','rx_authority'),proof('AR','board_registration')])).toEqual([]);
  });
  it.each(['AK','AZ','AR','CA','CO','CT','DE','FL'])('audits only EHR-active %s and respects future activation', state => {
    const np = {id:'np',profession:'NP'};
    expect(activeStateAgreementFlags(np,[],[],[],[],day)).toEqual([]);
    if (!['AK','AZ'].includes(state)) expect(activeStateAgreementFlags(np,[state],[],[],[],day,[],[state])[0]?.newlyActive).toBe(true);
    expect(activeStateAgreementFlags({id:'md',profession:'DO'},[state],[],[],[],day)).toEqual([]);
  });
});