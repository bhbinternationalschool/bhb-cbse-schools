# Production deploy environment

This folder documents how to run the ERP with **Supabase desk tables** as the source of truth in production — so any browser or device sees the same data.

## Why this matters

| Layer | Role |
|-------|------|
| **Supabase Postgres** | Stores fees, attendance, masters, admissions, etc. |
| **`apps/web/.env.local`** | Local dev secrets + feature flags (gitignored) |
| **Hosting env (Cloud Run / Vercel)** | Same flags as `.env.local` for production |

`.env.local` only affects your machine. Production needs the same `*_DUAL_WRITE_DB`, `*_READ_FROM_DB`, and `NEXT_PUBLIC_*_READ_FROM_DB` flags on the host.

## Files

| File | Purpose |
|------|---------|
| `env.production.example` | Core production secrets + app URL (template) |
| `desk-cutover.env.example` | All 38 desk module DRP flags (canonical list) |
| `.generated/` | Created by deploy script (gitignored) — runtime YAML + Docker build env |

## Cloud Run (BHB — bhbinternational.school)

**Prerequisites:** `apps/web/.env.local` with Supabase keys and desk flags (copy from `desk-cutover.env.example`).

```bash
# Validate desk flags before deploy
python3 scripts/lib/collectDeskCutoverEnv.py apps/web/.env.local --check

# Optional: require all READ_FROM_DB=true (production go-live)
python3 scripts/lib/collectDeskCutoverEnv.py apps/web/.env.local --check --require-read-from-db

# Deploy (generates deploy/.generated/*, passes desk vars to Cloud Build)
./scripts/deploy-online.sh
```

`deploy-online.sh` now:

1. Merges `desk-cutover.env.example` with `apps/web/.env.local`
2. Writes `deploy/.generated/desk-cutover-runtime.yaml` (Cloud Run runtime)
3. Writes `deploy/.generated/desk-cutover-build.env` (`NEXT_PUBLIC_*` baked into Next.js client bundle)
4. Submits Cloud Build — desk flags are applied on deploy

After deploy, confirm:

```bash
cd apps/web && npx tsx scripts/validate-desk-cutover.ts
```

## Vercel / other hosts

1. Copy `env.production.example` → hosting env UI
2. Paste all lines from `desk-cutover.env.example`
3. Set secrets (`SUPABASE_SERVICE_ROLE_KEY`, WhatsApp, etc.)
4. **Redeploy** after changing `NEXT_PUBLIC_*` vars (they are inlined at build time)

## Local dev (team)

1. Copy root `.env.example` → `apps/web/.env.local`
2. Add Supabase keys from team vault
3. Enable desk flags from `desk-cutover.env.example` as modules are validated:

```bash
cd apps/web && npx tsx scripts/validate-desk-cutover.ts
```

When a module shows `Ready=YES`, set both server and `NEXT_PUBLIC_*` flags to `true`.

## Flag reference

| Flag | Effect |
|------|--------|
| `*_DUAL_WRITE_DB=true` | Saves go to Postgres (default on; **never set false** if you want persistence) |
| `*_READ_FROM_DB=true` | Server/API reads desk tables |
| `NEXT_PUBLIC_*_READ_FROM_DB=true` | Browser hydrates from desk APIs (required for cross-browser UI) |

## Troubleshooting

**Data saves locally but not on another computer**

- Production missing `NEXT_PUBLIC_*_READ_FROM_DB` or not redeployed after adding them
- `*_DUAL_WRITE_DB=false` disables Postgres writes
- Supabase keys missing on the host

**Cloud Run has old client behavior**

- `NEXT_PUBLIC_*` vars must be present at **Docker build** time. Re-run `./scripts/deploy-online.sh` (not just `gcloud run services update` for secrets only).

See also: [docs/GO_LIVE_INFRA.md](../docs/GO_LIVE_INFRA.md) · [docs/GO_LIVE_DATA_RESET.md](../docs/GO_LIVE_DATA_RESET.md) · [docs/WHATSAPP_ADMISSIONS_GO_LIVE.md](../docs/WHATSAPP_ADMISSIONS_GO_LIVE.md)
