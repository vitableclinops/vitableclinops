import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DirectoryProvider {
  name: string;
  vitableEmail: string;
  personalEmail?: string;
  phone?: string;
  address?: string;
  hireDate?: string;
  npi?: string;
  providerType?: string;
  services?: string;
  status?: string;
  notes?: string;
  languages?: string;
  minAgeTreat?: string;
  podLead?: string;
  collaboratingPhysician?: string;
  activeCollabStates?: string[];
  activeStates?: string[];
  allLicenseStates?: string[];
}

interface RosterProvider {
  fullName: string;
  email: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  profession?: string;
  npi?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  caqhNumber?: string;
  licenses: License[];
}

interface License {
  state: string;
  licenseNumber: string;
  status: string;
  issueDate?: string;
  expirationDate?: string;
  licenseType?: string;
}

// Parse licenses from roster CSV format
function parseLicenses(licenseText: string): License[] {
  const licenses: License[] = [];
  if (!licenseText) return licenses;
  
  // Split by numbered entries (1., 2., etc.)
  const entries = licenseText.split(/\d+\.\s+License Number\s*:\s*/);
  
  for (const entry of entries) {
    if (!entry.trim()) continue;
    
    const lines = entry.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    
    const license: License = {
      licenseNumber: lines[0],
      state: '',
      status: 'active'
    };
    
    for (const line of lines) {
      if (line.startsWith('Status :')) {
        license.status = line.replace('Status :', '').trim();
      } else if (line.startsWith('State :')) {
        license.state = line.replace('State :', '').trim();
      } else if (line.startsWith('Issue Date :')) {
        license.issueDate = line.replace('Issue Date :', '').trim();
      } else if (line.startsWith('Expiration Date :')) {
        license.expirationDate = line.replace('Expiration Date :', '').trim();
      }
    }
    
    if (license.state && license.licenseNumber) {
      licenses.push(license);
    }
  }
  
  return licenses;
}

// Parse state abbreviations from Notion link format
function parseStatesFromNotionLinks(text: string): string[] {
  if (!text) return [];
  // Extract state abbreviations from patterns like "PA (https://..." or just "PA"
  const statePattern = /\b([A-Z]{2})\s*\(/g;
  const states: string[] = [];
  let match;
  while ((match = statePattern.exec(text)) !== null) {
    if (!states.includes(match[1])) {
      states.push(match[1]);
    }
  }
  return states;
}

// Clean phone number
function cleanPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  // Remove all non-digit characters
  return phone.replace(/\D/g, '').slice(-10) || null;
}

// Parse date string to ISO format
function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  // Try various formats
  const formats = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /(\d{2})\/(\d{2})\/(\d{2})/, // MM/DD/YY
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format === formats[0]) {
        return `${match[1]}-${match[2]}-${match[3]}`;
      } else if (format === formats[1]) {
        return `${match[3]}-${match[1]}-${match[2]}`;
      } else if (format === formats[2]) {
        const year = parseInt(match[3]) > 50 ? `19${match[3]}` : `20${match[3]}`;
        return `${year}-${match[1]}-${match[2]}`;
      }
    }
  }
  
  return null;
}

