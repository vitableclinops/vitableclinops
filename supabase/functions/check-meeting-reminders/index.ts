import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    const resend = new Resend(resendApiKey);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") || "noreply@yourdomain.com";

    // Look for meetings happening tomorrow (24-48 hours from now)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString();
    const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString();

    // Find tasks that are supervision_meeting category with due_date tomorrow
    const { data: meetingTasks, error: tasksError } = await supabase
      .from('agreement_tasks')
      .select(`
        id, 
        title, 
        description, 
        state_name, 
        due_date, 
        assigned_to, 
        assigned_to_name,
        agreement_id
      `)
      .eq('category', 'supervision_meeting')
      .neq('status', 'completed')
      .gte('due_date', tomorrowStart)
      .lte('due_date', tomorrowEnd);

    if (tasksError) {
      console.error('Error fetching meeting tasks:', tasksError);
      throw tasksError;
    }

    if (!meetingTasks || meetingTasks.length === 0) {
      console.log('No upcoming meetings found for tomorrow');
      return new Response(
        JSON.stringify({ success: true, message: 'No meetings tomorrow', count: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Found ${meetingTasks.length} meetings tomorrow`);

    // Get unique agreement IDs to fetch provider info
    const agreementIds = [...new Set(meetingTasks.map(t => t.agreement_id).filter(Boolean))];
    
    // Fetch agreement details including providers
    const { data: agreements } = await supabase
      .from('collaborative_agreements')
      .select(`
        id,
        physician_name,
        physician_email,
        agreement_providers (
          provider_id,
          profiles:provider_id (
            id,
            email,
            full_name
          )
        )
      `)
      .in('id', agreementIds);

    const agreementMap = new Map(agreements?.map(a => [a.id, a]) || []);
    let emailsSent = 0;

    for (const task of meetingTasks) {
      const agreement = task.agreement_id ? agreementMap.get(task.agreement_id) : null;
      const recipients: Array<{ email: string; name: string }> = [];

      // Add assigned person
      if (task.assigned_to) {
        const { data: assigneeProfile } = await supabase
          .from('profiles')
          .select('email, full_name')
          .eq('id', task.assigned_to)
          .single();
        
        if (assigneeProfile?.email) {
          recipients.push({ email: assigneeProfile.email, name: assigneeProfile.full_name || 'Team Member' });
        }
      }

      // Add physician
      if (agreement?.physician_email) {
        recipients.push({ email: agreement.physician_email, name: agreement.physician_name || 'Physician' });
      }

      // Add providers from agreement
      if (agreement?.agreement_providers) {
        for (const ap of agreement.agreement_providers as any[]) {
          if (ap.profiles?.email) {
            recipients.push({ email: ap.profiles.email, name: ap.profiles.full_name || 'Provider' });
          }
        }
      }

      // Deduplicate by email
      const uniqueRecipients = [...new Map(recipients.map(r => [r.email, r])).values()];

      for (const recipient of uniqueRecipients) {
        try {
          await resend.emails.send({
            from: `Credentialing Platform <${fromAddress}>`,
            to: [recipient.email],
            subject: `📅 Reminder: ${task.title} - Tomorrow`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                  <h1 style="margin: 0;">📅 Meeting Reminder</h1>
                </div>
                <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p>Hi ${recipient.name},</p>
                  <p>This is a reminder for your upcoming supervision meeting:</p>
                  <h2 style="color: #10b981; margin: 16px 0;">${task.title}</h2>
                  <p><strong>Date:</strong> ${new Date(task.due_date).toLocaleDateString()}</p>
                  ${task.state_name ? `<p><strong>State:</strong> ${task.state_name}</p>` : ''}
                  ${task.description ? `<p><strong>Notes:</strong> ${task.description}</p>` : ''}
                  ${agreement?.physician_name ? `<p><strong>Physician:</strong> ${agreement.physician_name}</p>` : ''}
                </div>
                <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 24px;">
                  <p>This is an automated message from the Credentialing Platform.</p>
                </div>
              </div>
            `,
          });
          emailsSent++;
          console.log(`Sent meeting reminder to ${recipient.email} for ${task.title}`);
        } catch (emailError) {
          console.error(`Failed to send reminder to ${recipient.email}:`, emailError);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        meetingsFound: meetingTasks.length,
        emailsSent,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in check-meeting-reminders:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
