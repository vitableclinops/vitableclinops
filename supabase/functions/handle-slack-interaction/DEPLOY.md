# Slack Interactivity — Deploy & Setup Guide

This function lets the daily ops Slack thread show **DM provider** buttons and a checkbox modal so admins can ping coverage candidates with one click. Outbound posting still uses the existing Lovable Slack connector — only the *inbound* webhook needs a parallel custom Slack app.

---

## 1. Database

Migration `20260422_coverage_ping_log.sql` was applied automatically by Lovable. It adds:
- `profiles.slack_user_id` (text, nullable, indexed)
- `coverage_ping_log` table with RLS (admins + pod leads can read, service role inserts)

## 2. Edge functions (auto-deployed)

| Function | URL | Auth |
|---|---|---|
| `handle-slack-interaction` | `https://saksjvmqyudkowxypoce.supabase.co/functions/v1/handle-slack-interaction` | public (Slack signature verified in code) |
| `backfill-slack-user-ids` | `https://saksjvmqyudkowxypoce.supabase.co/functions/v1/backfill-slack-user-ids` | public |
| `send-ops-dashboard-slack` | (existing) | public |

## 3. Create the parallel custom Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. Pick the same workspace as the connector
3. Paste this manifest (replace nothing — URL is already correct):

```yaml
display_information:
  name: Vitable Coverage DM Bot
  description: Sends coverage outreach DMs from the ops dashboard thread
  background_color: "#1a4d4d"
features:
  bot_user:
    display_name: Vitable Coverage Bot
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:write
      - users:read
      - users:read.email
settings:
  interactivity:
    is_enabled: true
    request_url: https://saksjvmqyudkowxypoce.supabase.co/functions/v1/handle-slack-interaction
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. Click **Create**
5. **Install to Workspace** (top of the app's settings page) → authorize
6. Copy two values:
   - **Bot User OAuth Token** (starts with `xoxb-…`) — *OAuth & Permissions* page
   - **Signing Secret** — *Basic Information* → *App Credentials*

## 4. Add secrets to Lovable

Lovable will prompt for these via the secure form:
- `SLACK_INBOUND_BOT_TOKEN` = the `xoxb-…` token
- `SLACK_SIGNING_SECRET` = the signing secret

## 5. Backfill provider Slack IDs

Hit the backfill function (dry run first):

```bash
curl -X POST 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/backfill-slack-user-ids' \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true}'
```

Review the matched/not_found counts in the response. Then run for real:

```bash
curl -X POST 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/backfill-slack-user-ids' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Re-runs are safe — only profiles missing a `slack_user_id` are scanned.

## 6. Smoke test

1. Manually trigger the daily post:
   ```bash
   curl -X POST 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/send-ops-dashboard-slack' \
     -H 'Content-Type: application/json' -d '{}'
   ```
2. In `#appointment-availability-update`, scroll to **reply #2** in the thread
3. Click `📨 DM N providers` on a state
4. Modal opens → uncheck anyone you want to skip → adjust message → **Send DMs**
5. Verify:
   - The selected providers receive the DM from "Vitable Coverage Bot"
   - A confirmation `✅ <@you> sent DMs for <STATE> to: …` posts back to the thread
   - A row appears in `coverage_ping_log` per recipient

## Common errors

| Symptom | Fix |
|---|---|
| `Invalid signature` (401) | `SLACK_SIGNING_SECRET` is wrong or missing |
| `views.open` fails with `not_authed` | `SLACK_INBOUND_BOT_TOKEN` is wrong or app not installed |
| Some recipients get "no_slack_user_id" in the log | Their email doesn't match a Slack account — re-run backfill or check email |
| Button appears but click does nothing | Interactivity Request URL not saved or app not installed in workspace |
