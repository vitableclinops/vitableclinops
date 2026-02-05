import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NotionProviderRow {
  'Name': string;
  'Active Collab Agreements': string;
  'Active States ': string;
  'Address': string;
  'Collaborative Physcian': string;
  'Hired': string;
  'Languages': string;
  'Licenses': string;
  'NPI': string;
  'No Collab Needed States': string;
  'Notes': string;
  'Offboarded Date': string;
  'Offboarding Reason': string;
  'Personal Email': string;
  'Phone': string;
  'Pod Lead': string;
  'Provider type': string;
  'Services': string;
  'Start Date': string;
  'Status': string;
  'Vitable Email': string;
  'min age they treat': string;
}

interface Conflict {
  identifier: string;
  providerName: string;
  field: string;
  fieldLabel: string;
  currentValue: any;
  newValue: any;
}

interface FieldResolution {
  identifier: string;
  field: string;
  useNew: boolean;
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
  
  // Handle MM/DD/YYYY format
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Handle ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  return null;
}

// Extract state abbreviations from Notion-formatted text like "DC (https://notion.so/...), MD (https://...)"
function extractStatesFromNotionText(text: string): string[] {
  if (!text || text.trim() === '') return [];
  
  const states: string[] = [];
  // Match state abbreviations that are followed by a Notion URL or comma
  const matches = text.matchAll(/\b([A-Z]{2})\s*\(https?:\/\/[^)]+\)/gi);
  for (const match of matches) {
    states.push(match[1].toUpperCase());
  }
  
  // Also try simple comma-separated if no URLs
  if (states.length === 0) {
    const simpleMatches = text.matchAll(/\b([A-Z]{2})\b/gi);
    for (const match of simpleMatches) {
      if (match[1].length === 2) {
        states.push(match[1].toUpperCase());
      }
    }
  }
  
  return [...new Set(states)].sort();
}

function mapProviderType(type: string): string | null {
  if (!type) return null;
  const normalized = type.toLowerCase().trim();
  if (normalized === 'np') return 'NP';
  if (normalized === 'physician') return 'Physician';
  if (normalized === 'md') return 'Physician';
  if (normalized === 'do') return 'Physician';
  if (normalized === 'pa') return 'PA';
  if (normalized === 'lcsw') return 'LCSW';
  if (normalized === 'mh coach') return 'MH Coach';
  return type.trim();
}

function mapEmploymentStatus(status: string): string {
  if (!status) return 'active';
  const normalized = status.toLowerCase().trim();
  if (normalized === 'active') return 'active';
  if (normalized === 'off-boarded' || normalized === 'offboarded') return 'termed';
  if (normalized.includes('off-boarding') || normalized.includes('offboarding')) return 'termed';
  return 'active';
}

