import { describe, it, expect } from 'vitest';
import { licensedStateReadiness } from '@/lib/licensedStateReadiness';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import type { EhrIdentity } from '@/lib/pcpCoverage';

const day = new Date(2026, 10, 4);
const p = { id: 'provider-1', profession: 'NP', npi_number: '1234567890', employment_status: 'active' };
const licenses = ['VA', 'NC'].map(state => ({profileId:p.id,state,status:'active',expiration:'2027-11-04'}));
const identity: EhrIdentity = {ehrProviderId:'ehr-1',ehrName:'Provider',npi:p.npi_number,profileId:p.id,states:['VA'],status:'matched',nameDiffers:false,reason:'Verified by NPI'};
describe('Medallion licensed-state readiness', () => {
  it('lists NC licensed but not active while excluding the active VA state', () => {
    expect(licensedStateReadiness([p], licenses, {identities:[identity]}, day).map(r => [r.state,r.activation])).toEqual([['NC','not_active']]);
  });
  it('does not count an expired Medallion license as licensed', () => {
    expect(licensedStateReadiness([p], [{...licenses[1],expiration:'2026-11-03'}], {identities:[identity]}, day)).toEqual([]);
  });
  it('excludes terminated providers despite source licenses', () => {
    expect(licensedStateReadiness([{...p,employment_status:'terminated'}],licenses,{identities:[identity]},day)).toEqual([]);
  });
  it('keeps absent coverage unconfirmed instead of inferring inactivity', () => {
    expect(licensedStateReadiness([p],licenses,{identities:[]},day).every(r => r.activation === 'unconfirmed')).toBe(true);
  });
  it('keeps ambiguous identity unconfirmed', () => {
    expect(licensedStateReadiness([p],licenses,{identities:[{...identity,status:'ambiguous',states:[]}]},day).map(r => r.activation)).toEqual(['unconfirmed','unconfirmed']);
  });
  it('audits future NC readiness without changing active-state flags', () => {
    const rules = [{state_abbreviation:'NC',ca_required:true,collab_requirement_type:'always'}];
    expect(activeStateAgreementFlags(p,['NC'],rules,[],[],day)[0].registrationReview).toBe(true);
    expect(activeStateAgreementFlags(p,[],rules,[],[],day)).toEqual([]);
    const agreements = [{profileId:p.id,state:'NC',status:'active',document:'https://example.org/nc.pdf'}];
    const decisions = [{profile_id:p.id,state_abbreviation:'NC',decision:'ncbon_registered',verified_source:'Board',verified_on:'2026-11-03',verified_link:'https://example.org/registration'}];
    expect(activeStateAgreementFlags(p,['NC'],rules,agreements,decisions,day)).toEqual([]);
  });
});