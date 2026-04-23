import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type EmailId = "email_1_initiation" | "email_2_box_sign_sent" | "email_3_agreement_complete";
type RecipientType = "np" | "physician";

interface RequestBody {
  agreementId: string;
  emailId: EmailId;
  /** Defaults to ['np','physician'] (both). */
  recipientTypes?: RecipientType[];
  /** Optional: the rendered effective date for Email 3 (ISO date or pre-formatted string). */
  effectiveDate?: string;
  /** Optional: who triggered this send (auth user id). For audit log only. */
  triggeredBy?: string;
}

interface RenderVars {
  np_name: string;
  np_email: string;
  physician_name: string;
  physician_email: string;
  physician_phone: string;
  physician_practice: string;
  practice_name: string;
  effective_date: string;
  state_name: string;
  collab_statute: string;
  meeting_req: string;
  chart_req: string;
  ongoing_req: string;
}

/** Templates mirror collab_email_library.json exactly (whitespace preserved). */
const TEMPLATES: Record<EmailId, Record<RecipientType, { to: string; subject: string; body: string }>> = {
  email_1_initiation: {
    np: {
      to: "{{np_email}}",
      subject: "Your collaborative agreement is being set up — {{np_name}}",
      body:
        "Hi {{np_name}},\n\nWe're setting up your collaborative agreement with {{physician_name}}, MD, so you can begin seeing patients in {{state_name}}.\n\nHere's what happens next:\nThe agreement documents will be sent to both you and {{physician_name}} via Box Sign within the next 1–2 business days. You'll receive an email from Box Sign with a link to review and sign.\n\nOnce both signatures are complete, we'll send you a summary of your collaborative agreement requirements and next steps to get started.\n\nIf you have any questions in the meantime, reach out to us at providers@vitablehealth.com.\n\nTalk soon,\nVitable Health",
    },
    physician: {
      to: "{{physician_email}}",
      subject: "Collaborative agreement notice — {{np_name}} / {{practice_name}}",
      body:
        "Hi Dr. {{physician_name}},\n\nThank you again for agreeing to serve as collaborating physician for {{np_name}}, NP, practicing under {{practice_name}} in {{state_name}}.\n\nWe'll be sending the collaborative agreement documents to you via Box Sign within the next 1–2 business days. The agreement will outline the terms of collaboration, including your availability requirements and any state-mandated chart review obligations under {{collab_statute}}.\n\nIf you have any questions before the documents arrive, please don't hesitate to reach out at providers@vitablehealth.com.\n\nWe appreciate your partnership.\n\nWarm regards,\nVitable Health",
    },
  },
  email_2_box_sign_sent: {
    np: {
      to: "{{np_email}}",
      subject: "Action required: sign your collaborative agreement — {{np_name}}",
      body:
        "Hi {{np_name}},\n\nYour collaborative agreement documents have been sent! You should receive a separate email from Box Sign with a link to review and sign your agreement.\n\nYour collaborating physician for {{state_name}} is:\n{{physician_name}}, MD\n{{physician_practice}}\n\nPer the agreement, {{physician_name}} will be available for consultation and will conduct {{meeting_req}}. This arrangement allows you to practice under {{collab_statute}}.\n\nPlease sign the documents at your earliest convenience. If you don't see the Box Sign email, check your spam folder or contact us at providers@vitablehealth.com.\n\nOnce both signatures are received, we'll send you a confirmation with your full collaborative agreement requirements.\n\nThanks,\nVitable Health",
    },
    physician: {
      to: "{{physician_email}}",
      subject: "Action required: collaborative agreement for {{np_name}} needs your signature",
      body:
        "Hi Dr. {{physician_name}},\n\nThe collaborative agreement documents for {{np_name}}, NP have been sent to you via Box Sign. Please check your email for a message from Box Sign and complete your signature at your earliest convenience.\n\nThis agreement covers {{np_name}}'s practice in {{state_name}} under {{practice_name}}.\n\nUnder this agreement, you will be asked to:\n— Be available for consultation as needed\n— Conduct {{meeting_req}}\n— Complete {{chart_req}}\n\nThese requirements are consistent with {{collab_statute}}.\n\nIf you have any questions about the agreement terms, please contact us at providers@vitablehealth.com before signing.\n\nThank you,\nVitable Health",
    },
  },
  email_3_agreement_complete: {
    np: {
      to: "{{np_email}}",
      subject: "Your collaborative agreement is complete — here's what to know",
      body:
        "Hi {{np_name}},\n\nGreat news — your collaborative agreement with {{physician_name}}, MD is fully executed. You're set to see patients in {{state_name}}.\n\nHere's a summary of your agreement requirements:\n\n{{ongoing_req}}\n\nYour collaborating physician contact:\n{{physician_name}}, MD\n{{physician_email}}\n{{physician_phone}}\n\nA copy of your signed agreement is available in Box. If you need another copy or have questions about your agreement at any time, reach out to providers@vitablehealth.com.\n\nWelcome to {{state_name}}!\n\nThe Vitable Health team",
    },
    physician: {
      to: "{{physician_email}}",
      subject: "Collaborative agreement complete — {{np_name}} / {{practice_name}}",
      body:
        "Hi Dr. {{physician_name}},\n\nThe collaborative agreement with {{np_name}}, NP is now fully executed. Thank you for completing the signing process.\n\nFor your records, here is a summary of the agreement terms:\n\nNP: {{np_name}}, NP\nPractice: {{practice_name}}\nState: {{state_name}}\nEffective date: {{effective_date}}\n\nYour obligations under this agreement:\n{{ongoing_req}}\n\nA copy of the executed agreement has been saved to Box. Please reach out to providers@vitablehealth.com if you have any questions or need to make changes to the agreement terms.\n\nThank you again for your partnership with Vitable Health.\n\nWarm regards,\nVitable Health",
    },
  },
};

