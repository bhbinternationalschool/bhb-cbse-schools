# Pre-deploy checklist — BHB CBSE Schools ERP

Use this **before the first production deploy** to `https://bhbinternational.school`.
Target: **1–3 days** of blocker fixes, then deploy. Minor UI polish can wait.

**Deploy command (after checklist passes):**

```bash
gcloud auth login director@bhbinternational.school --update-adc
gcloud config set project school-erp-prod-493619
./scripts/deploy-online.sh
```

---

## How to use

| Symbol | Meaning |
|--------|---------|
| ☐ | Not done |
| ✅ | Pass |
| ⏭ | OK to fix after go-live |

Each item has **Pass criteria** and **How to verify**.

---

## 1. Environment & secrets

**Pass criteria**

- [ ] `apps/web/.env.local` exists (copy from `.env.example`)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set (server only — never in git)
- [ ] `NEXT_PUBLIC_APP_URL=https://bhbinternational.school` for production deploy
- [ ] No secrets committed in git (`git status` — no `.env.local`)

**How to verify**

```bash
test -f apps/web/.env.local && echo "env file OK"
grep -E '^NEXT_PUBLIC_SUPABASE_URL=.' apps/web/.env.local
grep -E '^NEXT_PUBLIC_APP_URL=' apps/web/.env.local
```

**Notes:** `scripts/deploy-online.sh` reads Supabase URL + anon key from `.env.local` and passes them into Cloud Build.

---

## 2. Supabase migrations applied

**Pass criteria**

- [ ] All migrations under `supabase/migrations/` applied to project `ymamhlcrjsuilzdonkzl`
- [ ] Tenant row exists: `slug = bhb-international`
- [ ] Blob tables exist for cloud sync: `fees_state`, `payments_state`, etc.

**How to verify**

```bash
cd apps/web && npx tsx scripts/smoke-sis-remote.mts
```

See also: [GO_LIVE_INFRA.md](./GO_LIVE_INFRA.md) — Supabase Auth URLs + migration list.

---

## 3. Authentication decision (demo vs real)

**Pass criteria**

Choose one path and document it:

| Mode | When | Setting |
|------|------|---------|
| **Soft launch** | Staff testing first; principal login without passwords | `NEXT_PUBLIC_DEMO_AUTH=true` (current default) |
| **Public staff ERP** | Real school staff on production | `NEXT_PUBLIC_DEMO_AUTH=false` + Supabase Auth profiles linked |

- [ ] Decision recorded
- [ ] If `false`: Supabase → Authentication → Site URL = `https://bhbinternational.school`
- [ ] If `false`: Redirect URLs include `https://bhbinternational.school/**`
- [ ] `PROTECTED_SUPER_ADMIN_EMAILS` lists director + IT emails

**How to verify**

- Demo on: open `/login` → blank staff login → lands on `/home`
- Demo off: staff login requires email/password; demo POST returns 403

**⏭ Parent OTP / field PIN** can stay demo stubs for first week.

---

## 4. Production build passes locally

**Pass criteria**

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build -w web` completes without errors

**How to verify**

```bash
npm run typecheck
npm run build -w web
```

Fix TypeScript/build errors before deploy — Cloud Build will fail on the same issues.

---

## 5. Core data not browser-only

**Pass criteria**

- [ ] Student roster (SIS) visible after login on a **fresh browser** (or incognito) — not empty
- [ ] Masters (classes, fee heads, fee groups) load on production-like env
- [ ] Saving in Masters / SIS triggers cloud sync (Supabase or server mirror)

**How to verify**

1. Open incognito → login → **Students** — count > 0 (or expected seed)
2. **Masters → Fee structure** — groups published for current session
3. DevTools → Network → confirm calls to Supabase and/or `POST /api/school-data/mirror`

**Fail if:** data only exists in one machine’s localStorage and disappears on another device.

---

## 6. Fee Take smoke test (critical path)

**Pass criteria**

- [ ] Open **Fees → Collect** — student search works
- [ ] Dues show correct amounts (fee structure + concessions if assigned)
- [ ] Collect payment (or test amount) → receipt generates
- [ ] Receipt opens / prints
- [ ] **Masters → Concessions** — policies visible; Print list works for a rule with grants

**How to verify** (manual, ~15 min)

1. Pick one known student (e.g. with concession from Excel import)
2. Confirm discount on due line
3. Post ₹1 or full payment in test mode
4. Void/delete test voucher if needed

**⏭** Dashboard chart styling, extra receipt filters — after go-live.

---

## 7. Integrations health (optional modules)

**Pass criteria**

- [ ] `GET /api/integrations/health` returns JSON (after deploy or local prod build)
- [ ] WhatsApp: if using Admissions CRM — `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` set
- [ ] Meta webhook URL configured: `https://bhbinternational.school/api/wa/webhook` (or `/api/whatsapp/webhook`)

