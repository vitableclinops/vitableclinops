import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ProviderRow {
  'Full name': string;
  'Email': string;
  'First Name': string;
  'Middle Name': string;
  'Last Name': string;
  'Preferred Name': string;
  'Profession': string;
  'ID': string;
  'Created date': string;
  'Board Certificates': string;
  'Licenses': string;
  'Actively licensed states': string;
  'Has CAQH Management?': string;
  'Should auto-renew licenses?': string;
  'Medallion Email': string;
  'Practice Restrictions': string;
  'Has Collaborative Agreements?': string;
  'Primary Specialty': string;
  'Secondary Contact Email': string;
  'Employment Offer Date': string;
  'Start Date': string;
  'CAQH Number': string;
  'Primary Phone': string;
  'Date Of Birth': string;
  'Preferred Pronoun': string;
  'NPI': string;
  'Address line 1': string;
  'Address line 2': string;
  'Address City': string;
  'Address State': string;
  'Postal code': string;
}

interface License {
  license_number: string;
  status: string;
  state_abbreviation: string;
  issue_date: string | null;
  expiration_date: string | null;
}

interface Conflict {
  email: string;
  providerName: string;
  field: string;
  fieldLabel: string;
  currentValue: any;
  newValue: any;
}

interface FieldResolution {
  email: string;
  field: string;
  useNew: boolean;
}

