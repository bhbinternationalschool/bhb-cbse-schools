# BHB International School ERP

Greenfield school ERP for **BHB International School** (`www.bhbinternational.school`), Varanasi, Uttar Pradesh.

| Item | Value |
|------|--------|
| Live ERP | `https://bhbinternational.school` |
| Stack | Next.js 15 · Supabase · Google Cloud Run |
| Timezone | **IST** (`Asia/Kolkata`) |
| Accounting | Internal books — **no Tally required** |
| Legacy app | Separate repo `School-ERP-WhatsApp` (archive / reference only) |

## Phase 0 (this repo)

- Monorepo: `apps/web`, `packages/time`
- Supabase SQL migrations (tenant, AY, RBAC, SIS stubs, fee hold policy)
- Login (Staff / Parent / Field personas) + app shell
- Academic session selector (current + last year)
- Fee defaulter playbook coach (DO/STOP + holds) with demo data
- Demo auth when Supabase env is empty

## Quick start

```bash
cp .env.example apps/web/.env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Login → pick persona (demo).

## Masters (first go-live slice)

Open **Masters** after login:

- Campuses, classes Nursery–XII (A/B)
- **Fee setup:** heads → groups → structure → **Special fees** (create + assign class/students) → due dates → late fee

Demo data: `localStorage` key `bhb_masters_v4`.  
SQL: `…masters.sql`, `…fee_setup.sql`, `…special_fees.sql`.

## Supabase

1. Create a project (prefer India region).
2. Run `supabase/migrations/20260711000000_phase0_foundation.sql` in the SQL editor.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and keys in `apps/web/.env.local`.
4. Set `NEXT_PUBLIC_DEMO_AUTH=false`.

## Cloud Run

```bash
docker build -t bhb-erp -f apps/web/Dockerfile .
# deploy image to Cloud Run; map erp.bhbinternational.school
```

## Packages

| Package | Role |
|---------|------|
| `@bhb/time` | IST helpers — `formatIst`, `startOfIstDay`, … |
| `web` | Next.js ERP app |
