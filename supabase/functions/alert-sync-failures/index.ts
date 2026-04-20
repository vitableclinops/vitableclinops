/**
 * alert-sync-failures edge function
 *
 * Polls `sync_runs` for rows where status IN ('error','partial')
 * and last_alerted_at IS NULL, posts a single grouped Slack message
 * via the Lovable Slack connector gateway, then marks rows alerted.
 *
 * Schedule: every 15 minutes via pg_cron.
 *
 * Required env:
 *   LOVABLE_API_KEY                - injected by Lovable
 *   SLACK_API_KEY                  - injected by Slack connector
 *   SLACK_OPS_ALERTS_CHANNEL_ID    - Slack channel ID (e.g. C0123456789).
 *                                    Falls back to body.channel or #ops-alerts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';

interface FailedRun {
  id: string;
  function_name: string;
  status: 'error' | 'partial';
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  rows_processed: number | null;
  details: Record<string, unknown> | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const slackKey = Deno.env.get('SLACK_API_KEY');

  // Fetch un-alerted failures from the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('sync_runs')
    .select('id, function_name, status, finished_at, duration_ms, error_message, rows_processed, details')
    .in('status', ['error', 'partial'])
    .is('last_alerted_at', null)
    .gte('started_at', since)
    .order('finished_at', { ascending: false })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, alerted: 0, message: 'No new failures' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // If Slack isn't configured, just mark as alerted so they don't re-queue forever
  if (!lovableKey || !slackKey) {
    await supabase.from('sync_runs')
      .update({ last_alerted_at: new Date().toISOString() })
      .in('id', (rows as FailedRun[]).map((r) => r.id));
    return new Response(JSON.stringify({
      ok: true,
      alerted: 0,
      skipped_reason: 'Slack credentials not configured',
      marked: rows.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Determine channel: body override > env var > default
  // Channel: body override > env var > hardcoded default
  let channel = Deno.env.get('SLACK_OPS_ALERTS_CHANNEL_ID') || 'C08A03ET7C3'; // #appointment-availability-update
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.channel) channel = body.channel;
  } catch { /* ignore */ }

  // Build a single grouped message
  const errorRows = (rows as FailedRun[]).filter((r) => r.status === 'error');
  const partialRows = (rows as FailedRun[]).filter((r) => r.status === 'partial');

  const formatRow = (r: FailedRun) => {
    const when = r.finished_at ? new Date(r.finished_at).toISOString().slice(11, 16) + 'Z' : 'unknown';
    const dur = r.duration_ms != null ? ` (${(r.duration_ms / 1000).toFixed(1)}s)` : '';
    const msg = r.error_message ? ` — ${r.error_message.slice(0, 200)}` : '';
    return `• \`${r.function_name}\` @ ${when}${dur}${msg}`;
  };

  const sections: string[] = [];
  if (errorRows.length > 0) {
    sections.push(`*🚨 ${errorRows.length} sync error${errorRows.length > 1 ? 's' : ''}*\n${errorRows.map(formatRow).join('\n')}`);
  }
  if (partialRows.length > 0) {
    sections.push(`*⚠️ ${partialRows.length} partial run${partialRows.length > 1 ? 's' : ''}*\n${partialRows.map(formatRow).join('\n')}`);
  }
  const text = `*Vitable Ops — Sync Health Alert*\n\n${sections.join('\n\n')}`;

  // Post to Slack via connector gateway (auto-join if needed)
  const postToSlack = async (ch: string, txt: string) => {
    const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': slackKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: ch, text: txt, mrkdwn: true }),
    });
    const data = await res.json();
    return { res, data };
  };

  let { res: slackRes, data: slackData } = await postToSlack(channel, text);

  // If not_in_channel, try to join first then retry
  if (slackData?.error === 'not_in_channel') {
    await fetch(`${GATEWAY_URL}/conversations.join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': slackKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel }),
    });
    ({ res: slackRes, data: slackData } = await postToSlack(channel, text));
  }

  if (!slackRes.ok || !slackData.ok) {
    return new Response(JSON.stringify({
      error: `Slack post failed [${slackRes.status}]: ${slackData.error ?? JSON.stringify(slackData)}`,
      attempted_count: rows.length,
    }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Mark alerted only on successful Slack post
  await supabase.from('sync_runs')
    .update({ last_alerted_at: new Date().toISOString() })
    .in('id', (rows as FailedRun[]).map((r) => r.id));

  return new Response(JSON.stringify({
    ok: true,
    alerted: rows.length,
    channel,
    slack_ts: slackData.ts,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
