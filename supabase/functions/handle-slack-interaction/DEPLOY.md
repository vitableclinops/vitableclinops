# Coverage Ping — Deployment Steps

End-to-end: a "DM providers" button on the daily Ops Coverage digest sends the
templated Jotform outreach to the suggested providers for a state, logs the
send, and updates the original message so the button can't be clicked twice.

## 1. Apply the migration

```sh
cd ~/Desktop/Scheduling/vitableclinops-main
supabase db push
```

This adds `profiles.slack_user_id` and creates `coverage_ping_log`.

## 2. Deploy the edge functions

```sh
supabase functions deploy handle-slack-interaction
supabase functions deploy backfill-slack-user-ids
supabase functions deploy send-ops-dashboard-slack   # has the new buttons
```

## 3. Slack app: enable Interactivity

In the Slack app powering the Lovable Slack connection
(api.slack.com/apps → your app):

1. **Interactivity & Shortcuts** → turn on.
   - Request URL:
     `https://saksjvmqyudkowxypoce.supabase.co/functions/v1/handle-slack-interaction`
2. **OAuth & Permissions** → ensure these bot scopes exist. Reinstall if you add any:
   - `chat:write`
   - `im:write`
   - `users:read`
   - `users:read.email`
3. **Basic Information → App Credentials → Signing Secret** → copy.
4. Add it as a Supabase secret:
   ```sh
   supabase secrets set SLACK_SIGNING_SECRET=xxxxxxxxxxxx
   ```

> If the Slack app is fully managed by Lovable and the Signing Secret isn't
> exposable, you'll need to create a direct Slack app alongside it. The
> outbound (posting) path can keep using the gateway; only the inbound
> interactivity webhook needs the signing secret.

## 4. Backfill provider Slack IDs

```sh
# Dry run first — shows which profiles match / miss.
curl -X POST "https://saksjvmqyudkowxypoce.supabase.co/functions/v1/backfill-slack-user-ids" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'

# For real:
curl -X POST "https://saksjvmqyudkowxypoce.supabase.co/functions/v1/backfill-slack-user-ids" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

Re-run anytime a new provider is onboarded (or wire it into the onboarding
completion flow).

## 5. Smoke test

1. Manually run the digest:
   ```sh
   curl -X POST "https://saksjvmqyudkowxypoce.supabase.co/functions/v1/send-ops-dashboard-slack" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
   ```
2. In `#appointment-availability-update`, open the thread → find reply #2
   ("Gaps still open after reallocation"). Each state should now show a blue
   **📨 DM N providers** button.
3. Click one → confirm dialog appears → click **Send** → the actions block
   swaps to `✅ DM sent to N providers by @you`. The providers receive a DM
   matching the template.
4. Verify the log:
   ```sql
   SELECT sent_at, sent_by_name, state_abbreviation, target_date,
          array_length(provider_profile_ids, 1) AS n_sent,
          array_length(skipped_provider_profile_ids, 1) AS n_skipped
   FROM coverage_ping_log
   ORDER BY sent_at DESC
   LIMIT 10;
   ```

## What gets sent

```
Hi there,

We're reaching out because you indicated interest in being considered for
additional availability. We're specifically looking for more coverage on
*Wednesday, April 22, 2026*.

If you're able to provide extra hours, please resubmit the Jotform here as
soon as possible.   ← linked to https://form.jotform.com/252224341308043

Thank you for your continued flexibility and support.

Warmly,
Vitable Provider Team
providersupport@vitablehealth.com
```

The date pulled in is the same date the recommendation engine used (today in
Chicago, or the override date passed to `send-ops-dashboard-slack`).

## Safety notes

- **Confirm dialog**: Slack shows a native confirm dialog before the DM fires,
  even in "fire-and-forget" mode — one accidental click won't spam anyone.
- **Providers without Slack IDs** are skipped with a warning in the receipt;
  the ones with IDs still go through. Re-run the backfill to fill gaps.
- **Replay protection**: signed request timestamps older than 5 minutes are
  rejected, so old webhooks can't be replayed.
- **Audit trail**: every click is one row in `coverage_ping_log` with who
  sent, when, to whom, and the exact text — use it for disputes or metrics.
