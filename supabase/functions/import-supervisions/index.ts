import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SupervisionRow {
  'Provider Full Name': string;
  'Provider Profession': string;
  'Supervisor Full Name': string;
  'Supervisor Profession': string;
  'Supervision State': string;
  'Supervision Type': string;
  'Collaborative Agreement Status': string;
  'Effective Date': string;
  'Expiration Date': string;
  'Document': string;
}

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;
  
  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Handle MM/DD/YYYY format
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

function mapWorkflowStatus(status: string): 'draft' | 'active' | 'terminated' {
  if (!status) return 'draft';
  const normalized = status.toLowerCase().trim();
  if (normalized === 'active') return 'active';
  if (normalized === 'terminated' || normalized === 'expired') return 'terminated';
  return 'draft';
}

// Map state abbreviations to full names
const stateNames: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
  'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
  'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
  'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
  'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
  'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
  'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
  'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
  'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
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
    const { supervisions, mode } = body as { 
      supervisions: SupervisionRow[]; 
      mode?: 'preview' | 'apply';
    };
    
    if (!supervisions || !Array.isArray(supervisions)) {
      throw new Error('Invalid request: supervisions array required');
    }

    const importMode = mode || 'apply';

    const results = {
      agreementsCreated: 0,
      agreementsUpdated: 0,
      providersLinked: 0,
      skipped: 0,
      preview: [] as Array<{
        providerName: string;
        physicianName: string;
        state: string;
        supervisionType: string;
        status: string;
        effectiveDate: string;
        action: 'create' | 'update' | 'skip';
        reason?: string;
      }>,
      errors: [] as string[],
    };

    // Group by physician + state to create agreements
    const agreementGroups = new Map<string, SupervisionRow[]>();
    
    for (const row of supervisions) {
      const physician = row['Supervisor Full Name']?.trim();
      const state = row['Supervision State']?.trim().toUpperCase();
      
      if (!physician || !state) {
        results.errors.push(`Skipping row: missing physician or state`);
        continue;
      }
      
      const key = `${physician}|${state}`;
      const existing = agreementGroups.get(key) || [];
      existing.push(row);
      agreementGroups.set(key, existing);
    }

    // Process each agreement group
    for (const [key, rows] of agreementGroups) {
      const [physicianName, stateAbbr] = key.split('|');
      const stateName = stateNames[stateAbbr] || stateAbbr;
      
      // Find or lookup physician in profiles
      const { data: physicianProfile } = await supabase
        .from('profiles')
        .select('id, npi_number, email')
        .ilike('full_name', `%${physicianName}%`)
        .eq('profession', 'Physician')
        .maybeSingle();

      // Check if agreement already exists
      const { data: existingAgreement } = await supabase
        .from('collaborative_agreements')
        .select('id')
        .ilike('physician_name', `%${physicianName}%`)
        .eq('state_abbreviation', stateAbbr)
        .maybeSingle();

      // Get the first row for agreement-level data (most will be the same)
      const firstRow = rows[0];
      const workflowStatus = mapWorkflowStatus(firstRow['Collaborative Agreement Status']);
      const effectiveDate = parseDate(firstRow['Effective Date']);
      const expirationDate = parseDate(firstRow['Expiration Date']);
      const supervisionType = firstRow['Supervision Type']?.toLowerCase() || 'primary';

      if (importMode === 'preview') {
        // Preview mode - just show what would happen
        for (const row of rows) {
          results.preview.push({
            providerName: row['Provider Full Name'],
            physicianName,
            state: stateAbbr,
            supervisionType: row['Supervision Type'] || 'Primary',
            status: row['Collaborative Agreement Status'],
            effectiveDate: row['Effective Date'] || '',
            action: existingAgreement ? 'update' : 'create',
          });
        }
        continue;
      }

      // Apply mode
      let agreementId: string;

      if (existingAgreement) {
        // Update existing agreement
        const { error: updateError } = await supabase
          .from('collaborative_agreements')
          .update({
            workflow_status: workflowStatus,
            start_date: effectiveDate,
            end_date: expirationDate,
            supervision_type: supervisionType,
            medallion_document_url: firstRow['Document'] || null,
            source: 'medallion',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingAgreement.id);

        if (updateError) {
          results.errors.push(`Error updating agreement ${key}: ${updateError.message}`);
          continue;
        }

        agreementId = existingAgreement.id;
        results.agreementsUpdated++;
      } else {
        // Create new agreement
        const { data: newAgreement, error: insertError } = await supabase
          .from('collaborative_agreements')
          .insert({
            physician_name: physicianName,
            physician_id: physicianProfile?.id || null,
            physician_npi: physicianProfile?.npi_number || null,
            physician_email: physicianProfile?.email || `${physicianName.toLowerCase().replace(/[^a-z]/g, '.')}@vitablehealth.com`,
            state_abbreviation: stateAbbr,
            state_name: stateName,
            state_id: stateAbbr.toLowerCase(),
            workflow_status: workflowStatus,
            start_date: effectiveDate,
            end_date: expirationDate,
            supervision_type: supervisionType,
            medallion_document_url: firstRow['Document'] || null,
            source: 'medallion',
          })
          .select('id')
          .single();

        if (insertError) {
          results.errors.push(`Error creating agreement ${key}: ${insertError.message}`);
          continue;
        }

        agreementId = newAgreement.id;
        results.agreementsCreated++;
      }

      // Link providers to agreement
      for (const row of rows) {
        const providerName = row['Provider Full Name']?.trim();
        if (!providerName) continue;

        // Find provider in profiles
        const { data: providerProfile } = await supabase
          .from('profiles')
          .select('id, npi_number, email')
          .ilike('full_name', `%${providerName}%`)
          .neq('profession', 'Physician')
          .maybeSingle();

        // Check if already linked
        const { data: existingLink } = await supabase
          .from('agreement_providers')
          .select('id')
          .eq('agreement_id', agreementId)
          .ilike('provider_name', `%${providerName}%`)
          .maybeSingle();

        if (existingLink) {
          // Update existing link with document URL if we have it
          if (row['Document']) {
            await supabase
              .from('agreement_providers')
              .update({
                signature_status: 'signed',
                signed_at: effectiveDate ? new Date(effectiveDate).toISOString() : new Date().toISOString(),
              })
              .eq('id', existingLink.id);
          }
          results.skipped++;
        } else {
          // Create new link
          const { error: linkError } = await supabase
            .from('agreement_providers')
            .insert({
              agreement_id: agreementId,
              provider_id: providerProfile?.id || null,
              provider_npi: providerProfile?.npi_number || null,
              provider_email: providerProfile?.email || `${providerName.toLowerCase().replace(/[^a-z]/g, '.')}@vitablehealth.com`,
              provider_name: providerName,
              signature_status: row['Document'] ? 'signed' : 'pending',
              signed_at: row['Document'] && effectiveDate ? new Date(effectiveDate).toISOString() : null,
              is_active: true,
            });

          if (linkError) {
            results.errors.push(`Error linking ${providerName}: ${linkError.message}`);
          } else {
            results.providersLinked++;
          }
        }
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
