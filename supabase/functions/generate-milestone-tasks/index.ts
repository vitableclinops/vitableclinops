import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Provider {
  id: string;
  full_name: string;
  email: string;
  date_of_birth: string | null;
  start_date_on_network: string | null;
  milestone_visibility: string;
  pod_id: string | null;
}

interface Pod {
  id: string;
  name: string;
  pod_lead_id: string;
  pod_lead_name: string;
  pod_lead_email: string;
  slack_channel: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current date in America/Chicago timezone
    const now = new Date();
    const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = chicagoFormatter.format(now);
    const today = new Date(todayStr);
    const currentYear = today.getFullYear();

    // Configuration
    const BIRTHDAY_LEAD_DAYS = 3;
    const ANNIVERSARY_LEAD_DAYS = 7;

    // Fetch all providers with milestone data and opt-in
    const { data: providers, error: providersError } = await supabase
      .from('profiles')
      .select('id, full_name, email, date_of_birth, start_date_on_network, milestone_visibility, pod_id')
      .or('date_of_birth.not.is.null,start_date_on_network.not.is.null')
      .neq('milestone_visibility', 'private');

    if (providersError) {
      throw new Error(`Failed to fetch providers: ${providersError.message}`);
    }

    // Fetch all pods
    const { data: pods, error: podsError } = await supabase
      .from('pods')
      .select('id, name, pod_lead_id, pod_lead_name, pod_lead_email, slack_channel');

    if (podsError) {
      throw new Error(`Failed to fetch pods: ${podsError.message}`);
    }

    const podsMap = new Map<string, Pod>();
    (pods || []).forEach(pod => podsMap.set(pod.id, pod));

    const tasksToCreate: any[] = [];
    const auditLogs: any[] = [];

    for (const provider of providers || []) {
      const pod = provider.pod_id ? podsMap.get(provider.pod_id) : null;
      
      // Skip if no pod lead assigned and visibility is pod_only
      if (provider.milestone_visibility === 'pod_only' && !pod?.pod_lead_id) {
        continue;
      }

      // Check birthday
      if (provider.date_of_birth) {
        const dob = new Date(provider.date_of_birth);
        const birthdayThisYear = new Date(currentYear, dob.getMonth(), dob.getDate());
        
        // Check if birthday is coming up within lead days
        const dueDate = new Date(birthdayThisYear);
        dueDate.setDate(dueDate.getDate() - BIRTHDAY_LEAD_DAYS);
        
        // If due date is today or in the past but birthday hasn't happened yet
        if (dueDate <= today && birthdayThisYear >= today) {
          const formattedBirthday = birthdayThisYear.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
          });
          
          const slackTemplate = `🎂 Happy Birthday, ${provider.full_name}! 🎉\n\nPlease join us in wishing ${provider.full_name} a wonderful birthday on ${formattedBirthday}!`;
          
          tasksToCreate.push({
            provider_id: provider.id,
            provider_name: provider.full_name,
            provider_email: provider.email,
            milestone_type: 'birthday',
            milestone_date: birthdayThisYear.toISOString().split('T')[0],
            milestone_year: currentYear,
            assigned_to: pod?.pod_lead_id || null,
            assigned_to_name: pod?.pod_lead_name || null,
            pod_id: provider.pod_id,
            title: `${provider.full_name}'s birthday on ${formattedBirthday}`,
            description: `${provider.full_name} has a birthday coming up on ${formattedBirthday}. Please coordinate a birthday message.`,
            slack_template: slackTemplate,
            due_date: dueDate.toISOString().split('T')[0],
          });
        }
      }

      // Check work anniversary
      if (provider.start_date_on_network) {
        const startDate = new Date(provider.start_date_on_network);
        const anniversaryThisYear = new Date(currentYear, startDate.getMonth(), startDate.getDate());
        
        // Calculate years
        const yearsAtCompany = currentYear - startDate.getFullYear();
        
        // Only create task if it's a real anniversary (at least 1 year)
        if (yearsAtCompany >= 1) {
          const dueDate = new Date(anniversaryThisYear);
          dueDate.setDate(dueDate.getDate() - ANNIVERSARY_LEAD_DAYS);
          
          // If due date is today or in the past but anniversary hasn't happened yet
          if (dueDate <= today && anniversaryThisYear >= today) {
            const formattedDate = anniversaryThisYear.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
            });
            
            const yearWord = yearsAtCompany === 1 ? 'year' : 'years';
            const slackTemplate = `🎉 Happy ${yearsAtCompany}-Year Anniversary, ${provider.full_name}! 🎊\n\nPlease join us in celebrating ${provider.full_name}'s ${yearsAtCompany} ${yearWord} with us on ${formattedDate}!`;
            
            tasksToCreate.push({
              provider_id: provider.id,
              provider_name: provider.full_name,
              provider_email: provider.email,
              milestone_type: 'anniversary',
              milestone_date: anniversaryThisYear.toISOString().split('T')[0],
              milestone_year: currentYear,
              assigned_to: pod?.pod_lead_id || null,
              assigned_to_name: pod?.pod_lead_name || null,
              pod_id: provider.pod_id,
              title: `${provider.full_name}'s ${yearsAtCompany}-year anniversary on ${formattedDate}`,
              description: `${provider.full_name} will celebrate ${yearsAtCompany} ${yearWord} with us on ${formattedDate}. Please coordinate a celebration message.`,
              slack_template: slackTemplate,
              due_date: dueDate.toISOString().split('T')[0],
            });
          }
        }
      }
    }

    // Insert tasks with ON CONFLICT handling for deduplication
    let createdCount = 0;
    let skippedCount = 0;

    for (const task of tasksToCreate) {
      const { data, error } = await supabase
        .from('milestone_tasks')
        .upsert(task, {
          onConflict: 'provider_id,milestone_type,milestone_year',
          ignoreDuplicates: true,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Duplicate - already exists
          skippedCount++;
        } else {
          console.error('Error creating task:', error);
        }
      } else if (data) {
        createdCount++;
        auditLogs.push({
          milestone_task_id: data.id,
          provider_id: task.provider_id,
          action: 'task_created',
          actor_name: 'System (Scheduled Job)',
          details: {
            milestone_type: task.milestone_type,
            milestone_date: task.milestone_date,
            assigned_to: task.assigned_to_name,
          },
        });
      }
    }

    // Insert audit logs
    if (auditLogs.length > 0) {
      await supabase.from('milestone_audit_log').insert(auditLogs);
    }

    console.log(`Milestone task generation complete: ${createdCount} created, ${skippedCount} skipped (duplicates)`);

    return new Response(
      JSON.stringify({
        success: true,
        created: createdCount,
        skipped: skippedCount,
        message: `Generated ${createdCount} milestone tasks, skipped ${skippedCount} duplicates`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-milestone-tasks:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