function parseLicenses(licenseText: string): License[] {
  if (!licenseText || licenseText.trim() === '') return [];
  
  const licenses: License[] = [];
  const licenseBlocks = licenseText.split(/\d+\.\s+License Number\s*:\s*/i).filter(Boolean);
  
  for (const block of licenseBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    
    const license: License = {
      license_number: lines[0].trim(),
      status: 'active',
      state_abbreviation: '',
      issue_date: null,
      expiration_date: null,
    };
    
    for (const line of lines) {
      if (line.toLowerCase().startsWith('status')) {
        const match = line.match(/status\s*:\s*(\w+)/i);
        if (match) license.status = match[1].toLowerCase();
      } else if (line.toLowerCase().startsWith('state')) {
        const match = line.match(/state\s*:\s*([A-Z]{2})/i);
        if (match) license.state_abbreviation = match[1].toUpperCase();
      } else if (line.toLowerCase().startsWith('issue date')) {
        const match = line.match(/issue date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
        if (match) license.issue_date = match[1];
      } else if (line.toLowerCase().startsWith('expiration date')) {
        const match = line.match(/expiration date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
        if (match) license.expiration_date = match[1];
      }
    }
    
    if (license.license_number && license.state_abbreviation) {
      licenses.push(license);
    }
  }
  
  return licenses;
}

function parseActiveStates(statesText: string): string {
  if (!statesText || statesText.trim() === '') return '';
  
  const states: string[] = [];
  const matches = statesText.matchAll(/\d+\.\s*([A-Z]{2})/gi);
  for (const match of matches) {
    states.push(match[1].toUpperCase());
  }
  
  return [...new Set(states)].sort().join(', ');
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  return null;
}

function boolFromString(str: string): boolean {
  return str?.toLowerCase() === 'yes' || str?.toLowerCase() === 'true';
}

// Check if two values are significantly different (not just formatting)
function isSignificantDifference(currentVal: any, newVal: any, fieldName: string): boolean {
  if (currentVal === null || currentVal === undefined || currentVal === '') {
    return false; // No conflict if current is empty
  }
  if (newVal === null || newVal === undefined || newVal === '') {
    return false; // No conflict if new is empty - we won't overwrite with empty
  }
  
  // Normalize for comparison
  const normalizedCurrent = String(currentVal).toLowerCase().trim();
  const normalizedNew = String(newVal).toLowerCase().trim();
  
  // Same after normalization = no conflict
  if (normalizedCurrent === normalizedNew) {
    return false;
  }
  
  // Phone number normalization
  if (fieldName === 'phone_number') {
    const currentDigits = String(currentVal).replace(/\D/g, '');
    const newDigits = String(newVal).replace(/\D/g, '');
    // If just last 10 digits match, consider it the same
    if (currentDigits.slice(-10) === newDigits.slice(-10)) {
      return false;
    }
  }
  
  // NPI - normalize by removing non-digits
  if (fieldName === 'npi_number') {
    const currentDigits = String(currentVal).replace(/\D/g, '');
    const newDigits = String(newVal).replace(/\D/g, '');
    if (currentDigits === newDigits) {
      return false;
    }
  }
  
  // Dates - normalize format
  if (fieldName.includes('date') || fieldName === 'birthday') {
    const current = new Date(currentVal);
    const newDate = new Date(newVal);
    if (!isNaN(current.getTime()) && !isNaN(newDate.getTime())) {
      if (current.toISOString().split('T')[0] === newDate.toISOString().split('T')[0]) {
        return false;
      }
    }
  }
  
  // Boolean fields
  if (typeof currentVal === 'boolean' || typeof newVal === 'boolean') {
    const currentBool = currentVal === true || currentVal === 'true' || currentVal === 'yes';
    const newBool = newVal === true || newVal === 'true' || newVal === 'yes';
    return currentBool !== newBool;
  }
  
  // At this point, values are different
  return true;
}

const fieldLabels: Record<string, string> = {
  full_name: 'Full Name',
  first_name: 'First Name',
  middle_name: 'Middle Name',
  last_name: 'Last Name',
  preferred_name: 'Preferred Name',
  credentials: 'Credentials',
  profession: 'Profession',
  medallion_id: 'Medallion ID',
  board_certificates: 'Board Certificates',
  practice_restrictions: 'Practice Restrictions',
  primary_specialty: 'Primary Specialty',
  secondary_contact_email: 'Secondary Email',
  employment_offer_date: 'Offer Date',
  employment_start_date: 'Start Date',
  caqh_number: 'CAQH Number',
  phone_number: 'Phone',
  birthday: 'Birthday',
  pronoun: 'Pronoun',
  npi_number: 'NPI',
  address_line_1: 'Address Line 1',
  address_line_2: 'Address Line 2',
  address_city: 'City',
  address_state: 'State',
  postal_code: 'Postal Code',
  actively_licensed_states: 'Active States',
  has_caqh_management: 'CAQH Management',
  auto_renew_licenses: 'Auto-Renew Licenses',
  has_collaborative_agreements: 'Has Collab Agreements',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { providers, mode, resolutions } = body as { 
      providers: ProviderRow[]; 
      mode?: 'preview' | 'apply';
      resolutions?: FieldResolution[];
    };
    
    if (!providers || !Array.isArray(providers)) {
      throw new Error('Invalid request: providers array required');
    }

    const importMode = mode || 'apply';
    const resolvedFields = new Map<string, boolean>();
    
    if (resolutions) {
      for (const res of resolutions) {
        resolvedFields.set(`${res.email}:${res.field}`, res.useNew);
      }
    }

    const results = {
      profilesUpserted: 0,
      licensesInserted: 0,
      fieldsUpdated: 0,
      fieldsFilled: 0,
      conflicts: [] as Conflict[],
      errors: [] as string[],
    };

    for (const provider of providers) {
      try {
        const email = provider.Email?.toLowerCase().trim();
        if (!email) {
          results.errors.push(`Skipping provider with no email`);
          continue;
        }

        const activelyLicensedStates = parseActiveStates(provider['Actively licensed states'] || '');

        // Build new data from CSV
        const newProfileData: Record<string, any> = {
          email,
          full_name: provider['Full name']?.trim() || null,
          first_name: provider['First Name']?.trim() || null,
          middle_name: provider['Middle Name']?.trim() || null,
          last_name: provider['Last Name']?.trim() || null,
          preferred_name: provider['Preferred Name']?.trim() || null,
          credentials: provider.Profession?.trim() || null,
          profession: provider.Profession?.trim() || null,
          medallion_id: provider.ID?.trim() || null,
          board_certificates: provider['Board Certificates']?.trim() || null,
          has_caqh_management: boolFromString(provider['Has CAQH Management?']),
          auto_renew_licenses: boolFromString(provider['Should auto-renew licenses?']),
          practice_restrictions: provider['Practice Restrictions']?.trim() || null,
          has_collaborative_agreements: boolFromString(provider['Has Collaborative Agreements?']),
          primary_specialty: provider['Primary Specialty']?.trim() || null,
          secondary_contact_email: provider['Secondary Contact Email']?.trim() || null,
          employment_offer_date: parseDate(provider['Employment Offer Date']),
          employment_start_date: parseDate(provider['Start Date']),
          caqh_number: provider['CAQH Number']?.trim() || null,
          phone_number: normalizePhone(provider['Primary Phone'] || ''),
          birthday: parseDate(provider['Date Of Birth']),
          pronoun: provider['Preferred Pronoun']?.trim() || null,
          npi_number: provider.NPI?.trim() || null,
          address_line_1: provider['Address line 1']?.trim() || null,
          address_line_2: provider['Address line 2']?.trim() || null,
          address_city: provider['Address City']?.trim() || null,
          address_state: provider['Address State']?.trim() || null,
          postal_code: provider['Postal code']?.trim() || null,
          actively_licensed_states: activelyLicensedStates,
        };

        // Check if profile exists
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle();

        const providerName = newProfileData.full_name || email;
        
        if (existingProfile) {
          // Build update data - only fill missing or resolve conflicts
          const updateData: Record<string, any> = {};
          
          for (const [field, newValue] of Object.entries(newProfileData)) {
            if (field === 'email') continue; // Never update email
            
            const currentValue = existingProfile[field];
            const isEmpty = currentValue === null || currentValue === undefined || currentValue === '';
            
            if (isEmpty && newValue !== null && newValue !== undefined && newValue !== '') {
              // Fill missing field
              updateData[field] = newValue;
              results.fieldsFilled++;
            } else if (!isEmpty && newValue !== null && newValue !== undefined && newValue !== '') {
              // Both have values - check for significant difference
              if (isSignificantDifference(currentValue, newValue, field)) {
                const resolutionKey = `${email}:${field}`;
                
                if (importMode === 'preview') {
                  // Report conflict
                  results.conflicts.push({
                    email,
                    providerName,
                    field,
                    fieldLabel: fieldLabels[field] || field,
                    currentValue,
                    newValue,
                  });
                } else {
                  // Check if resolution exists
                  const useNew = resolvedFields.get(resolutionKey);
                  if (useNew === true) {
                    updateData[field] = newValue;
                    results.fieldsUpdated++;
                  }
                  // If useNew is false or undefined, keep current (don't update)
                }
              }
            }
          }

          if (importMode === 'apply' && Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
              .from('profiles')
              .update(updateData)
              .eq('id', existingProfile.id);
            
            if (updateError) throw updateError;
          }
          
          results.profilesUpserted++;
          
          // Handle licenses
          if (importMode === 'apply') {
            const licenses = parseLicenses(provider.Licenses || '');
            
            for (const license of licenses) {
              const { data: existingLicense } = await supabase
                .from('provider_licenses')
                .select('id')
                .eq('profile_id', existingProfile.id)
                .eq('license_number', license.license_number)
                .eq('state_abbreviation', license.state_abbreviation)
                .maybeSingle();

              if (existingLicense) {
                // Update existing license - fill missing dates only
                const { data: licenseDetails } = await supabase
                  .from('provider_licenses')
                  .select('issue_date, expiration_date')
                  .eq('id', existingLicense.id)
                  .single();
                  
                const licenseUpdate: Record<string, any> = { status: license.status };
                if (!licenseDetails?.issue_date && license.issue_date) {
                  licenseUpdate.issue_date = license.issue_date;
                }
                if (!licenseDetails?.expiration_date && license.expiration_date) {
                  licenseUpdate.expiration_date = license.expiration_date;
                }
                
                await supabase
                  .from('provider_licenses')
                  .update(licenseUpdate)
                  .eq('id', existingLicense.id);
              } else {
                const { error: licenseError } = await supabase
                  .from('provider_licenses')
                  .insert({
                    profile_id: existingProfile.id,
                    provider_email: email,
                    license_number: license.license_number,
                    state_abbreviation: license.state_abbreviation,
                    status: license.status,
                    issue_date: license.issue_date,
                    expiration_date: license.expiration_date,
                  });

                if (!licenseError) {
                  results.licensesInserted++;
                }
              }
            }
          }
        } else {
          // New profile - insert everything
          if (importMode === 'apply') {
            const insertData = {
              ...newProfileData,
              employment_status: 'active',
            };
            
            const { data: newProfile, error: insertError } = await supabase
              .from('profiles')
              .insert(insertData)
              .select('id')
              .single();
            
            if (insertError) throw insertError;
            
            results.profilesUpserted++;
            
            const licenses = parseLicenses(provider.Licenses || '');
            
            for (const license of licenses) {
              const { error: licenseError } = await supabase
                .from('provider_licenses')
                .insert({
                  profile_id: newProfile.id,
                  provider_email: email,
                  license_number: license.license_number,
                  state_abbreviation: license.state_abbreviation,
                  status: license.status,
                  issue_date: license.issue_date,
                  expiration_date: license.expiration_date,
                });

              if (!licenseError) {
                results.licensesInserted++;
              }
            }
          } else {
            // Preview mode - just count
            results.profilesUpserted++;
          }
        }
      } catch (err) {
        results.errors.push(`Error processing ${provider.Email}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
