# Go-live data reset (demo → real data)

Use this runbook when you want a **clean ERP** on Supabase, then load **real BHB data** via imports.

## What gets wiped

| Cleared | Kept |
|---------|------|
| All `*_desk_*` transactional tables | `tenants`, `roles`, `profiles` |
| SIS (`sis_students`, `sis_households`, staff roster) | `user_role_assignments` |
| Admissions CRM desk | `classes`, `sections`, `fee_heads` |
| Fees, attendance, exams, payroll, etc. | `academic_years`, `school_profiles` |
| All jsonb `*_state` blobs (reset to empty) | Migration foundation |

Optional: `--preserve-masters` keeps `masters_desk_slices` (fee structure you already configured).

## Prerequisites

- Supabase backup (dashboard → Database → Backups, or `pg_dump`)
- `apps/web/.env.local` with `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` recommended (pooler session port **5432**) for reliable bulk delete

## Step 1 — Preview

```bash
cd apps/web
npm run clear:tenant-data -- --dry-run
```

Review non-zero row counts. Add `--clear-storage` to preview file bucket wipe.

## Step 2 — Wipe

```bash
cd apps/web
npm run clear:tenant-data -- --confirm
# or keep masters fee setup:
npm run clear:tenant-data -- --confirm --preserve-masters
# include uploaded docs/photos:
npm run clear:tenant-data -- --confirm --clear-storage
```

This writes `public/tenant_data_wiped.json` and `public/fees/collections_wiped.json` for browser sync hints.

## Step 3 — Foundation

```bash
# Empty masters structure (classes, fee heads template) if masters were wiped:
npx tsx scripts/seed-masters-desk.ts

# RBAC roles + director profile only (do NOT re-backfill demo blobs):
npm run bootstrap:go-live -- --skip-desk
```

## Step 4 — Import real data (order matters)

| Order | Command / action | Needs |
|-------|------------------|-------|
| 1 | **SIS roster** — ERP UI import or `backfill-sis-roster.ts` | Excel / mirror export |
| 2 | **Staff** — `npx tsx scripts/backfill-staff-roster.ts` | Masters staff slice or UI |
| 3 | **Fee discounts** — `npm run import:fee-discounts` | `data/fees/fee_discount_report.xlsx` + SIS |
| 4 | **Opening dues** — `npx tsx scripts/import-previous-dues-excel.ts` | `Student_Wise_Fee_Details.xlsx` + SIS |
| 5 | **Receipts** — `npx tsx scripts/import-payment-report-pdf.ts` | Payment report PDF + SIS |
| 6 | **Admissions leads** — `npm run import:leads` | `data/leads/*.xlsx` |
| 7 | Other modules | ERP UI or module-specific imports |

Place source files under `apps/web/data/` before running import scripts.

## Step 5 — Validate & deploy

```bash
npm run validate:desk-cutover
SKIP_BOOTSTRAP=1 ./scripts/deploy-online.sh   # from repo root
```

Or deploy first, then wipe + import on production DB (same commands against prod `.env.local`).

## Step 6 — Browsers

After wipe, every user should **hard-refresh** or clear site data for `bhbinternational.school` / `localhost:3000`. Stale `localStorage` can show old demo until cleared.

## Flags reference

| Flag | Effect |
|------|--------|
| `--dry-run` | Count rows / blobs only |
| `--confirm` | Execute wipe (required) |
| `--preserve-masters` | Skip `masters_desk_*` |
| `--clear-storage` | Remove `school-files/{tenant_id}/…` |
| `--tenant=bhb-international` | Tenant slug (default) |

## Bootstrap / deploy cautions

| Command | Risk after wipe |
|---------|-----------------|
| `npm run ensure:desk` | Safe if blobs were reset (no demo backfill) |
| `npm run bootstrap:go-live` | Re-runs desk backfill — use `--skip-desk` after wipe |
| `./scripts/deploy-online.sh` | Runs bootstrap by default — use `SKIP_BOOTSTRAP=1` or wipe before deploy |

## Related

- [deploy/README.md](../deploy/README.md) — production env / desk cutover flags
- [GO_LIVE_INFRA.md](./GO_LIVE_INFRA.md) — Cloud Run / Supabase inventory
