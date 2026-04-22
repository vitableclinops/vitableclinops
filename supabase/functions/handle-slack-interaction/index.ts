// Slack Interactivity webhook: handles the "DM providers" button from the
// daily Ops Coverage digest. Sends a templated DM to each candidate provider
// about a specific state's coverage gap, logs the send, and updates the
// original message with a "Sent by @user" footer.
//
// Slack Request URL: https://<project>.supabase.co/functions/v1/handle-slack-interaction
//
// Required env vars / secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            — standard
//   LOVABLE_API_KEY, SLACK_API_KEY                     — existing gateway creds
//   SLACK_SIGNING_SECRET                               — from Slack app "Basic Information"
//
// Notes:
//   - verify_jwt must be false for this function (Slack hits it unauthenticated).
//   - Slack requires a 200 response within 3 seconds. We ACK immediately and
//     do the DM work inline; all work fits comfortably in that window for ≤5
//     providers per click. If it ever slows down, move the send loop into
//     EdgeRuntime.waitUntil().

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const JOTFORM_URL = 'https://form.jotform.com/252224341308043';

function buildMessage(dateLabel: string): string {
  return [
    'Hi there,',
    '',
    'We’re reaching out because you indicated interest in being considered for additional availability. ' +
      `We’re specifically looking for more coverage on *${dateLabel}*.`,
    '',
    `If you’re able to provide extra hours, please resubmit the Jotform <${JOTFORM_URL}|here> as soon as possible.`,
    '',
    'Thank you for your continued flexibility and support.',
    '',
    'Warmly,',
    'Vitable Provider Team',
    'providersupport@vitablehealth.com',
  ].join('\n');
}

