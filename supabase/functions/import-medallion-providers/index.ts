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
  
  // Extract state abbreviations from numbered list format
  const states: string[] = [];
  const matches = statesText.matchAll(/\d+\.\s*([A-Z]{2})/gi);
  for (const match of matches) {
    states.push(match[1].toUpperCase());
  }
  
  // Remove duplicates and sort
  return [...new Set(states)].sort().join(', ');
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  // Remove all non-digits except leading +
  const digits = phone.replace(/[^\d+]/g, '');
  // Format as (XXX) XXX-XXXX for US numbers
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
  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  return null;
}

function boolFromString(str: string): boolean {
  return str?.toLowerCase() === 'yes' || str?.toLowerCase() === 'true';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { providers } = await req.json() as { providers: ProviderRow[] };
    
    if (!providers || !Array.isArray(providers)) {
      throw new Error('Invalid request: providers array required');
    }

    const results = {
      profilesUpserted: 0,
      licensesInserted: 0,
      errors: [] as string[],
    };

    for (const provider of providers) {
      try {
        const email = provider.Email?.toLowerCase().trim();
        if (!email) {
          results.errors.push(`Skipping provider with no email`);
          continue;
        }

        // Parse active states
        const activelyLicensedStates = parseActiveStates(provider['Actively licensed states'] || '');

        // Upsert profile
        const profileData = {
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
          employment_status: 'active',
        };

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        let profileId: string;
        
        if (existingProfile) {
          // Update existing profile
          const { error: updateError } = await supabase
            .from('profiles')
            .update(profileData)
            .eq('id', existingProfile.id);
          
          if (updateError) throw updateError;
          profileId = existingProfile.id;
        } else {
          // Insert new profile
          const { data: newProfile, error: insertError } = await supabase
            .from('profiles')
            .insert(profileData)
            .select('id')
            .single();
          
          if (insertError) throw insertError;
          profileId = newProfile.id;
        }
        
        results.profilesUpserted++;

        // Parse and insert licenses
        const licenses = parseLicenses(provider.Licenses || '');
        
        for (const license of licenses) {
          // Check if license already exists
          const { data: existingLicense } = await supabase
            .from('provider_licenses')
            .select('id')
            .eq('profile_id', profileId)
            .eq('license_number', license.license_number)
            .eq('state_abbreviation', license.state_abbreviation)
            .maybeSingle();

          if (existingLicense) {
            // Update existing license
            await supabase
              .from('provider_licenses')
              .update({
                status: license.status,
                issue_date: license.issue_date,
                expiration_date: license.expiration_date,
              })
              .eq('id', existingLicense.id);
          } else {
            // Insert new license
            const { error: licenseError } = await supabase
              .from('provider_licenses')
              .insert({
                profile_id: profileId,
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