// TODO: Once vitablehealth.com is verified in Resend, change this back to:
// "Vitable Health <providers@vitablehealth.com>"
// Using Resend's pre-verified test sender so emails work without DNS setup.
// Reply-to is still set to providers@vitablehealth.com so replies route correctly.
const FROM_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS") || "Vitable Health <onboarding@resend.dev>";

function interpolate(str: string, vars: RenderVars): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars as any)[key] ?? `{{${key}}}`);
}

/** Convert a plain-text email body to lightweight branded HTML (paragraphs + line breaks). */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">
      ${paragraphs}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="font-size:12px;color:#6b7280;margin:0;">Vitable Health · Provider Operations</p>
    </div>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { agreementId, emailId, recipientTypes = ["np", "physician"], effectiveDate, triggeredBy } = body;

    if (!agreementId || !emailId) {
      throw new Error("agreementId and emailId are required");
    }
    if (!TEMPLATES[emailId]) {
      throw new Error(`Unknown emailId: ${emailId}`);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load agreement (with first active provider)
    const { data: agreement, error: agErr } = await supabase
      .from("collaborative_agreements")
      .select(
        "id, state_abbreviation, state_name, physician_name, physician_email, provider_name, provider_email",
      )
      .eq("id", agreementId)
      .maybeSingle();

    if (agErr) throw agErr;
    if (!agreement) throw new Error("Agreement not found");

    // Load primary NP (from agreement_providers if not on the agreement record)
    let npName = agreement.provider_name || "";
    let npEmail = agreement.provider_email || "";
    if (!npEmail) {
      const { data: aps } = await supabase
        .from("agreement_providers")
        .select("provider_name, provider_email")
        .eq("agreement_id", agreementId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      if (aps && aps[0]) {
        npName = aps[0].provider_name || npName;
        npEmail = aps[0].provider_email || npEmail;
      }
    }

    // Load state requirements — BLOCK if missing
    const stateCode = agreement.state_abbreviation;
    const { data: stateReq } = await supabase
      .from("collab_email_state_requirements")
      .select("*")
      .eq("state_code", stateCode)
      .maybeSingle();

    if (!stateReq) {
      // Log one blocked entry per recipient and bail
      const blockedRows = recipientTypes.map((rt) => ({
        agreement_id: agreementId,
        email_id: emailId,
        recipient_type: rt,
        recipient_email: rt === "np" ? npEmail : agreement.physician_email || "",
        state_code: stateCode,
        status: "blocked",
        blocked_reason: `No collab_email_state_requirements row for state '${stateCode}'. Add one before sending collab agreement emails for this state.`,
        triggered_by: triggeredBy ?? null,
      }));
      await supabase.from("collab_email_log").insert(blockedRows);

      return new Response(
        JSON.stringify({
          success: false,
          blocked: true,
          reason: "missing_state_requirements",
          stateCode,
          message: `Cannot send: no requirements configured for ${stateCode}.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vars: RenderVars = {
      np_name: npName || "Provider",
      np_email: npEmail,
      physician_name: agreement.physician_name || "",
      physician_email: agreement.physician_email || "",
      physician_phone: "", // Not yet on collaborative_agreements; templates degrade gracefully.
      physician_practice: "", // Same — populated in future schema iteration.
      practice_name: `Vitable Health ${stateReq.state_name}`,
      effective_date: effectiveDate || "",
      state_name: stateReq.state_name,
      collab_statute: stateReq.collab_statute,
      meeting_req: stateReq.meeting_req,
      chart_req: stateReq.chart_req,
      ongoing_req: stateReq.ongoing_req,
    };

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");
    const resend = new Resend(resendKey);

    const results: any[] = [];
    for (const rt of recipientTypes) {
      const tpl = TEMPLATES[emailId][rt];
      const to = interpolate(tpl.to, vars).trim();
      const subject = interpolate(tpl.subject, vars);
      const bodyText = interpolate(tpl.body, vars);
      const html = textToHtml(bodyText);

      if (!to || !to.includes("@")) {
        await supabase.from("collab_email_log").insert({
          agreement_id: agreementId,
          email_id: emailId,
          recipient_type: rt,
          recipient_email: to || "",
          state_code: stateCode,
          status: "blocked",
          blocked_reason: `Missing or invalid recipient email for ${rt}`,
          subject,
          triggered_by: triggeredBy ?? null,
        });
        results.push({ recipient_type: rt, status: "blocked", reason: "no_email" });
        continue;
      }

      try {
        const { data: sendData, error: sendErr } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: [to],
          subject,
          text: bodyText,
          html,
          reply_to: "providers@vitablehealth.com",
        });
        if (sendErr) throw sendErr;

        await supabase.from("collab_email_log").insert({
          agreement_id: agreementId,
          email_id: emailId,
          recipient_type: rt,
          recipient_email: to,
          state_code: stateCode,
          status: "sent",
          subject,
          resend_id: (sendData as any)?.id ?? null,
          triggered_by: triggeredBy ?? null,
        });
        results.push({ recipient_type: rt, status: "sent", id: (sendData as any)?.id });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await supabase.from("collab_email_log").insert({
          agreement_id: agreementId,
          email_id: emailId,
          recipient_type: rt,
          recipient_email: to,
          state_code: stateCode,
          status: "failed",
          subject,
          error_message: msg,
          triggered_by: triggeredBy ?? null,
        });
        results.push({ recipient_type: rt, status: "failed", error: msg });
      }
    }

    return new Response(JSON.stringify({ success: true, emailId, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-collab-email error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});