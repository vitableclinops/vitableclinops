// Slack Interactivity webhook — handles button clicks and modal submissions
// from the daily ops dashboard thread. Uses a SEPARATE custom Slack app
// (with its own bot token + signing secret) for inbound, while outbound
// posts continue to use the Lovable Slack connector.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp',
};

const SLACK_API = 'https://slack.com/api';

// ---- Slack signature verification ----
async function verifySlackSignature(req: Request, rawBody: string, signingSecret: string): Promise<boolean> {
  const timestamp = req.headers.get('x-slack-request-timestamp');
  const signature = req.headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;

  // Reject replay attacks > 5 minutes old
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (Number.isNaN(age) || age > 60 * 5) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(baseString));
  const computed = 'v0=' + Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time-ish compare
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

async function slackCall(method: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) console.error(`Slack ${method} failed:`, data);
  return data;
}

function buildDmModal(payload: { state: string; gap_hours: number; source_ts: string; candidates: any[] }) {
  const defaultMessage =
    `Hey — we're short ~${payload.gap_hours}h of coverage in ${payload.state} today. ` +
    `Could you pick up a few extra slots? Thanks! 🙏`;

  const checkboxOptions = payload.candidates.map((c, idx) => ({
    text: { type: 'plain_text', text: c.name + (c.context ? ` — ${c.context}` : '') },
    value: String(idx),
  }));

  return {
    type: 'modal',
    callback_id: 'send_coverage_dms',
    private_metadata: JSON.stringify(payload),
    title: { type: 'plain_text', text: `DM coverage — ${payload.state}` },
    submit: { type: 'plain_text', text: 'Send DMs' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${payload.state}* needs *${payload.gap_hours}h* of coverage. Select providers to message:`,
        },
      },
      {
        type: 'input',
        block_id: 'recipients',
        label: { type: 'plain_text', text: 'Recipients' },
        element: {
          type: 'checkboxes',
          action_id: 'recipients_checkboxes',
          initial_options: checkboxOptions,
          options: checkboxOptions,
        },
      },
      {
        type: 'input',
        block_id: 'message',
        label: { type: 'plain_text', text: 'Message' },
        element: {
          type: 'plain_text_input',
          action_id: 'message_text',
          multiline: true,
          initial_value: defaultMessage,
          max_length: 1500,
        },
      },
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET');
    const INBOUND_TOKEN = Deno.env.get('SLACK_INBOUND_BOT_TOKEN');
    if (!SIGNING_SECRET) throw new Error('SLACK_SIGNING_SECRET is not configured');
    if (!INBOUND_TOKEN) throw new Error('SLACK_INBOUND_BOT_TOKEN is not configured');

    const rawBody = await req.text();
    const verified = await verifySlackSignature(req, rawBody, SIGNING_SECRET);
    if (!verified) {
      return new Response('Invalid signature', { status: 401 });
    }

    // Slack interactivity payloads come as application/x-www-form-urlencoded
    // with a single "payload" field containing JSON
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');
    if (!payloadStr) {
      return new Response('Missing payload', { status: 400 });
    }
    const payload = JSON.parse(payloadStr);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ===== BUTTON CLICK → open modal =====
    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0];
      if (action?.action_id === 'open_coverage_dm_modal') {
        let buttonPayload: any;
        try { buttonPayload = JSON.parse(action.value); }
        catch { return new Response(JSON.stringify({ error: 'bad payload' }), { status: 400 }); }

        const triggerId = payload.trigger_id;
        const view = buildDmModal(buttonPayload);
        await slackCall('views.open', INBOUND_TOKEN, { trigger_id: triggerId, view });
        return new Response('', { status: 200 });
      }
      return new Response('', { status: 200 });
    }

    // ===== MODAL SUBMIT → send DMs =====
    if (payload.type === 'view_submission' && payload.view?.callback_id === 'send_coverage_dms') {
      const meta = JSON.parse(payload.view.private_metadata) as {
        state: string;
        gap_hours: number;
        source_ts: string;
        candidates: { profile_id: string | null; name: string; context: string }[];
      };
      const state = payload.view.state.values;
      const selectedIdxs: string[] = (state.recipients?.recipients_checkboxes?.selected_options ?? [])
        .map((o: any) => o.value);
      const messageText: string = state.message?.message_text?.value ?? '';

      const senderSlackId: string = payload.user?.id ?? '';
      const senderName: string = payload.user?.username ?? payload.user?.name ?? '';

      // Resolve each selected candidate → slack_user_id (lookup if missing)
      const sendResults: Array<{ name: string; ok: boolean; error?: string; channel?: string; ts?: string; slack_user_id?: string; profile_id?: string | null }> = [];
      for (const idx of selectedIdxs) {
        const cand = meta.candidates[Number(idx)];
        if (!cand) continue;

        // Look up slack_user_id from profiles
        let slackUserId: string | null = null;
        let recipientEmail: string | null = null;
        if (cand.profile_id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('slack_user_id, email')
            .eq('id', cand.profile_id)
            .maybeSingle();
          slackUserId = prof?.slack_user_id ?? null;
          recipientEmail = prof?.email ?? null;
        }

        // Fallback: lookup by email via Slack API
        if (!slackUserId && recipientEmail) {
          const lookup = await fetch(`${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(recipientEmail)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${INBOUND_TOKEN}` },
          });
          const lookupData = await lookup.json();
          if (lookupData.ok && lookupData.user?.id) {
            slackUserId = lookupData.user.id;
            // Cache for next time
            if (cand.profile_id) {
              await supabase.from('profiles').update({ slack_user_id: slackUserId }).eq('id', cand.profile_id);
            }
          }
        }

        if (!slackUserId) {
          sendResults.push({ name: cand.name, ok: false, error: 'no_slack_user_id', profile_id: cand.profile_id });
          await supabase.from('coverage_ping_log').insert({
            state_abbreviation: meta.state,
            gap_hours: meta.gap_hours,
            recipient_profile_id: cand.profile_id,
            recipient_slack_user_id: 'unknown',
            recipient_name: cand.name,
            message_preview: messageText,
            delivery_status: 'failed',
            error_message: 'No Slack user ID found for provider',
            sent_by_slack_user_id: senderSlackId,
            sent_by_name: senderName,
            source_message_ts: meta.source_ts,
          });
          continue;
        }

        // Open IM channel
        const open = await slackCall('conversations.open', INBOUND_TOKEN, { users: slackUserId });
        const channelId = open?.channel?.id;
        if (!channelId) {
          sendResults.push({ name: cand.name, ok: false, error: 'open_im_failed', slack_user_id: slackUserId, profile_id: cand.profile_id });
          continue;
        }

        // Post message
        const post = await slackCall('chat.postMessage', INBOUND_TOKEN, {
          channel: channelId,
          text: messageText,
        });

        const ok = !!post.ok;
        sendResults.push({
          name: cand.name,
          ok,
          error: ok ? undefined : (post.error ?? 'post_failed'),
          channel: channelId,
          ts: post.ts,
          slack_user_id: slackUserId,
          profile_id: cand.profile_id,
        });

        await supabase.from('coverage_ping_log').insert({
          state_abbreviation: meta.state,
          gap_hours: meta.gap_hours,
          recipient_profile_id: cand.profile_id,
          recipient_slack_user_id: slackUserId,
          recipient_name: cand.name,
          message_preview: messageText,
          slack_dm_channel_id: channelId,
          slack_dm_message_ts: post.ts ?? null,
          delivery_status: ok ? 'sent' : 'failed',
          error_message: ok ? null : (post.error ?? 'unknown'),
          sent_by_slack_user_id: senderSlackId,
          sent_by_name: senderName,
          source_message_ts: meta.source_ts,
        });
      }

      // Post threaded confirmation back to the ops channel thread
      const sentNames = sendResults.filter(r => r.ok).map(r => r.name);
      const failedNames = sendResults.filter(r => !r.ok).map(r => `${r.name} (${r.error})`);
      const confirmLines: string[] = [];
      if (sentNames.length > 0) {
        confirmLines.push(`✅ <@${senderSlackId}> sent DMs for *${meta.state}* to: ${sentNames.join(', ')}`);
      }
      if (failedNames.length > 0) {
        confirmLines.push(`⚠️ Failed: ${failedNames.join(', ')}`);
      }
      if (confirmLines.length > 0) {
        // Use the connector token to post in the channel (consistent voice)
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
        if (LOVABLE_API_KEY && SLACK_API_KEY) {
          await fetch('https://connector-gateway.lovable.dev/slack/api/chat.postMessage', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': SLACK_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              channel: 'C08A03ET7C3',
              thread_ts: meta.source_ts,
              text: confirmLines.join('\n'),
              username: 'Ops Coverage Bot 📊',
              icon_emoji: ':bar_chart:',
              unfurl_links: false,
            }),
          });
        }
      }

      // Empty 200 closes the modal
      return new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Unhandled type — ack to prevent retries
    return new Response('', { status: 200 });
  } catch (error) {
    console.error('handle-slack-interaction error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
