# Supabase egress fix — probe-gated caching (2026-08-20)

**Why:** free-tier egress hit 7.96 GB / 5 GB. Cause: no single bomb — volume. The server mirror re-pulled every desk (SIS ~2.6 MB, admissions, fees, masters, staff, blobs) whenever 45 s had passed, triggered by every WA webhook, every cron tick (4 jobs, one every 5 min) and every API call; and each staff browser session re-downloaded full desks per navigation.

**Fix:** ask "did anything change?" for ~200 bytes before pulling megabytes.
- `desk_probe(tenant, tables[])` SQL function (SECURITY DEFINER, service_role-only, allowlisted tables): md5 over per-table `count | max(updated_at)`.
- `lib/deskProbeCache.server.ts`: probe + in-memory response cache (Cloud Run instance memory) + ETag/304; single-row blob variant gated on the row's `updated_at`.
- `hydrateSchoolMirrorFromRemote`: probe taken **before** the pull; unchanged → skip all pulls (mirror provably current); changed/unknown → full hydrate exactly as before. A write landing mid-pull changes the next probe (extra re-pull, never staleness).
- Wrapped GET routes: sis-roster, fees-vouchers, admissions-desk, masters-desk, staff-roster, attendance-registers, domain-blob (chat-state polling).

**Freshness:** better, not worse. The probe runs per request (5 s micro-cache), so changes surface immediately instead of after the old 45 s TTL. The client guard (`deskHydrateGuard`) already expires after 15 s, and responses now carry `ETag` + `Cache-Control: private, no-cache`, so browsers revalidate automatically (0-byte 304s) with **no client code changes**.

**Fail-open:** probe error → the route/mirror pulls exactly as before the fix.

**Measured on dev against prod data:** sis-roster 2.6 MB build → `x-desk-cache: hit` (Supabase cost ≈ probe only) → 304 with If-None-Match; all five desks + chat blob hit on repeat; a blob write bumped `updated_at` and the next GET rebuilt.

**Ops note:** the caches live in instance memory; a cold start rebuilds on first request. Residual staleness bound: ≤ 5 s (probe micro-cache) — writes by the same instance are still eventually consistent within that window; the writer's own browser has its local copy regardless.
