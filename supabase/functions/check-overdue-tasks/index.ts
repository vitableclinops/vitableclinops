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

    const today = new Date().toISOString().split('T')[0];

    // Find overdue tasks with assignees
    const { data: overdueTasks, error: tasksError } = await supabase
      .from('agreement_tasks')
      .select('id, title, description, state_name, due_date, assigned_to, assigned_to_name')
      .lt('due_date', today)
      .neq('status', 'completed')
      .not('assigned_to', 'is', null);

    if (tasksError) {
      console.error('Error fetching overdue tasks:', tasksError);
      throw tasksError;
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      console.log('No overdue tasks found');
      return new Response(
        JSON.stringify({ success: true, message: 'No overdue tasks', count: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Found ${overdueTasks.length} overdue tasks`);

    // Group tasks by assignee
    const tasksByAssignee = new Map<string, typeof overdueTasks>();
    for (const task of overdueTasks) {
      if (!task.assigned_to) continue;
      const existing = tasksByAssignee.get(task.assigned_to) || [];
      existing.push(task);
      tasksByAssignee.set(task.assigned_to, existing);
    }

    // Fetch assignee emails
    const assigneeIds = [...tasksByAssignee.keys()];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', assigneeIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
    let emailsSent = 0;

    // Send one email per assignee with all their overdue tasks
    for (const [assigneeId, tasks] of tasksByAssignee) {
      const profile = profileMap.get(assigneeId);
      if (!profile?.email) continue;

      const taskListHtml = tasks.map(t => {
        const dueDate = new Date(t.due_date);
        const daysOverdue = Math.floor((new Date().getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        return `
          <li style="margin-bottom: 12px;">
            <strong>${t.title}</strong>
            ${t.state_name ? `<span style="color: #6b7280;"> - ${t.state_name}</span>` : ''}
            <br/>
            <span style="color: #ef4444;">Due ${t.due_date} (${daysOverdue} days overdue)</span>
          </li>
        `;
      }).join('');

      try {
        await resend.emails.send({
          from: `Credentialing Platform <${fromAddress}>`,
          to: [profile.email],
          subject: `⚠️ You have ${tasks.length} overdue task${tasks.length > 1 ? 's' : ''}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0;">⚠️ Overdue Tasks</h1>
              </div>
              <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <p>Hi ${profile.full_name || 'Team Member'},</p>
                <p>You have <strong>${tasks.length}</strong> overdue task${tasks.length > 1 ? 's' : ''} that need${tasks.length === 1 ? 's' : ''} attention:</p>
                <ul style="padding-left: 20px;">
                  ${taskListHtml}
                </ul>
                <p>Please complete these tasks as soon as possible.</p>
              </div>
              <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 24px;">
                <p>This is an automated message from the Credentialing Platform.</p>
              </div>
            </div>
          `,
        });
        emailsSent++;
        console.log(`Sent overdue email to ${profile.email} for ${tasks.length} tasks`);
      } catch (emailError) {
        console.error(`Failed to send email to ${profile.email}:`, emailError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        tasksFound: overdueTasks.length,
        emailsSent,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in check-overdue-tasks:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
