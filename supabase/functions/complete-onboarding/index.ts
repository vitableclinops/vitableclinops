import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify the caller
    const authHeader = req.headers.get("Authorization")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get caller's profile
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, full_name, email, npi_number")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      alwaysCollabStates = [],
      conditionalStates = [],
      reportedLicenses = [],
      providerName,
      providerEmail,
      npiNumber,
    } = body;

    const results = {
      agreementsCreated: 0,
      tasksCreated: 0,
      licenseReviewTasks: 0,
      errors: [] as string[],
    };

    // 1. Create admin review tasks for each reported license
    for (const license of reportedLicenses) {
      try {
        // Check for existing review task
        const { data: existing } = await adminClient
          .from("agreement_tasks")
          .select("id")
          .eq("provider_id", profile.id)
          .eq("state_abbreviation", license.state)
          .ilike("title", "%Verify reported license%")
          .maybeSingle();

        if (!existing) {
          await adminClient.from("agreement_tasks").insert({
            provider_id: profile.id,
            title: `Verify reported license for ${providerName} in ${license.state}`,
            description: `${providerName} reported a ${license.licenseType || "APRN"} license in ${license.state} (License #: ${license.licenseNumber || "not provided"}, Exp: ${license.expirationDate || "not provided"}) during onboarding. Please verify this license and update its status.`,
            category: "compliance",
            status: "pending",
            priority: "high",
            assigned_role: "admin",
            is_auto_generated: true,
            auto_trigger: "onboarding_license_review",
            state_abbreviation: license.state,
          });
          results.licenseReviewTasks++;
        }
      } catch (e) {
        results.errors.push(`License review task for ${license.state}: ${e.message}`);
      }
    }

    // 2. Create pending collaborative agreements for "always" states
    for (const stateAbbr of alwaysCollabStates) {
      try {
        // Get state name
        const { data: stateData } = await adminClient
          .from("state_compliance_requirements")
          .select("state_name")
          .eq("state_abbreviation", stateAbbr)
          .maybeSingle();
        const stateName = stateData?.state_name || stateAbbr;

        // Check for existing agreement link
        const { data: existingLinks } = await adminClient
          .from("agreement_providers")
          .select("id, agreement:agreement_id (id, state_abbreviation)")
          .eq("provider_id", profile.id);

        const hasExisting = existingLinks?.some(
          (link: any) => link.agreement?.state_abbreviation === stateAbbr
        );

        if (hasExisting) continue;

        // Create agreement
        const { data: newAgreement, error: agError } = await adminClient
          .from("collaborative_agreements")
          .insert({
            state_abbreviation: stateAbbr,
            state_id: stateAbbr,
            state_name: stateName,
            workflow_status: "draft",
            created_by: profile.id,
            source: "onboarding",
          })
          .select()
          .single();

        if (agError) {
          results.errors.push(`Agreement for ${stateAbbr}: ${agError.message}`);
          continue;
        }

        results.agreementsCreated++;

        // Link provider
        await adminClient.from("agreement_providers").insert({
          agreement_id: newAgreement.id,
          provider_id: profile.id,
          provider_name: providerName,
          provider_email: providerEmail,
          provider_npi: npiNumber || null,
          is_active: true,
          signature_status: "pending",
        });

        // Create "Assign collaborating physician" task
        await adminClient.from("agreement_tasks").insert({
          agreement_id: newAgreement.id,
          provider_id: profile.id,
          title: `Assign collaborating physician for ${stateName}`,
          description: `A new provider has completed onboarding and requires a collaborating physician in ${stateName}. Review available physicians and make an assignment.`,
          category: "agreement_creation",
          status: "pending",
          priority: "high",
          assigned_role: "admin",
          is_auto_generated: true,
          auto_trigger: "onboarding_completion",
          state_abbreviation: stateAbbr,
          state_name: stateName,
        });
        results.tasksCreated++;
      } catch (e) {
        results.errors.push(`Agreement ${stateAbbr}: ${e.message}`);
      }
    }

    // 3. Create review tasks for conditional states
    for (const stateAbbr of conditionalStates) {
      try {
        const { data: stateData } = await adminClient
          .from("state_compliance_requirements")
          .select("state_name")
          .eq("state_abbreviation", stateAbbr)
          .maybeSingle();
        const stateName = stateData?.state_name || stateAbbr;

        // Create pending_review decision
        const { data: existingDecision } = await adminClient
          .from("provider_state_collab_decisions")
          .select("id")
          .eq("profile_id", profile.id)
          .eq("state_abbreviation", stateAbbr)
          .maybeSingle();

        if (!existingDecision) {
          await adminClient.from("provider_state_collab_decisions").insert({
            profile_id: profile.id,
            state_abbreviation: stateAbbr,
            decision: "pending_review",
          });
        }

        // Create admin review task
        const { data: existingTask } = await adminClient
          .from("agreement_tasks")
          .select("id")
          .eq("provider_id", profile.id)
          .eq("state_abbreviation", stateAbbr)
          .ilike("title", "%FPA eligibility%")
          .maybeSingle();

        if (!existingTask) {
          await adminClient.from("agreement_tasks").insert({
            provider_id: profile.id,
            title: `Confirm FPA eligibility for ${providerName} in ${stateName}`,
            description: `${stateName} has conditional collaboration requirements. Review the provider's credentials to determine if they meet Full Practice Authority requirements, or if a collaborative agreement is needed.`,
            category: "compliance",
            status: "pending",
            priority: "medium",
            assigned_role: "admin",
            is_auto_generated: true,
            auto_trigger: "conditional_state_review",
            state_abbreviation: stateAbbr,
            state_name: stateName,
          });
          results.tasksCreated++;
        }
      } catch (e) {
        results.errors.push(`Conditional ${stateAbbr}: ${e.message}`);
      }
    }

    // 4. General notification task for Clinical Ops
    if (alwaysCollabStates.length > 0 || conditionalStates.length > 0 || reportedLicenses.length > 0) {
      const allStates = [...new Set([...alwaysCollabStates, ...conditionalStates, ...reportedLicenses.map((l: any) => l.state)])];
      await adminClient.from("agreement_tasks").insert({
        provider_id: profile.id,
        title: `New provider onboarded: ${providerName}`,
        description: `${providerName} has completed onboarding with ${reportedLicenses.length} reported license(s) in: ${allStates.join(", ")}. ${alwaysCollabStates.length > 0 ? `${alwaysCollabStates.length} state(s) require collaborative agreements.` : ""} Please review and verify.`,
        category: "compliance",
        status: "pending",
        priority: "high",
        assigned_role: "admin",
        is_auto_generated: true,
        auto_trigger: "onboarding_completion",
      });
      results.tasksCreated++;
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});