// Map provider type to credentials
function mapProviderType(providerType: string | undefined): string | null {
  if (!providerType) return null;
  const type = providerType.toLowerCase();
  if (type.includes('np') || type.includes('nurse practitioner')) return 'NP';
  if (type.includes('physician') || type.includes('md') || type.includes('do')) return 'MD';
  if (type.includes('lcsw')) return 'LCSW';
  if (type.includes('mh coach') || type.includes('mental health')) return 'MH Coach';
  if (type.includes('rn')) return 'RN';
  return providerType;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { directoryData, rosterData, dryRun = true } = await req.json();
    
    const results = {
      providersProcessed: 0,
      providersInserted: 0,
      providersUpdated: 0,
      licensesProcessed: 0,
      licensesInserted: 0,
      errors: [] as string[],
      providers: [] as any[],
    };

    // Build a map of email -> provider data from both sources
    const providerMap = new Map<string, any>();

    // Process directory CSV if provided
    if (directoryData && Array.isArray(directoryData)) {
      for (const row of directoryData) {
        const email = (row['Vitable Email'] || row['vitableEmail'] || '').trim().toLowerCase();
        if (!email) continue;
        
        const provider: DirectoryProvider = {
          name: (row['Name'] || '').trim(),
          vitableEmail: email,
          personalEmail: (row['Personal Email'] || '').trim() || undefined,
          phone: row['Phone'] || undefined,
          address: row['Address'] || undefined,
          hireDate: row['Hired'] || undefined,
          npi: row['NPI'] || undefined,
          providerType: row['Provider type'] || undefined,
          services: row['Services'] || undefined,
          status: row['Status'] || 'Active',
          notes: row['Notes'] || undefined,
          languages: row['Languages'] || undefined,
          minAgeTreat: row['min age they treat'] || undefined,
          podLead: row['Pod Lead'] || undefined,
          collaboratingPhysician: row['Collaborative Physcian'] || undefined,
          activeCollabStates: parseStatesFromNotionLinks(row['Active Collab Agreements'] || ''),
          activeStates: parseStatesFromNotionLinks(row['Active States '] || row['Active States'] || ''),
          allLicenseStates: parseStatesFromNotionLinks(row['Licenses'] || ''),
        };
        
        providerMap.set(email, { ...providerMap.get(email), directory: provider });
      }
    }

    // Process roster CSV if provided
    if (rosterData && Array.isArray(rosterData)) {
      for (const row of rosterData) {
        const email = (row['Email'] || '').trim().toLowerCase();
        if (!email) continue;
        
        const licenses = parseLicenses(row['Licenses'] || '');
        
        const provider: RosterProvider = {
          fullName: row['Full name'] || '',
          email: email,
          firstName: row['First Name'] || undefined,
          lastName: row['Last Name'] || undefined,
          preferredName: row['Preferred Name'] || undefined,
          profession: row['Profession'] || undefined,
          npi: row['NPI'] || undefined,
          phone: row['Primary Phone'] || undefined,
          dateOfBirth: row['Date Of Birth'] || undefined,
          address: row['Address line 1'] || undefined,
          city: row['Address City'] || undefined,
          state: row['Address State'] || undefined,
          postalCode: row['Postal code'] || undefined,
          caqhNumber: row['CAQH Number'] || undefined,
          licenses: licenses,
        };
        
        const existing = providerMap.get(email) || {};
        providerMap.set(email, { ...existing, roster: provider });
      }
    }

    // Process combined provider data
    for (const [email, data] of providerMap) {
      try {
        results.providersProcessed++;
        
        const directory = data.directory as DirectoryProvider | undefined;
        const roster = data.roster as RosterProvider | undefined;
        
        // Merge data, preferring roster for structured fields
        const fullName = roster?.fullName || directory?.name || '';
        const npi = roster?.npi || directory?.npi || null;
        const phone = cleanPhone(roster?.phone || directory?.phone);
        const credentials = mapProviderType(roster?.profession || directory?.providerType);
        
        // Build address
        let homeAddress: string | null = null;
        if (roster?.address) {
          const parts = [roster.address, roster.city, roster.state, roster.postalCode].filter(Boolean);
          homeAddress = parts.join(', ');
        } else if (directory?.address) {
          homeAddress = directory.address;
        }
        
        // Parse dates
        const birthday = parseDate(roster?.dateOfBirth);
        const employmentStartDate = parseDate(directory?.hireDate);
        
        // Employment status
        const status = directory?.status?.toLowerCase() || 'active';
        const employmentStatus = status.includes('off-board') ? 'termed' : 'active';
        
        // Build profile data
        const profileData = {
          email: email,
          full_name: fullName,
          preferred_name: roster?.preferredName || null,
          npi_number: npi,
          phone_number: phone,
          credentials: credentials,
          home_address: homeAddress,
          birthday: birthday,
          employment_start_date: employmentStartDate,
          employment_status: employmentStatus,
          service_offerings: directory?.services || null,
          patient_age_preference: directory?.minAgeTreat ? `${directory.minAgeTreat}+` : null,
        };
        
        results.providers.push({
          email,
          profileData,
          licenseCount: roster?.licenses?.length || 0,
          activeStates: directory?.activeStates || [],
          collabStates: directory?.activeCollabStates || [],
        });
        
        if (!dryRun) {
          // Check if profile exists
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          
          let profileId: string;
          
          if (existingProfile) {
            // Update existing
            const { error: updateError } = await supabase
              .from('profiles')
              .update(profileData)
              .eq('id', existingProfile.id);
            
            if (updateError) {
              results.errors.push(`Failed to update profile for ${email}: ${updateError.message}`);
              continue;
            }
            
            profileId = existingProfile.id;
            results.providersUpdated++;
          } else {
            // Insert new (without user_id since we're doing admin import)
            // Note: This creates orphan profiles that will be linked when users sign up
            const { data: newProfile, error: insertError } = await supabase
              .from('profiles')
              .insert({
                ...profileData,
                user_id: null as any, // Will be updated when user signs up
              })
              .select('id')
              .single();
            
            if (insertError) {
              results.errors.push(`Failed to insert profile for ${email}: ${insertError.message}`);
              continue;
            }
            
            profileId = newProfile.id;
            results.providersInserted++;
          }
          
          // Insert licenses if we have roster data
          if (roster?.licenses && roster.licenses.length > 0) {
            for (const license of roster.licenses) {
              results.licensesProcessed++;
              
              // Check if license already exists
              const { data: existingLicense } = await supabase
                .from('provider_licenses')
                .select('id')
                .eq('profile_id', profileId)
                .eq('state_abbreviation', license.state)
                .eq('license_number', license.licenseNumber)
                .maybeSingle();
              
              if (!existingLicense) {
                const licenseData = {
                  profile_id: profileId,
                  provider_email: email,
                  state_abbreviation: license.state,
                  license_number: license.licenseNumber,
                  status: license.status === 'active' ? 'active' : 'inactive',
                  issue_date: parseDate(license.issueDate),
                  expiration_date: parseDate(license.expirationDate),
                  license_type: license.licenseNumber?.includes('AP') ? 'APRN' : 'NP',
                };
                
                const { error: licenseError } = await supabase
                  .from('provider_licenses')
                  .insert(licenseData);
                
                if (licenseError) {
                  results.errors.push(`Failed to insert license for ${email} in ${license.state}: ${licenseError.message}`);
                } else {
                  results.licensesInserted++;
                }
              }
            }
          }
        }
      } catch (err) {
        results.errors.push(`Error processing ${email}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
