import { supabase } from '@/integrations/supabase/client';

type EmailType = 
  | 'task_assigned'
  | 'workflow_initiated'
  | 'task_overdue'
  | 'status_changed'
  | 'meeting_reminder';

interface SendEmailParams {
  type: EmailType;
  recipientEmail: string;
  recipientName: string;
  data: Record<string, any>;
}

export function useEmailNotifications() {
  const sendEmail = async ({ type, recipientEmail, recipientName, data }: SendEmailParams) => {
    try {
      const { data: result, error } = await supabase.functions.invoke('send-notification-email', {
        body: { type, recipientEmail, recipientName, data },
      });

      if (error) {
        console.error('Failed to send email:', error);
        return { success: false, error: error.message };
      }

      return { success: true, id: result?.id };
    } catch (err: any) {
      console.error('Email notification error:', err);
      return { success: false, error: err.message };
    }
  };

  const notifyTaskAssigned = async (
    assigneeEmail: string,
    assigneeName: string,
    taskDetails: {
      taskTitle: string;
      description?: string;
      stateName?: string;
      stateAbbreviation?: string;
      dueDate?: string;
      priority?: string;
      actionUrl?: string;
    }
  ) => {
    return sendEmail({
      type: 'task_assigned',
      recipientEmail: assigneeEmail,
      recipientName: assigneeName,
      data: taskDetails,
    });
  };

  const notifyWorkflowInitiated = async (
    recipientEmail: string,
    recipientName: string,
    workflowDetails: {
      workflowType: string;
      providerName: string;
      stateName: string;
      physicianName?: string;
      initiatedBy: string;
      notes?: string;
      actionUrl?: string;
    }
  ) => {
    return sendEmail({
      type: 'workflow_initiated',
      recipientEmail: recipientEmail,
      recipientName: recipientName,
      data: workflowDetails,
    });
  };

  const notifyStatusChanged = async (
    recipientEmail: string,
    recipientName: string,
    statusDetails: {
      entityName: string;
      previousStatus: string;
      newStatus: string;
      changedBy?: string;
      notes?: string;
      actionUrl?: string;
    }
  ) => {
    return sendEmail({
      type: 'status_changed',
      recipientEmail: recipientEmail,
      recipientName: recipientName,
      data: statusDetails,
    });
  };

  const notifyMeetingReminder = async (
    recipientEmail: string,
    recipientName: string,
    meetingDetails: {
      meetingType: string;
      scheduledDate: string;
      stateName?: string;
      attendees?: string;
      notes?: string;
      actionUrl?: string;
    }
  ) => {
    return sendEmail({
      type: 'meeting_reminder',
      recipientEmail: recipientEmail,
      recipientName: recipientName,
      data: meetingDetails,
    });
  };

  return {
    sendEmail,
    notifyTaskAssigned,
    notifyWorkflowInitiated,
    notifyStatusChanged,
    notifyMeetingReminder,
  };
}
