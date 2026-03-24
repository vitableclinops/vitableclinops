import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// Channels to search for hiring-related messages
const HIRING_KEYWORDS = [
  'directshifts', 'direct shifts', 'DS candidate', 'DS candidates',
  'interview', 'candidate', 'hiring', 'onboarding', 'credentialing',
  'new hire', 'start date', 'first shift', 'NP candidate', 'PA candidate',
  'PMHNP', 'FNP', 'nurse practitioner candidate'
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    if (!SLACK_API_KEY) throw new Error('SLACK_API_KEY is not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { channels, daysBack = 30 } = body;

    // Step 1: Find relevant Slack channels
    let channelIds: string[] = channels || [];
    
    if (channelIds.length === 0) {
      // Search for channels with hiring-related names
      const channelRes = await fetch(`${GATEWAY_URL}/conversations.list?types=public_channel,private_channel&limit=200`, {
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': SLACK_API_KEY,
        },
      });
      const channelData = await channelRes.json();
      
      if (channelData.ok && channelData.channels) {
        const hiringChannels = channelData.channels.filter((ch: any) => {
          const name = (ch.name || '').toLowerCase();
          return name.includes('hiring') || name.includes('recruit') || 
                 name.includes('directshift') || name.includes('candidate') ||
                 name.includes('clinical-support') || name.includes('clinops') ||
                 name.includes('onboard') || name.includes('staffing');
        });
        channelIds = hiringChannels.map((ch: any) => ch.id);
      }
    }

    if (channelIds.length === 0) {
      // Fallback: search all conversations
      channelIds = ['all'];
    }

    // Step 2: Search Slack messages for hiring keywords
    const allMessages: any[] = [];
    const oldest = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);

    for (const keyword of HIRING_KEYWORDS.slice(0, 5)) {
      try {
        const searchRes = await fetch(`${GATEWAY_URL}/search.messages?query=${encodeURIComponent(keyword)}&count=20&sort=timestamp&sort_dir=desc`, {
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': SLACK_API_KEY,
          },
        });
        const searchData = await searchRes.json();
        
        if (searchData.ok && searchData.messages?.matches) {
          for (const match of searchData.messages.matches) {
            const ts = parseFloat(match.ts);
            if (ts >= oldest) {
              allMessages.push({
                text: match.text,
                ts: match.ts,
                channel: match.channel?.name || 'unknown',
                user: match.username || match.user || 'unknown',
                permalink: match.permalink || null,
              });
            }
          }
        }
      } catch (e) {
        console.warn(`Search failed for keyword "${keyword}":`, e);
      }
    }

    // If search API isn't available (bot token), try channel history instead
    if (allMessages.length === 0 && channelIds[0] !== 'all') {
      for (const chId of channelIds.slice(0, 5)) {
        try {
          const histRes = await fetch(`${GATEWAY_URL}/conversations.history?channel=${chId}&oldest=${oldest}&limit=100`, {
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': SLACK_API_KEY,
            },
          });
          const histData = await histRes.json();
          
          if (histData.ok && histData.messages) {
            for (const msg of histData.messages) {
              const text = (msg.text || '').toLowerCase();
              if (HIRING_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) {
                allMessages.push({
                  text: msg.text,
                  ts: msg.ts,
                  channel: chId,
                  user: msg.user || 'unknown',
                  permalink: null,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`History fetch failed for channel ${chId}:`, e);
        }
      }
    }

    // Deduplicate by timestamp
    const uniqueMessages = Array.from(
      new Map(allMessages.map(m => [m.ts, m])).values()
    );

    console.log(`Found ${uniqueMessages.length} hiring-related messages`);

    if (uniqueMessages.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        candidates: [],
        messagesProcessed: 0,
        message: 'No hiring-related messages found in the last ' + daysBack + ' days',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 3: Use AI to extract structured candidate data
    const messageContext = uniqueMessages.slice(0, 50).map(m => 
      `[${new Date(parseFloat(m.ts) * 1000).toISOString().split('T')[0]}] #${m.channel} @${m.user}: ${m.text}`
    ).join('\n');

    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a hiring pipeline data extractor. Analyze Slack messages about healthcare provider recruitment and extract structured candidate information.

Return a JSON array of candidate objects. Each candidate should have:
- candidate_name: string (full name if mentioned, otherwise "Unknown Candidate" with context)
- role: string (e.g., "PMHNP", "FNP", "NP", "PA", etc.)
- covered_states: string[] (US state abbreviations mentioned)
- stage: one of "request_to_ds", "candidates_provided", "interview", "hiring_decision", "onboarding", "started"
- ds_request_date: date string (YYYY-MM-DD) or null
- candidates_provided_date: date string or null
- interview_date: date string or null
- interview_completed: boolean
- hiring_decision: "hired" | "rejected" | "pending" | null
- hiring_decision_date: date string or null
- onboarding_start_date: date string or null
- first_shift_date: date string or null
- notes: brief summary of context
- slack_thread_url: permalink if available

Rules:
- If a candidate appears in multiple messages, merge the info into one entry
- Infer the stage from the latest activity mentioned
- Use dates from messages when explicitly mentioned
- If unsure about a field, use null
- Return ONLY the JSON array, no other text`
          },
          {
            role: 'user',
            content: `Extract hiring pipeline candidates from these Slack messages:\n\n${messageContext}`
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI Gateway call failed [${aiRes.status}]: ${errText}`);
    }

    const aiData = await aiRes.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '[]';
    
    // Parse AI response
    let candidates: any[] = [];
    try {
      const cleaned = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      candidates = JSON.parse(cleaned);
      if (!Array.isArray(candidates)) candidates = [];
    } catch (e) {
      console.error('Failed to parse AI response:', aiContent);
      candidates = [];
    }

    console.log(`AI extracted ${candidates.length} candidates`);

    // Step 4: Upsert candidates into the database
    const upsertedCandidates: any[] = [];
    
    for (const candidate of candidates) {
      const candidateData = {
        candidate_name: candidate.candidate_name || 'Unknown Candidate',
        role: candidate.role || null,
        covered_states: candidate.covered_states || [],
        stage: candidate.stage || 'request_to_ds',
        status: 'active',
        source: 'slack',
        source_context: uniqueMessages.filter(m => {
          const text = (m.text || '').toLowerCase();
          const name = (candidate.candidate_name || '').toLowerCase();
          return name !== 'unknown candidate' && text.includes(name.split(' ')[0]?.toLowerCase());
        }).slice(0, 5),
        ds_request_date: candidate.ds_request_date || null,
        candidates_provided_date: candidate.candidates_provided_date || null,
        interview_date: candidate.interview_date || null,
        interview_completed: candidate.interview_completed || false,
        hiring_decision: candidate.hiring_decision || null,
        hiring_decision_date: candidate.hiring_decision_date || null,
        onboarding_start_date: candidate.onboarding_start_date || null,
        first_shift_date: candidate.first_shift_date || null,
        notes: candidate.notes || null,
        slack_thread_url: candidate.slack_thread_url || null,
      };

      // Try to find existing candidate by name to update
      const { data: existing } = await supabase
        .from('hiring_candidates')
        .select('id')
        .ilike('candidate_name', candidateData.candidate_name)
        .eq('status', 'active')
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from('hiring_candidates')
          .update(candidateData)
          .eq('id', existing.id)
          .select()
          .single();
        if (!error && data) upsertedCandidates.push(data);
      } else {
        const { data, error } = await supabase
          .from('hiring_candidates')
          .insert(candidateData)
          .select()
          .single();
        if (!error && data) upsertedCandidates.push(data);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      candidates: upsertedCandidates,
      messagesProcessed: uniqueMessages.length,
      channelsSearched: channelIds.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('Hiring pipeline sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
