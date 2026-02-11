
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { parse } from "https://deno.land/std@0.168.0/datetime/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { type, data } = await req.json();

    if (type === 'create_calendar_events') {
      console.log('Creating calendar events...');
      
      // All-Hands Meetings (Feb 19, Mar 19, Apr 16 2026 at 11am CT/12pm ET)
      const allHandsDates = [
        '2026-02-19T11:00:00-06:00', // Feb 19, 11am CT
        '2026-03-19T11:00:00-05:00', // Mar 19, 11am CT (DST starts Mar 8) - wait, checking DST rules
        // DST 2026 starts March 8. So March 19 is CDT (-05:00). Feb 19 is CST (-06:00).
        '2026-04-16T11:00:00-05:00'  // Apr 16, 11am CDT
      ];

      const events = allHandsDates.map(dateStr => {
        const startDate = new Date(dateStr);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration

        return {
          title: 'Provider All-Hands',
          description: 'Monthly company-wide meeting for all providers.',
          event_type: 'all_hands',
          starts_at: startDate.toISOString(),
          ends_at: endDate.toISOString(),
          status: 'scheduled',
          attestation_required: true,
          attestation_due_days: 7
        };
      });

      // Insert All-Hands events
      const { data: insertedEvents, error: eventsError } = await supabase
        .from('calendar_events')
        .insert(events)
        .select();

      if (eventsError) throw eventsError;
      console.log(`Created ${insertedEvents.length} all-hands events`);

      return new Response(JSON.stringify({ success: true, events: insertedEvents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'import_csv_data') {
      // This part would handle the CSV parsing if we were sending raw CSV content
      // For now, we'll assume the client parses CSV and sends JSON objects
      // Use the existing import-providers function logic or similar
      return new Response(JSON.stringify({ message: "Use existing import functions for CSV data" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown operation type' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
