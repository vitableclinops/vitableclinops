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
  it('MA offers one combined verification or only the outstanding items on the separate path', () => {
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'csr_registration')], [], day)).toEqual(['ma_csr_independent','ma_signed_collab_agreement']);
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'ma_signed_collab_agreement')], [], day)).toEqual(['ma_csr_independent','csr_registration']);
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'ma_csr_independent')], [], day)).toEqual([]);
  });
  it.each(Object.entries(SHEET_REQUIREMENTS).filter(([, config]) => config.keys.length > 1))('%s does not request a saved valid requirement again', (state, config) => {
    const saved = config.keys[0];
    expect(remainingVerificationKeys('np', state, false, [proof(state, saved)], [], day)).not.toContain(saved);
  });
  it('requires expired CSR again without re-requesting the saved signed agreement', () => {
    expect(remainingVerificationKeys('np', 'MA', false, [proof('MA', 'ma_signed_collab_agreement'), {...proof('MA', 'csr_registration'), expiration_date: '2026-11-03'}], [], day)).toEqual(['ma_csr_independent','csr_registration']);
  });
  it('does not prompt for Kentucky CAPA-NS again when a signed agreement substitutes for it', () => {
    expect(remainingVerificationKeys('np', 'KY', true, [], [], day)).toEqual([]);
  });
  it.each(['ID','IA','KS','ME','MD','MI','MT','NH','NM','OR','RI','UT','WA','WY'])('%s needs only an active license', s => expect(missing(s)).toEqual([]));
  it('Nevada needs only an active license, without agreement or prescribing designation', () => {
    const licenses = [{profileId:'np',state:'NV',status:'active',expiration:'2027-01-01'}];
    expect(missingSheetRequirements('np','NV',false,[],licenses,day)).toEqual([]);
    expect(missing('NV')).toEqual([]);
    for (const s of ['MN','NE','DC']) {
      const l = [{profileId:'np',state:s,status:'active',expiration:'2027-01-01'}];
      expect(missingSheetRequirements('np',s,false,[],l,day)).toEqual([]);
    }
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
  it('MA accepts ONE combined CSR + Independent APRN supervision verification', () => {
    expect(missing('MA', false, [proof('MA', 'ma_csr_independent')])).toEqual([]);
    expect(missing('MA', false, [proof('MA', 'aprn_supervision_independent')])).toContain('ma_csr_independent');
  });
  it('MA separately requires CSR designation and signed collab agreement on the second path', () => {
    expect(missing('MA', false, [proof('MA', 'csr_registration'), proof('MA', 'ma_signed_collab_agreement')])).toEqual([]);
    expect(missing('MA', true, [proof('MA', 'csr_registration')])).toEqual([]);
    expect(missing('MA', true)).toEqual(['ma_csr_independent','csr_registration']);
    expect(missing('MA', false, [proof('MA', 'rx_authority'), proof('MA', 'csr_registration')])).toEqual(['ma_csr_independent','ma_signed_collab_agreement']);
  });
  it('MA applies both paths to current and future EHR activations without waiving CSR for DirectShifts', () => {
    const np = {id:'np', profession:'NP'};
    const agreements = [{profileId:'np',state:'MA',status:'active',document:null,documentExempt:true}];
    expect(activeStateAgreementFlags(np,['MA'],[],agreements,[],day,[],['MA'])).toEqual([expect.objectContaining({state:'MA',sheetReview:true,newlyActive:true})]);
    expect(activeStateAgreementFlags(np,['MA'],[],agreements,[],day,[],[],[proof('MA','csr_registration')])).toEqual([]);
    expect(activeStateAgreementFlags(np,[],[],agreements,[],day)).toEqual([]);
  });
  it('Kentucky needs CAPA-NS designation OR Independent NS prescriptive authority; a signed collab agreement substitutes for CAPA-NS', () => {
    expect(missing('KY')).toEqual(['capa_ns','independent_ns_rx_authority']);
    expect(missing('KY',true)).toEqual([]);
    expect(remainingVerificationKeys('np', 'KY', true, [], [], day)).toEqual([]);
    expect(missing('KY',false,[proof('KY','capa_ns')])).toEqual([]);
    expect(missing('KY',false,[proof('KY','independent_ns_rx_authority')])).toEqual([]);
    expect(missing('KY',true,[proof('KY','independent_ns_rx_authority')])).toEqual([]);
    for (const change of [{expiration_date:'2026-11-03'},{profile_id:'other'},{state_abbreviation:'TX'},{verified_link:null},{verified_source:''}]) {
      expect(missing('KY',false,[{...proof('KY','capa_ns'),...change}])).toEqual(['capa_ns','independent_ns_rx_authority']);
      expect(missing('KY',false,[{...proof('KY','independent_ns_rx_authority'),...change}])).toEqual(['capa_ns','independent_ns_rx_authority']);
      expect(missing('KY',true,[{...proof('KY','capa_ns'),...change}])).toEqual([]);
    }
  });
  it('TX needs agreement AND board filing AND TMB delegation confirmation', () => { expect(missing('TX')).toEqual(['board_registration','tmb_delegation_confirmed','collab_agreement']); expect(missing('TX',true,[proof('TX','board_registration'),proof('TX','tmb_delegation_confirmed')])).toEqual([]); });
  it.each(['NJ','OH'])('%s needs agreement only', s => { expect(missing(s)).toEqual(['collab_agreement']); expect(missing(s,true)).toEqual([]); });
});
