import { describe, it, expect } from 'vitest';
import { missingSheetRequirements, remainingVerificationKeys, SHEET_REQUIREMENTS, sheetLicenseStatus, type RequirementProof } from '@/lib/stateSheetRequirements';
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
  it('DE accepts Rx endorsement OR Nursing Interstate Telehealth Registration, not an agreement alone', () => {
    expect(missing('DE')).toEqual(['rx_authority','nursing_interstate_telehealth_registration']);
    expect(missing('DE',true)).toEqual(['rx_authority','nursing_interstate_telehealth_registration']);
    expect(missing('DE',false,[proof('DE','rx_authority')])).toEqual([]);
    expect(missing('DE',false,[proof('DE','nursing_interstate_telehealth_registration')])).toEqual([]);
  });
  it('flags current and newly active Delaware NPs until an alternative is verified', () => {
    const audit = (states: string[], proofs: RequirementProof[] = [], newlyActive: string[] = []) => activeStateAgreementFlags({id:'np',profession:'NP'},states,[],[],[],day,[],newlyActive,proofs);
    expect(audit(['DE'])).toEqual([expect.objectContaining({state:'DE',sheetReview:true,newlyActive:false})]);
    expect(audit(['DE'],[],['DE'])).toEqual([expect.objectContaining({state:'DE',newlyActive:true})]);
    expect(audit(['DE'],[proof('DE','nursing_interstate_telehealth_registration')])).toEqual([]);
    expect(audit([])).toEqual([]);
  });
  it('rejects expired or mismatched Delaware registration proof', () => {
    for (const change of [{expiration_date:'2026-11-03'},{profile_id:'other'},{state_abbreviation:'FL'},{verified_link:null}]) {
      expect(missing('DE',false,[{...proof('DE','nursing_interstate_telehealth_registration'),...change}])).toEqual(['rx_authority','nursing_interstate_telehealth_registration']);
    }
  });
  it('Florida accepts autonomous status OR signed agreement OR TLHT designation', () => {
    expect(missing('FL')).toEqual(['autonomous_status','tlht_designation','collab_agreement']);
    expect(missing('FL',true)).toEqual([]);
    expect(missing('FL',false,[proof('FL','autonomous_status')])).toEqual([]);
    expect(missing('FL',false,[proof('FL','tlht_designation')])).toEqual([]);
  });
  it('flags current and newly active Florida NPs until an alternative is verified', () => {
    const np = {id:'np',profession:'NP'};
    const audit = (states: string[], proofs: RequirementProof[] = [], newlyActive: string[] = []) => activeStateAgreementFlags(np,states,[],[],[],day,[],newlyActive,proofs);
    expect(audit(['FL'])).toEqual([expect.objectContaining({state:'FL',sheetReview:true,newlyActive:false})]);
    expect(audit(['FL'],[],['FL'])).toEqual([expect.objectContaining({state:'FL',newlyActive:true})]);
    expect(audit(['FL'],[proof('FL','tlht_designation')])).toEqual([]);
    expect(audit([])).toEqual([]);
  });
  it('Florida rejects expired, incomplete or other-provider TLHT proof', () => {
    for (const change of [{expiration_date:'2026-11-03'},{verified_source:''},{verified_link:null},{profile_id:'other'},{state_abbreviation:'DE'}]) {
      expect(missing('FL',false,[{...proof('FL','tlht_designation'),...change}])).toEqual(['autonomous_status','tlht_designation','collab_agreement']);
    }
  });
  it('requires source date and clickable evidence per fact', () => {
    for (const change of [{verified_source:''},{verified_on:''},{verified_link:null},{verified_link:'javascript:alert(1)'},{verified_on:'2027-01-01'},{expiration_date:'2025-01-01'}]) expect(missing('DE',false,[{...proof('DE','rx_authority'),...change}])).toEqual(['rx_authority','nursing_interstate_telehealth_registration']);
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
describe('Remaining sheet states', () => {
  it('MA prompts for CSR only after Rx authority is saved, and Rx only after CSR is saved', () => {
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'rx_authority')], [], day)).toEqual(['csr_registration']);
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'csr_registration')], [], day)).toEqual(['rx_authority']);
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'rx_authority'), proof('MA', 'csr_registration')], [], day)).toEqual([]);
  });
  it.each(Object.entries(SHEET_REQUIREMENTS).filter(([, config]) => config.keys.length > 1))('%s does not request a saved valid requirement again', (state, config) => {
    const saved = config.keys[0];
    expect(remainingVerificationKeys('np', state, false, [proof(state, saved)], [], day)).not.toContain(saved);
  });
  it('requires expired CSR again without re-requesting valid Rx authority', () => {
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'rx_authority'), {...proof('MA', 'csr_registration'), expiration_date: '2026-11-03'}], [], day)).toEqual(['csr_registration']);
  });
  it('does not prompt for Kentucky CAPA-NS again when a signed agreement substitutes for it', () => {
    expect(remainingVerificationKeys('np', 'KY', true, [], [], day)).toEqual(['rx_authority']);
  });
  it.each(['ID','IA','KS','ME','MD','MI','MT','NH','NM','OR','RI','UT','WA','WY'])('%s needs only an active license', s => expect(missing(s)).toEqual([]));
  it('Nevada needs only an active license, without agreement or prescribing designation', () => {
    const licenses = [{profileId:'np',state:'NV',status:'active',expiration:'2027-01-01'}];
    expect(missingSheetRequirements('np','NV',false,[],licenses,day)).toEqual([]);
    expect(missing('NV')).toEqual([]);
    expect(activeStateAgreementFlags({id:'np',profession:'NP'},['NV'],[],[],[],day,[],[],[],licenses)).toEqual([]);
    expect(activeStateAgreementFlags({id:'np',profession:'NP'},['NV'],[],[],[],day,[],['NV'],[],licenses)).toEqual([]);
  });
  it('Nevada retains known expired-license warnings', () => {
    expect(missingSheetRequirements('np','NV',false,[],[{profileId:'np',state:'NV',status:'expired',expiration:'2026-11-03'}],day)).toEqual(['active_license']);
  });
  it.each([['HI','rx_authority'],['ND','rx_authority'],['SD','full_practice_authority']])('%s needs %s', (s,k) => { expect(missing(s)).toEqual([k]); expect(missing(s,false,[proof(s,k)])).toEqual([]); });
  it.each(['IL','WI'])('%s accepts agreement OR designation', s => { expect(missing(s)).toHaveLength(2); expect(missing(s,true)).toEqual([]); });
  it('Vermont accepts APRN Telehealth Registration OR independent designation OR agreement', () => {
    expect(missing('VT')).toEqual(['independent_practice','aprn_telehealth_registration','collab_agreement']);
    expect(missing('VT',true)).toEqual([]);
    expect(missing('VT',false,[proof('VT','independent_practice')])).toEqual([]);
    expect(missing('VT',false,[proof('VT','aprn_telehealth_registration')])).toEqual([]);
  });
  it('flags current and future Vermont activations and clears with valid registration proof', () => {
    const audit = (states: string[], proofs: RequirementProof[] = [], newlyActive: string[] = []) => activeStateAgreementFlags({id:'np',profession:'NP'},states,[],[],[],day,[],newlyActive,proofs);
    expect(audit(['VT'])).toEqual([expect.objectContaining({state:'VT',sheetReview:true,newlyActive:false})]);
    expect(audit(['VT'],[],['VT'])).toEqual([expect.objectContaining({state:'VT',newlyActive:true})]);
    expect(audit(['VT'],[proof('VT','aprn_telehealth_registration')])).toEqual([]);
    expect(audit([])).toEqual([]);
    for (const change of [{expiration_date:'2026-11-03'},{profile_id:'other'},{state_abbreviation:'DE'},{verified_link:null},{verified_source:''}]) {
      expect(missing('VT',false,[{...proof('VT','aprn_telehealth_registration'),...change}])).toContain('aprn_telehealth_registration');
    }
  });
  it('MA needs Rx + CSR OR agreement', () => { expect(missing('MA',false,[proof('MA','rx_authority')])).toEqual(['csr_registration','collab_agreement']); expect(missing('MA',false,[proof('MA','rx_authority'),proof('MA','csr_registration')])).toEqual([]); expect(missing('MA',true)).toEqual([]); });
  it('Kentucky needs CAPA-NS/Prescriptive authority designations on license; a signed collab agreement substitutes for CAPA-NS', () => {
    expect(missing('KY')).toEqual(['capa_ns','rx_authority']);
    expect(missing('KY',true)).toEqual(['rx_authority']);
    expect(missing('KY',false,[proof('KY','capa_ns')])).toEqual(['rx_authority']);
    expect(missing('KY',false,[proof('KY','capa_ns'),proof('KY','rx_authority')])).toEqual([]);
    expect(missing('KY',false,[proof('KY','rx_authority')])).toEqual(['capa_ns']);
    for (const change of [{expiration_date:'2026-11-03'},{profile_id:'other'},{state_abbreviation:'TX'},{verified_link:null},{verified_source:''}]) {
      expect(missing('KY',false,[{...proof('KY','rx_authority'),...change},proof('KY','capa_ns')])).toEqual(['rx_authority']);
      expect(missing('KY',false,[{...proof('KY','capa_ns'),...change},proof('KY','rx_authority')])).toEqual(['capa_ns']);
    }
  });
  it('TX needs agreement AND board filing', () => { expect(missing('TX')).toEqual(['board_registration','collab_agreement']); expect(missing('TX',true,[proof('TX','board_registration')])).toEqual([]); });
  it.each(['NJ','OH'])('%s needs agreement only', s => { expect(missing(s)).toEqual(['collab_agreement']); expect(missing(s,true)).toEqual([]); });
});
