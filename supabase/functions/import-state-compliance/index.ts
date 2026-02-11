import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("VITE_SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    const { rows } = await req.json();

    // Transform and insert data
    const stateData = rows.map((record: any) => {
      const caRawValue = record["CA Required?"]?.trim() || "";
      const caLower = caRawValue.toLowerCase();
      // Map "CA Required?" to boolean ca_required and text collab_requirement_type
      const ca_required = caLower === "yes" || caLower === "always";
      
      // Map to collab_requirement_type enum
      let collab_requirement_type = "never";
      if (caLower === "yes" || caLower === "always") collab_requirement_type = "always";
      else if (caLower === "no" || caLower === "never") collab_requirement_type = "never";
      else if (caLower === "md only") collab_requirement_type = "md_only";
      else if (caLower === "unless autonomous" || caLower === "ttp") collab_requirement_type = "conditional";

      return {
        state_abbreviation: record.State?.trim() || "",
        state_name: record["Full Name"]?.trim() || record.State?.trim() || "",
        ca_meeting_cadence: record["CA Meeting Cadence"]?.trim() || null,
        ca_required,
        collab_requirement_type,
        rxr_required: record["RxA Required?"]?.trim() || null,
        nlc: record.NLC?.trim().toLowerCase() === "yes",
        np_md_ratio: record["NP:MD Ratio"]?.trim() || null,
        licenses: record.Licenses?.trim() || null,
        fpa_status: record["Provider-State Status"]?.trim() || null,
        knowledge_base_url: record["Steps Source"]?.trim() || null,
        steps_to_confirm_eligibility: record["Steps to Confirm Eligibility"]?.trim() || null,
      };
    });

    // Filter out empty states
    const validData = stateData.filter((d: any) => d.state_abbreviation);

    // Upsert data
    const { error } = await supabase
      .from("state_compliance_requirements")
      .upsert(validData, { onConflict: "state_abbreviation" });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, inserted: validData.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
