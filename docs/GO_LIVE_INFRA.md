# Go-live infrastructure inventory (BHB)

Pulled from `~/StudioProjects/School-ERP-WhatsApp` for bringing **CBSE Schools** online.
Secrets live in `apps/web/.env.local` (gitignored) — **not** in this file.

**Source of truth for production today:** School-ERP-WhatsApp on Cloud Run.  
**This repo (CBSE Schools):** local dual-mode + Supabase roster/curriculum sync.

---

## Stack map

| Layer | Production value |
|-------|------------------|
| Domain | `https://bhbinternational.school` |
| GCP project | `school-erp-prod-493619` |
| Region | `asia-southeast1` |
| Cloud Run (web) | `school-erp-web` |
| Cloud Run (worker) | `school-erp-worker` |
| Artifact Registry | `asia-southeast1-docker.pkg.dev/$PROJECT_ID/bhb-school-erp-repo/` |
| Backend service | `school-erp-backend` (LB session affinity should be `NONE` / `CLIENT_IP`) |
| Firebase hosting (legacy/alt) | `school-erp-prod-493619.web.app` |
| DNS | Vercel DNS for `bhbinternational.school` |
| Supabase project ref | `ymamhlcrjsuilzdonkzl` |
| Supabase URL | `https://ymamhlcrjsuilzdonkzl.supabase.co` |
| DB pooler | `aws-1-ap-southeast-1.pooler.supabase.com` (6543 txn / 5432 session) |
| Redis | Upstash (`REDIS_URL` in env) |
| WhatsApp | Meta Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID=…96794`) |
| Webhook callback | `https://bhbinternational.school/api/whatsapp/webhook` |
| Privacy URL (Meta Live) | `https://bhbinternational.school/site/privacy` |
| Super-admin emails | `ashishsingh80@gmail.com`, `ashu.dube21@gmail.com`, `director@bhbinternational.school` |
| GCS bucket (docs) | `school-erp-assets` (optional) |

---

## Env keys required for go-online

Already copied into `apps/web/.env.local`:

| Key | Role |
|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Browser + RLS client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin (never `NEXT_PUBLIC_`) |
| `DATABASE_URL` / `DIRECT_URL` | Migrations / pooler |
| `WHATSAPP_TOKEN` / `PHONE_ID` / `VERIFY_TOKEN` | Meta Cloud API |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | `91` |
| `REDIS_URL` / `CRON_SECRET` | Jobs / cron (legacy ERP) |
| `OPENAI_API_KEY` | Optional AI |
| `PROTECTED_SUPER_ADMIN_EMAILS` | Bootstrap admins |

Local flags:

- `NEXT_PUBLIC_DEMO_AUTH=true` — keeps persona login while Supabase keys are present  
- Set `false` when you want real Supabase Auth only  
- Production app URL: `NEXT_PUBLIC_APP_URL=https://bhbinternational.school`

**Track C desk cutover (cross-browser DB):** see [deploy/README.md](../deploy/README.md).  
Templates: `deploy/env.production.example` + `deploy/desk-cutover.env.example`.  
`./scripts/deploy-online.sh` merges desk flags into Cloud Run automatically.

---

## Supabase Auth dashboard (must match domain)

Project → Authentication → URL configuration:

- **Site URL:** `https://bhbinternational.school`
- **Redirect URLs:**  
  `https://bhbinternational.school/**`  
  `https://bhbinternational.school/auth/callback`  
  `https://bhbinternational.school/auth/post-login`

For local CBSE Schools also add:

- `http://localhost:3000/**`
- `http://localhost:3000/auth/callback`

---

## Apply CBSE Schools migrations to this Supabase

This repo uses SQL migrations under `supabase/migrations/` (SIS dual-mode + curriculum).  
School-ERP-WhatsApp historically used **Prisma** against the same project — expect schema overlap; apply carefully.

```bash
# From CBSE Schools root (after `npx supabase link` / CLI login)
npx supabase db push
# or: psql "$DIRECT_URL" -f supabase/migrations/….sql
```

Tables this app expects for remote sync:

- `sis_households`, `sis_students`
- `sis_departments`, `sis_designations`, `sis_staff`
- `student_curriculum`, `curriculum_requests`, `class_curriculum_templates`
- `tenants` row `slug = bhb-international`
- `profiles` for RLS (`auth_user_id`)

---

## WhatsApp (Meta) checklist

Full guide: `~/StudioProjects/School-ERP-WhatsApp/docs/whatsapp-meta-setup.md`

1. Token + Phone number ID in server env (done in `.env.local`)
2. Verify token matches Meta webhook config
3. Callback: `https://bhbinternational.school/api/whatsapp/webhook`
4. Subscribe to `messages`
5. Fee templates outside 24h window need Meta-approved templates (`WHATSAPP_TEMPLATE_*`)
6. **CBSE Schools** does not yet expose that webhook route — fee WhatsApp in this repo is still local/demo until ported

---

## Google Cloud checklist

- Project: `school-erp-prod-493619`
- Region: `asia-southeast1`
- Service: `school-erp-web`
- LB: cookie affinity not `Generated Cookie`
- Env: `NEXT_PUBLIC_APP_URL` must be the custom domain, not `*.run.app`
- Re-auth locally: `gcloud auth login` (CLI tokens were expired when checked)

Useful:

```bash
gcloud config set project school-erp-prod-493619
gcloud run services describe school-erp-web --region=asia-southeast1
gcloud run services logs read school-erp-web --region=asia-southeast1 --limit=50
```

---

## Security — act before public launch

`School-ERP-WhatsApp/cloudbuild.yaml` embeds **live** DB password, service role, WhatsApp token, Redis, OpenAI, and cron secret in plaintext.

1. **Rotate** Supabase DB password, service role (if leaked), WhatsApp permanent token, Redis, OpenAI, `CRON_SECRET`
2. Move secrets to **Secret Manager** / Cloud Run secrets — stop baking into `cloudbuild.yaml`
3. Do not commit `apps/web/.env.local`

---

## Point this app online (Cloud Run)

Replaces `school-erp-web` in project `school-erp-prod-493619` (domain `bhbinternational.school`).

```bash
# 1) Re-auth (once, in your terminal — interactive)
gcloud auth login director@bhbinternational.school --update-adc
gcloud config set project school-erp-prod-493619

# 2) Deploy from CBSE Schools repo root
./scripts/deploy-online.sh
```

Requires `apps/web/.env.local` with Supabase URL + anon key. Demo login stays on (`NEXT_PUBLIC_DEMO_AUTH=true`) so `/login` works without full Supabase Auth UI.

After deploy: https://bhbinternational.school/login

## Database reset (2026-07-12)

**Done:** Dropped all former Prisma / School-ERP-WhatsApp tables in `public` (~534) and reinstalled **only** CBSE Schools migrations (~80 tables).

- Inventory before wipe: `backups/supabase_public_inventory_*.txt` (row estimates only; full `pg_dump` blocked by client/server version mismatch)
- Auth users preserved (`auth` schema untouched)
- Profiles re-linked for director@ and ashishsingh80@
- Smoke sync passed

**Impact:** `bhbinternational.school` / Cloud Run School-ERP-WhatsApp will **not** work against this DB until that app is retired or pointed elsewhere.

## Migration status (applied 2026-07-12)

Full CBSE migration set applied via `psql` `$DIRECT_URL` onto `ymamhlcrjsuilzdonkzl`.

Verify smoke: `cd apps/web && npx tsx scripts/smoke-sis-remote.mts`