function isSignificantDifference(currentVal: any, newVal: any, fieldName: string): boolean {
  if (currentVal === null || currentVal === undefined || currentVal === '') {
    return false;
  }
  if (newVal === null || newVal === undefined || newVal === '') {
    return false;
  }
  
  const normalizedCurrent = String(currentVal).toLowerCase().trim();
  const normalizedNew = String(newVal).toLowerCase().trim();
  
  if (normalizedCurrent === normalizedNew) {
    return false;
  }
  
  // Phone number normalization
  if (fieldName === 'phone_number') {
    const currentDigits = String(currentVal).replace(/\D/g, '');
    const newDigits = String(newVal).replace(/\D/g, '');
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
  
  // Dates
  if (fieldName.includes('date')) {
    const current = new Date(currentVal);
    const newDate = new Date(newVal);
    if (!isNaN(current.getTime()) && !isNaN(newDate.getTime())) {
      if (current.toISOString().split('T')[0] === newDate.toISOString().split('T')[0]) {
        return false;
      }
    }
  }
  
  return true;
}

const fieldLabels: Record<string, string> = {
  full_name: 'Full Name',
  phone_number: 'Phone',
  profession: 'Provider Type',
  npi_number: 'NPI',
  address_line_1: 'Address',
  employment_start_date: 'Start Date',
  employment_status: 'Status',
  actively_licensed_states: 'Active States',
  notes: 'Notes',
  languages: 'Languages',
  services_offered: 'Services',
  min_patient_age: 'Min Patient Age',
  pod_lead: 'Pod Lead',
  collaborative_physician: 'Collaborative Physician',
  personal_email: 'Personal Email',
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
      providers: NotionProviderRow[]; 
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
        resolvedFields.set(`${res.identifier}:${res.field}`, res.useNew);
      }
    }

    const results = {
      profilesUpserted: 0,
      fieldsUpdated: 0,
      fieldsFilled: 0,
      conflicts: [] as Conflict[],
      errors: [] as string[],
    };

    for (const provider of providers) {
      try {
        const name = provider.Name?.trim();
        const npi = provider.NPI?.trim();
        const vitableEmail = provider['Vitable Email']?.toLowerCase().trim();
        const personalEmail = provider['Personal Email']?.toLowerCase().trim();
        
        // Need at least NPI or email to match
        if (!npi && !vitableEmail && !personalEmail) {
          results.errors.push(`Skipping "${name || 'Unknown'}": no NPI or email`);
          continue;
        }

        // Extract active states from Notion format
        const activeStatesRaw = provider['Active States '] || provider['Active States'] || '';
        const activeStates = extractStatesFromNotionText(activeStatesRaw);

        // Build new data from CSV
        const newProfileData: Record<string, any> = {
          full_name: name || null,
          phone_number: normalizePhone(provider.Phone || ''),
          profession: mapProviderType(provider['Provider type']),
          npi_number: npi || null,
          address_line_1: provider.Address?.trim() || null,
          employment_start_date: parseDate(provider['Start Date']),
          employment_status: mapEmploymentStatus(provider.Status),
          actively_licensed_states: activeStates.join(', '),
          notes: provider.Notes?.trim() || null,
          languages: provider.Languages?.trim() || null,
          services_offered: provider.Services?.trim() || null,
          min_patient_age: provider['min age they treat'] ? parseFloat(provider['min age they treat']) : null,
          pod_lead: provider['Pod Lead']?.trim() || null,
          collaborative_physician: provider['Collaborative Physcian']?.trim() || null,
          personal_email: personalEmail || null,
        };

        // Try to find existing profile: first by NPI, then by email
        let existingProfile = null;
        let matchIdentifier = '';
        
        if (npi) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('npi_number', npi)
            .maybeSingle();
          if (data) {
            existingProfile = data;
            matchIdentifier = `npi:${npi}`;
          }
        }
        
        if (!existingProfile && vitableEmail) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', vitableEmail)
            .maybeSingle();
          if (data) {
            existingProfile = data;
            matchIdentifier = `email:${vitableEmail}`;
          }
        }

        const providerName = name || vitableEmail || npi || 'Unknown';
        
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
                const resolutionKey = `${matchIdentifier}:${field}`;
                
                if (importMode === 'preview') {
                  results.conflicts.push({
                    identifier: matchIdentifier,
                    providerName,
                    field,
                    fieldLabel: fieldLabels[field] || field,
                    currentValue,
                    newValue,
                  });
                } else {
                  const useNew = resolvedFields.get(resolutionKey);
                  if (useNew === true) {
                    updateData[field] = newValue;
                    results.fieldsUpdated++;
                  }
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
        } else {
          // No matching profile found - report but don't create
          // (Notion data should merge into existing records, not create new ones)
          results.errors.push(`No matching profile for "${providerName}" (NPI: ${npi || 'N/A'}, Email: ${vitableEmail || 'N/A'})`);
        }
      } catch (err) {
        results.errors.push(`Error processing ${provider.Name}: ${err.message}`);
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
