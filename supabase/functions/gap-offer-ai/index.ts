import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'offers', 'total_hours_closed', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    total_hours_closed: { type: 'number' },
    suggestions: { type: 'string' },
    offers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'start', 'end', 'hours', 'day_gap', 'hours_closed', 'verdict', 'note'],
        properties: {
          date: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          hours: { type: 'number' },
          day_gap: { type: ['number', 'null'] },
          hours_closed: { type: 'number' },
          verdict: { type: 'string', enum: ['Fills a gap', 'Marginal', 'Not needed', 'Outside month', 'Unclear'] },
          note: { type: 'string' },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: 'Not signed in' }, 401);

    const { text, month, days } = await req.json();
    if (!text || typeof text !== 'string' || text.length > 8000) return json({ error: 'Paste an offer (up to 8000 characters).' }, 400);
    if (!Array.isArray(days)) return json({ error: 'No gap data for this month.' }, 400);

    const key = Deno.env.get('LOVABLE_API_KEY');
    if (!key) return json({ error: 'AI is not configured' }, 500);

    const instructions = `You evaluate a provider's offered telemedicine shifts against whole-network schedule gaps for month ${month}.
Day data (JSON, date, weekday 0=Sun, scheduled hours, expected hours, gap = expected - scheduled; positive gap means short):
${JSON.stringify(days)}
Rules: parse every offered shift from the pasted text (dates, times, recurring patterns like "every Tuesday 9-1" expand within the month; assume Central time). hours = shift length. hours_closed = min(hours, max(0, day_gap)). Verdict: "Fills a gap" if day_gap >= hours*0.5 and gap>0, "Marginal" if 0 < day_gap < hours*0.5, "Not needed" if day_gap <= 0, "Outside month" if date not in data, "Unclear" if it can't be parsed. Use 24h HH:MM times. Summary: 1-3 plain sentences. Suggestions: brief advice on which other days in the month have the biggest gaps the provider could take instead, or empty string.`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-6-astra',
        reasoning: { effort: 'low' },
        instructions,
        input: text,
        text: { format: { type: 'json_schema', name: 'offer_eval', strict: true, schema } },
      }),
    });
    if (res.status === 429) return json({ error: 'AI is busy, try again in a moment.' }, 429);
    if (res.status === 402) return json({ error: 'AI credits are used up for this workspace.' }, 402);
    if (!res.ok) return json({ error: `AI error ${res.status}: ${(await res.text()).slice(0, 300)}` }, 500);
    const out = await res.json();
    const raw = out.output_text ??
      out.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text;
    if (!raw) return json({ error: 'AI returned no answer' }, 500);
    return json(JSON.parse(raw));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
