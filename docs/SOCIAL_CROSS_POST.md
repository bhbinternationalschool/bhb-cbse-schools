# Social cross-post (Facebook, Instagram, Telegram)

Cross-post **news**, **gallery albums**, and **public notices** (audience: everyone or parents) to your school's social channels when you publish in **Communications**.

# Meta OAuth one-click connect (Facebook + Instagram)

1. IT sets **once** on the server (same Meta app as WhatsApp):
   - `META_APP_ID` — App ID from Meta Developers
   - `META_APP_SECRET` — App Secret
2. In Meta Developers → **Facebook Login** → Valid OAuth redirect URIs:
   - `https://bhbinternational.school/api/integrations/social/meta-oauth/callback`
   - `http://localhost:3000/api/integrations/social/meta-oauth/callback` (dev)
3. Staff: **Communications → Social → Connect with Facebook**
4. Sign in → grant Page permissions → ERP saves Page token automatically
5. If you manage multiple Pages, pick one from the list

**API:** `GET /api/integrations/social/meta-oauth/connect`  
**Callback:** `/api/integrations/social/meta-oauth/callback`  
**Pick Page:** `POST /api/integrations/social/meta-oauth/select-page` `{ "pageId": "…" }`

Telegram still uses bot token entry in the same screen (no OAuth).

## Connect in ERP (manual fallback)

**No server env editing required** for school staff:

1. Open **Communications → Social**
2. **Connect social accounts** — enter Meta Page token, Facebook Page ID, Telegram bot token & channel
3. Click **Save & connect** — ERP validates automatically
4. **Send test post** to confirm

Credentials live in Supabase per tenant (`social_integrations_state`). Secrets are never shown in full after save.

**API:** `GET/POST/DELETE /api/integrations/social/credentials`

Server env vars remain a **fallback** when ERP fields are empty.

## Where to use it

1. **ERP → Communications** (`/comms`)
2. On **Notices**, **News**, or **Gallery** forms — check **Also cross-post to social**
3. Or open the **Social** tab for defaults and recent post history
4. **Post to social** on already-published items forces a re-post

## Platforms

| Platform | API | Notes |
|----------|-----|--------|
| Facebook Page | Meta Graph | Text + image or link post |
| Instagram Business | Meta Graph | Requires image (cover photo or `SOCIAL_DEFAULT_IMAGE_URL`) |
| Telegram channel | Bot API | Text or photo; bot must be channel admin |

## Environment variables

Add to `apps/web/.env.local` (production: Cloud Run env):

```bash
SOCIAL_CROSS_POST_ENABLED=true

# Meta — can reuse WhatsApp token if same Meta app has Page permissions
SOCIAL_META_ACCESS_TOKEN=        # or WHATSAPP_TOKEN / WA_META_ACCESS_TOKEN
SOCIAL_FACEBOOK_PAGE_ID=         # numeric Page id
SOCIAL_INSTAGRAM_BUSINESS_ID=    # optional — auto-discovered from Page if linked

# Fallback image for Instagram when no cover (public HTTPS URL)
SOCIAL_DEFAULT_IMAGE_URL=https://bhbinternational.school/logo.png

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=@your_channel   # or -100… chat id
TELEGRAM_CHANNEL_USERNAME=your_channel

# Optional API guard for scripts/cron
SOCIAL_CROSS_POST_SECRET=
```

## Meta setup (Facebook + Instagram)

1. Use the same Meta app as WhatsApp (or create a new app).
2. Add permissions: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`.
3. Generate a **Page access token** (long-lived) for your school Facebook Page.
4. Link **Instagram Business** account to the Page in Meta Business Suite.
5. Set `SOCIAL_FACEBOOK_PAGE_ID` — find in Page Settings → About, or Graph API Explorer.
6. Image URLs must be **public HTTPS** (Supabase `school-files` bucket URLs work).

## Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather) → copy token → `TELEGRAM_BOT_TOKEN`.
2. Create a public channel (e.g. `@BHBInternational`).
3. Add the bot as **administrator** on the channel (post messages permission).
4. Set `TELEGRAM_CHANNEL_ID=@BHBInternational` (or numeric `-100…` id).

## API

### Config (no secrets)

```
GET /api/integrations/social/config
```

### Cross-post

```
POST /api/integrations/social/cross-post
Content-Type: application/json

{
  "kind": "news",
  "contentId": "news_abc123",
  "title": "Annual Day 2026",
  "body": "Full story text…",
  "summary": "Short line",
  "imageUrl": "https://…/cover.jpg",
  "platforms": ["facebook", "instagram", "telegram"],
  "force": false
}
```

Staff session cookie required, or header `x-social-cross-post-secret` when `SOCIAL_CROSS_POST_SECRET` is set.

### History

```
GET /api/integrations/social/cross-post?limit=30
```

## Idempotency

Each `(content kind, content id, platform)` is logged in `school_comms_cross_posts`. Re-publishing skips platforms already posted unless you use **Post to social** (force) or `force: true` in the API.

## Scheduled publishing

1. On **Notices**, **News**, or **Gallery**, set **Publish at** and click **Schedule**.
2. Status becomes `scheduled` until the due time.
3. Server cron publishes and cross-posts:

```bash
# Every 5 minutes (Cloud Scheduler)
curl -X POST https://bhbinternational.school/api/comms/scheduled-publish/tick \
  -H "x-cron-secret: $CRON_SECRET"
```

Set `CRON_SECRET` in production env. Scheduled items appear under **Communications → Social → Scheduled queue**.

## Meta Page setup wizard

Open **Communications → Social** for:
- Token / Page / Instagram checklist
- Env variable status
- **Send test post** button
- API: `GET/POST /api/integrations/social/meta-setup`

## Ops health

```
GET /api/integrations/health
```

Look for `socialCrossPost`, `socialFacebook`, `socialInstagram`, `socialTelegram`.

## RBAC

Uses existing comms permissions (`news`, `gallery`, `notices` create/edit). Only staff sessions can call the cross-post API.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Instagram skipped / failed | Add cover image or `SOCIAL_DEFAULT_IMAGE_URL` |
| Facebook permission error | Regenerate Page token with `pages_manage_posts` |
| Telegram forbidden | Bot not admin on channel |
| Image URL rejected | Must be public HTTPS; test URL in browser |
| Duplicate posts | Expected on force re-post; normal publish is idempotent |
