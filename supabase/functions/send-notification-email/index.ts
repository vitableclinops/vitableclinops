import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type EmailType = 
  | 'task_assigned'
  | 'workflow_initiated'
  | 'task_overdue'
  | 'status_changed'
  | 'meeting_reminder';

interface EmailRequest {
  type: EmailType;
  recipientEmail: string;
  recipientName: string;
  data: Record<string, any>;
}

const getEmailContent = (type: EmailType, data: Record<string, any>, recipientName: string) => {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0; }
      .content { background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; }
      .button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
      .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 24px; }
      .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
      .badge-warning { background: #fef3c7; color: #92400e; }
      .badge-success { background: #d1fae5; color: #065f46; }
      .badge-info { background: #dbeafe; color: #1e40af; }
    </style>
  `;

  switch (type) {
    case 'task_assigned':
      return {
        subject: `🎯 New Task Assigned: ${data.taskTitle}`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Task Assigned</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>You have been assigned a new task:</p>
              <h2 style="color: #6366f1; margin: 16px 0;">${data.taskTitle}</h2>
              ${data.description ? `<p>${data.description}</p>` : ''}
              ${data.stateName ? `<p><strong>State:</strong> ${data.stateName} (${data.stateAbbreviation})</p>` : ''}
              ${data.dueDate ? `<p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>` : ''}
              ${data.priority ? `<p><strong>Priority:</strong> <span class="badge ${data.priority === 'high' ? 'badge-warning' : 'badge-info'}">${data.priority}</span></p>` : ''}
              <a href="${data.actionUrl || '#'}" class="button">View Task</a>
            </div>
            <div class="footer">
              <p>This is an automated message from the Credentialing Platform.</p>
            </div>
          </div>
        `
      };

    case 'workflow_initiated':
      return {
        subject: `🚀 New Workflow Started: ${data.workflowType} for ${data.providerName}`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Workflow Initiated</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>A new ${data.workflowType} workflow has been initiated:</p>
              <h2 style="color: #6366f1; margin: 16px 0;">${data.providerName} - ${data.stateName}</h2>
              ${data.physicianName ? `<p><strong>Physician:</strong> ${data.physicianName}</p>` : ''}
              <p><strong>Initiated by:</strong> ${data.initiatedBy}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
              ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
              <a href="${data.actionUrl || '#'}" class="button">View Workflow</a>
            </div>
            <div class="footer">
              <p>This is an automated message from the Credentialing Platform.</p>
            </div>
          </div>
        `
      };

    case 'task_overdue':
      return {
        subject: `⚠️ Overdue Task: ${data.taskTitle}`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);">
              <h1 style="margin: 0;">⚠️ Task Overdue</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>The following task is now <strong>overdue</strong>:</p>
              <h2 style="color: #ef4444; margin: 16px 0;">${data.taskTitle}</h2>
              ${data.stateName ? `<p><strong>State:</strong> ${data.stateName}</p>` : ''}
              <p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>
              <p><strong>Days Overdue:</strong> <span class="badge badge-warning">${data.daysOverdue} days</span></p>
              <a href="${data.actionUrl || '#'}" class="button" style="background: #ef4444;">Complete Task</a>
            </div>
            <div class="footer">
              <p>This is an automated message from the Credentialing Platform.</p>
            </div>
          </div>
        `
      };

    case 'status_changed':
      return {
        subject: `📋 Status Update: ${data.entityName} - ${data.newStatus}`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Status Changed</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>A status has been updated:</p>
              <h2 style="color: #6366f1; margin: 16px 0;">${data.entityName}</h2>
              <p><strong>Previous Status:</strong> <span class="badge badge-info">${data.previousStatus}</span></p>
              <p><strong>New Status:</strong> <span class="badge badge-success">${data.newStatus}</span></p>
              ${data.changedBy ? `<p><strong>Changed by:</strong> ${data.changedBy}</p>` : ''}
              ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
              <a href="${data.actionUrl || '#'}" class="button">View Details</a>
            </div>
            <div class="footer">
              <p>This is an automated message from the Credentialing Platform.</p>
            </div>
          </div>
        `
      };

    case 'meeting_reminder':
      return {
        subject: `📅 Reminder: ${data.meetingType} - ${data.scheduledDate}`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
              <h1 style="margin: 0;">📅 Meeting Reminder</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>This is a reminder for your upcoming supervision meeting:</p>
              <h2 style="color: #10b981; margin: 16px 0;">${data.meetingType}</h2>
              <p><strong>Date:</strong> ${new Date(data.scheduledDate).toLocaleDateString()}</p>
              <p><strong>Time:</strong> ${new Date(data.scheduledDate).toLocaleTimeString()}</p>
              ${data.stateName ? `<p><strong>State:</strong> ${data.stateName}</p>` : ''}
              ${data.attendees ? `<p><strong>Attendees:</strong> ${data.attendees}</p>` : ''}
              ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
              <a href="${data.actionUrl || '#'}" class="button" style="background: #10b981;">View Meeting Details</a>
            </div>
            <div class="footer">
              <p>This is an automated message from the Credentialing Platform.</p>
            </div>
          </div>
        `
      };

    default:
      return {
        subject: 'Notification from Credentialing Platform',
        html: `<p>Hi ${recipientName}, you have a new notification.</p>`
      };
  }
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const resend = new Resend(resendApiKey);
    const { type, recipientEmail, recipientName, data }: EmailRequest = await req.json();

    if (!type || !recipientEmail) {
      throw new Error("Missing required fields: type and recipientEmail");
    }

    const { subject, html } = getEmailContent(type, data || {}, recipientName || 'Team Member');

    // Note: Replace 'noreply@yourdomain.com' with your verified Resend domain
    const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") || "noreply@yourdomain.com";

    const emailResponse = await resend.emails.send({
      from: `Credentialing Platform <${fromAddress}>`,
      to: [recipientEmail],
      subject,
      html,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, id: emailResponse.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