**How to verify**

```bash
curl -s https://bhbinternational.school/api/integrations/health | head
```

**⏭** Razorpay live keys, OpenAI, Redis — enable when those features go live.

---

## 8. RBAC & module access

**Pass criteria**

- [ ] Principal role can open: Home, Masters, Fees, Students, Admissions
- [ ] Restricted role cannot open modules outside their permissions
- [ ] **Modules** workspace — only modules you want enabled are ON

**How to verify**

1. Login as principal (demo or real)
2. Open `/fees`, `/masters`, `/students` — no “Access restricted”
3. **Modules** — disable a non-critical module → confirm it hides from Home hub

---

## 9. Security pre-flight

**Pass criteria**

- [ ] `.env.local` and service role key **not** in git
- [ ] Cloud Build / `cloudbuild.yaml` does not embed live passwords (use Secret Manager when possible)
- [ ] If demo auth stays ON: access limited to known testers until real auth is on
- [ ] Rotate any keys that were ever committed or shared in chat

**How to verify**

```bash
git status
git log --all --full-history -- apps/web/.env.local  # should be empty
```

See [GO_LIVE_INFRA.md](./GO_LIVE_INFRA.md) — Security section.

---

## 10. Rollback plan documented

**Pass criteria**

- [ ] You know the current Cloud Run service name and region
- [ ] You can list previous images and roll back within 5 minutes
- [ ] Supabase backup / point-in-time recovery confirmed in Supabase dashboard

**How to verify**

```bash
gcloud run services describe school-erp-web --region=asia-southeast1 --format='value(status.url)'
gcloud run revisions list --service=school-erp-web --region=asia-southeast1 --limit=5
```

**Rollback (if new deploy breaks):**

```bash
# Deploy previous revision (pick revision name from list)
gcloud run services update-traffic school-erp-web \
  --region=asia-southeast1 \
  --to-revisions=REVISION_NAME=100
```

---

## Go / no-go

| | |
|--|--|
| **GO** | Items **1, 4, 5, 6** all ✅ — deploy |
| **SOFT GO** | 1–4 ✅ + demo auth ON + data synced — deploy for internal trial |
| **NO-GO** | Fees broken, no cloud data, or secrets in git — fix first |

---

## After deploy (first week — fix iteratively)

| Priority | Task |
|----------|------|
| Day 1 | Smoke test live URL: login, fees, one student |
| Day 2–3 | Staff feedback — fix blockers only |
| Week 1 | Turn off demo auth when profiles ready |
| Week 1 | WA webhook + template sync if admissions live |
| Ongoing | Weekly deploy; minor UI/report tweaks |

---

## Quick reference

| Resource | Value |
|----------|-------|
| Production URL | https://bhbinternational.school/login |
| GCP project | `school-erp-prod-493619` |
| Cloud Run service | `school-erp-web` |
| Region | `asia-southeast1` |
| Deploy script | `./scripts/deploy-online.sh` |
| Infra detail | [GO_LIVE_INFRA.md](./GO_LIVE_INFRA.md) |
| Env template | [.env.example](../.env.example) |

---

*Last updated for CBSE Schools repo — modular monorepo (Phase 2) is **not** required before this deploy.*
