import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];
    const results = { invalidated: 0, warnings: 0, errors: [] as string[] };

    // 1. Find active agreements where end_date has passed
    const { data: expiredAgreements, error: expErr } = await supabase
      .from("collaborative_agreements")
      .select("id, state_name, physician_name, end_date")
      .eq("workflow_status", "active")
      .lt("end_date", today)
      .not("end_date", "is", null);

    if (expErr) {
      results.errors.push(`Fetch expired agreements: ${expErr.message}`);
    }

    for (const agreement of expiredAgreements || []) {
      const { error } = await supabase
        .from("collaborative_agreements")
        .update({
          workflow_status: "invalid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", agreement.id);

      if (error) {
        results.errors.push(`Invalidate ${agreement.id}: ${error.message}`);
        continue;
      }

      // Log the invalidation
      await supabase.from("agreement_audit_log").insert({
        entity_type: "agreement",
        entity_id: agreement.id,
        action: "auto_invalidated",
        performed_by_name: "System",
        performed_by_role: "system",
        changes: {
          reason: "Agreement end date passed",
          end_date: agreement.end_date,
          previous_status: "active",
          new_status: "invalid",
        },
      });

      results.invalidated++;
    }

    // 2. Check active agreements where provider licenses have expired
    const { data: activeAgreements, error: activeErr } = await supabase
      .from("collaborative_agreements")
      .select(`
        id, state_abbreviation, state_name, physician_name,
        agreement_providers!inner(provider_id, provider_name, is_active)
      `)
      .eq("workflow_status", "active");

    if (activeErr) {
      results.errors.push(`Fetch active agreements: ${activeErr.message}`);
    }

    for (const agreement of activeAgreements || []) {
      const providers = (agreement as any).agreement_providers || [];
      
      for (const ap of providers) {
        if (!ap.is_active || !ap.provider_id) continue;

        // Check if provider has a valid license for this state
        const { data: license } = await supabase
          .from("provider_licenses")
          .select("status, expiration_date")
          .eq("profile_id", ap.provider_id)
          .eq("state_abbreviation", agreement.state_abbreviation)
          .maybeSingle();

        const licenseExpired = !license ||
          (license.status !== "active" && license.status !== "verified") ||
          (license.expiration_date && license.expiration_date < today);

        if (licenseExpired) {
          // Invalidate the agreement
          const { error } = await supabase
            .from("collaborative_agreements")
            .update({
              workflow_status: "invalid",
              updated_at: new Date().toISOString(),
            })
            .eq("id", agreement.id);

          if (error) {
            results.errors.push(`Invalidate ${agreement.id} (license): ${error.message}`);
            continue;
          }

          await supabase.from("agreement_audit_log").insert({
            entity_type: "agreement",
            entity_id: agreement.id,
            action: "auto_invalidated",
            performed_by_name: "System",
            performed_by_role: "system",
            changes: {
              reason: `Provider ${ap.provider_name} license expired or invalid in ${agreement.state_abbreviation}`,
              previous_status: "active",
              new_status: "invalid",
            },
          });

          results.invalidated++;
          break; // Already invalidated this agreement
        }
      }
    }

    // 3. Check for agreements missing required signed documents
    const { data: missingDocs, error: docErr } = await supabase
      .from("collaborative_agreements")
      .select("id, state_name, physician_name")
      .eq("workflow_status", "active")
      .is("agreement_document_url", null);

    if (docErr) {
      results.errors.push(`Fetch missing docs: ${docErr.message}`);
    }

    // For missing docs, we warn but don't auto-invalidate (could be legacy data)
    results.warnings += (missingDocs || []).length;

    console.log(`Agreement validity check complete:`, results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Agreement validity check failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