function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Constant-time string comparison.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySlackSignature(req: Request, rawBody: string, signingSecret: string): Promise<boolean> {
  const ts = req.headers.get('x-slack-request-timestamp');
  const sig = req.headers.get('x-slack-signature');
  if (!ts || !sig) return false;

  // Reject replays older than 5 minutes.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 60 * 5) return false;

  const base = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  const hex = Array.from(new Uint8Array(macBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const expected = `v0=${hex}`;
  return timingSafeEqual(expected, sig);
}

async function slackApi(path: string, body: Record<string, unknown>, apiKey: string, connKey: string) {
  const res = await fetch(`${GATEWAY_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Connection-Api-Key': connKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok && data?.ok === true, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!signingSecret || !LOVABLE_API_KEY || !SLACK_API_KEY) {
    console.error('Missing required secrets');
    return new Response('Server misconfigured', { status: 500, headers: corsHeaders });
  }

  const rawBody = await req.text();
  const verified = await verifySlackSignature(req, rawBody, signingSecret);
  if (!verified) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  // Slack sends interactions as application/x-www-form-urlencoded with a single
  // `payload` field whose value is JSON.
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');
  if (!payloadStr) return new Response('Missing payload', { status: 400, headers: corsHeaders });

  let payload: any;
  try { payload = JSON.parse(payloadStr); } catch {
    return new Response('Bad payload', { status: 400, headers: corsHeaders });
  }

  if (payload.type !== 'block_actions') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  const action = (payload.actions ?? [])[0];
  if (!action || action.action_id !== 'send_coverage_ping') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  let parsed: { v: number; s: string; d: string; ids: string[] };
  try {
    parsed = JSON.parse(action.value);
  } catch {
    return new Response('Bad action value', { status: 400, headers: corsHeaders });
  }
  const { s: stateAbbr, d: targetDate, ids: profileIds } = parsed;
  if (!stateAbbr || !targetDate || !Array.isArray(profileIds) || profileIds.length === 0) {
    return new Response('Bad action value', { status: 400, headers: corsHeaders });
  }

  const sentBySlackUserId = payload.user?.id ?? 'unknown';
  const sentByName = payload.user?.name ?? payload.user?.username ?? null;
  const channelId = payload.channel?.id ?? null;
  const sourceMessageTs = payload.message?.ts ?? null;
  const originalBlocks: any[] = payload.message?.blocks ?? [];
  const responseUrl: string | null = payload.response_url ?? null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up slack_user_ids for the target providers.
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, slack_user_id')
    .in('id', profileIds);

  if (profErr) {
    console.error('profiles lookup failed:', profErr);
    return new Response('Lookup failed', { status: 500, headers: corsHeaders });
  }

  const withSlack = (profiles ?? []).filter((p) => !!p.slack_user_id);
  const withoutSlack = (profiles ?? []).filter((p) => !p.slack_user_id);

  const dateLabel = formatDateLabel(targetDate);
  const messageText = buildMessage(dateLabel);

  // Send one DM per provider. We open a DM conversation first, then post.
  const results: Array<{ profile_id: string; slack_user_id: string; ok: boolean; error?: string }> = [];
  for (const p of withSlack) {
    try {
      const { ok: openOk, data: openData } = await slackApi(
        'conversations.open',
        { users: p.slack_user_id },
        LOVABLE_API_KEY,
        SLACK_API_KEY,
      );
      if (!openOk) {
        results.push({ profile_id: p.id, slack_user_id: p.slack_user_id!, ok: false, error: `open: ${openData?.error}` });
        continue;
      }
      const dmChannel = openData.channel?.id;
      if (!dmChannel) {
        results.push({ profile_id: p.id, slack_user_id: p.slack_user_id!, ok: false, error: 'no dm channel' });
        continue;
      }
      const { ok: postOk, data: postData } = await slackApi(
        'chat.postMessage',
        { channel: dmChannel, text: messageText, unfurl_links: false },
        LOVABLE_API_KEY,
        SLACK_API_KEY,
      );
      results.push({
        profile_id: p.id,
        slack_user_id: p.slack_user_id!,
        ok: postOk,
        error: postOk ? undefined : `post: ${postData?.error}`,
      });
    } catch (e) {
      results.push({
        profile_id: p.id,
        slack_user_id: p.slack_user_id!,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);

  // Log the send (one row per click, captures all recipients).
  await supabase.from('coverage_ping_log').insert({
    sent_by_slack_user_id: sentBySlackUserId,
    sent_by_name: sentByName,
    state_abbreviation: stateAbbr,
    target_date: targetDate,
    provider_profile_ids: successes.map((r) => r.profile_id),
    provider_slack_user_ids: successes.map((r) => r.slack_user_id),
    skipped_provider_profile_ids: withoutSlack.map((p) => p.id),
    channel: 'slack_dm',
    message_text: messageText,
    source_channel_id: channelId,
    source_message_ts: sourceMessageTs,
    success: failures.length === 0 && withoutSlack.length === 0,
    error_details: failures.length || withoutSlack.length
      ? {
          failures,
          missing_slack_id: withoutSlack.map((p) => ({ profile_id: p.id, name: p.full_name, email: p.email })),
        }
      : null,
  });

  // Update the original message: swap the clicked state's actions block for a
  // confirmation footer so the button can't be clicked again.
  const receiptLines: string[] = [];
  if (successes.length > 0) {
    receiptLines.push(`✅ DM sent to *${successes.length}* provider${successes.length === 1 ? '' : 's'} by <@${sentBySlackUserId}>`);
  }
  if (withoutSlack.length > 0) {
    const names = withoutSlack.map((p) => p.full_name ?? p.email ?? 'unknown').join(', ');
    receiptLines.push(`⚠️ Skipped (no Slack ID): ${names}`);
  }
  if (failures.length > 0) {
    receiptLines.push(`❌ Failed for ${failures.length} provider${failures.length === 1 ? '' : 's'} — see logs`);
  }

  const newBlocks = originalBlocks.map((b) => {
    if (b.type === 'actions' && b.block_id === `cov_ping:${stateAbbr}`) {
      return {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: receiptLines.join('  ·  ') }],
      };
    }
    return b;
  });

  if (responseUrl) {
    // response_url lets us update the message without needing the channel/ts.
    try {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          blocks: newBlocks,
          text: 'Providers to contact directly',
        }),
      });
    } catch (e) {
      console.warn('response_url update failed:', e);
    }
  }

  return new Response('', { status: 200, headers: corsHeaders });
});
