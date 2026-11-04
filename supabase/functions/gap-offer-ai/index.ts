import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: 'Not signed in' }, 401);

    const { text, month, days, providerShifts } = await req.json();
    if (!text || typeof text !== 'string' || text.length > 8000) return json({ error: 'Paste a request (up to 8000 characters).' }, 400);
    if (!Array.isArray(days)) return json({ error: 'No gap data for this month.' }, 400);

    const key = Deno.env.get('LOVABLE_API_KEY');
    if (!key) return json({ error: 'AI is not configured' }, 500);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const instructions = `You are a scheduling advisor for Vitable Health's telemedicine clinical operations team. Today is ${today}. All operations run on Eastern Time: write every time in Eastern Time only (label it ET) and never show Central or any other zone. The scheduler pastes a provider's request (often an availability change with several options) plus their own notes. Advise where the provider's hours should go for ${month.slice(0, 7)} to best cover network needs.

Whole-network day data for the month (dow 0=Sun; scheduled & expected are provider hours; gap = expected - scheduled, positive = short, negative = overstaffed):
${JSON.stringify(days)}

Currently scheduled Homebase shifts for providers whose names appear in the request (times are ISO UTC; convert to Eastern Time when you mention them):
${JSON.stringify(providerShifts ?? [])}

How to answer (markdown, concise, practical):
1. **Recommendation** — 2-4 sentences: which of the provider's offered windows to schedule, and which to skip, so she keeps her hours while landing on short days. Only past-today dates are actionable.
2. **Suggested schedule (ET)** — a plain markdown table with columns Date | Time (ET) | Hours, one row per remaining date in the month that has shifts, then a Total line. This section is copied and sent to the provider as-is, so keep it clean with no commentary. Keep total hours close to what she currently has unless the network clearly needs more or fewer.
3. **Why** — tie choices to specific gap numbers (e.g. "Mon Nov 23 is 18h short").
4. **Next steps** — what the scheduler should do (e.g. update Homebase shifts, confirm with provider, which current shifts to remove).
5. **Questions / caveats** — ambiguities in the request (e.g. "7-9" likely means 7-9pm), and that data is whole-network by day, not per state or hour.
Do not invent data. If the provider has no shifts found, say so.`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-6-astra',
        reasoning: { effort: 'medium' },
        instructions,
        input: text,
      }),
    });
    if (res.status === 429) return json({ error: 'AI is busy, try again in a moment.' }, 429);
    if (res.status === 402) return json({ error: 'AI credits are used up for this workspace.' }, 402);
    if (!res.ok) return json({ error: `AI error ${res.status}: ${(await res.text()).slice(0, 300)}` }, 500);
    const out = await res.json();
    const raw = out.output_text ??
      out.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text;
    if (!raw) return json({ error: 'AI returned no answer' }, 500);
    return json({ advice: raw });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
