# Production measurements — 12 Oct 2026

Everything here was measured against the live service and the live database on
12 Oct 2026 (IST). Re-run the same queries after each phase of the rebuild to
prove the gain. Nothing in this file is inferred from code.

## What is live

| Fact | Value | How measured |
|---|---|---|
| Cloud Run revision serving 100 % | `school-erp-web-00856-bdn` (created 12 Oct 14:48 IST) | `gcloud run services describe school-erp-web --region asia-southeast1` |
| Commit it was built from | `4b25d4da` = merge of PR #577 (13:31 IST) | blob-hash of the Cloud Build source tarball `gs://school-erp-prod-493619_cloudbuild/source/1791795799.661268-…tgz` against `git log --first-parent`; 0 files differ |
| Merged but NOT live | PR #578 (Staff 0 fix, merged 15:46 IST) | same diff: only `lib/mastersPersistence.ts`, `lib/masters.ts`, `lib/deskLoadGuard.selftest.ts` differ |
| Deploy trigger | none (`gcloud builds triggers list` is empty); 12 hand deploys in 6 days, each a working-tree tarball with no commit label | `gcloud builds list` |
| Service shape | 1 vCPU, 2 GiB, concurrency 20, min-instances 0, max 20, cpu-throttling on, startup-cpu-boost on | `gcloud run revisions describe … --format=json` |
| Cold starts in 24 h | 63 distinct instance ids served `/api/school-data/*` (126 startup-probe log lines; a start logs more than one) | Cloud Logging |
| Missing route on live | `GET /api/inventory/assets` → 404: `.gcloudignore:13` (`assets/`) strips `apps/web/src/app/api/inventory/assets/` from every build upload (in git since 23 Aug) | `curl -s -o /dev/null -w '%{http_code}' https://bhbinternational.school/api/inventory/assets` |
| Live env | `MASTERS_READ_FROM_ROWS` ABSENT (masters-desk GET is therefore never probe-cached: 266,245 bytes every call); `LEAN_WIRE_PAYLOAD` ABSENT; every `*_READ_FROM_DB` / `*_DUAL_WRITE_DB` = true | revision env list (177 vars) |

## Browser → server, last 24 h (Cloud Run request logs)

| GET route | calls | avg bytes | 304s | note |
|---|---|---|---|---|
| `/api/school-data/sis-roster` | 205 | 1,903 KB | 0 | whole roster per page open; 717 rows for ~250 current children |
| `/api/school-data/fees-vouchers` | 265 | 1,482 KB | 0 | whole fee book |
| `/api/school-data/attendance-registers` | 141 | 685 KB | 0 | |
| `/api/school-data/staff-roster` | 257 | 148 KB | 0 | |
| `/api/school-data/masters-desk` | 196 | 235 KB | 0 | DB payload of the same data is ~60 KB |
| `/api/school-data/desk-slice/rbac` | 394 | 37 KB | 0 | |

Latency of all `/api/school-data/*` GETs (5,206 calls): p50 0.12 s · p90 0.79 s · p95 1.26 s · p99 11.9 s · max 21 s. The p99 tail is contention on the single vCPU, not the database.

Devices: only 4 distinct client IPs hit masters-desk in 24 h (school NAT); user agents 168 desktop / 24 Android / 4 iOS.

Mobile API (Flutter) averages: `/api/v1/principal/snapshot` 5.03 s (242 calls) · `/api/v1/comms/feed` 1.86 s · `/api/v1/staff/approvals` 1.70 s · `/api/v1/parent/summary` 1.46 s · `/api/v1/app/popups` 0.96 s. `POST /api/whatsapp/webhook` 2.98 s (837/day).

High-frequency: `POST /api/transport/fleet-edge/live` 2,309/day (external telemetry), `/api/inventory/sales` 1,578, `/api/fees/open-dues-summary` 1,559, `/api/school-data/domain-blob` 1,406, `/api/chat` ~2,600 (30 s poll per open tab).

5xx in 48 h: 5. Server-side merge conflicts in 48 h: ~10. Errors are NOT the problem; volume, size and staleness are.

## Server → database, last 24 h (Supabase edge logs)

| table (PostgREST path) | GETs/24 h | avg ms | note |
|---|---|---|---|
| `attendance_desk_marks` | 7,904 | 44 | 10,796 rows paged 1,000 at a time → every "whole attendance" hydrate = 11 requests |
| `sis_students` | 3,525 | 107 | vs 205 browser roster downloads: the **server** rebuilds the roster ~17× more often than browsers ask for it |
| `sis_staff` | 3,350 | 47 | |
| `masters_desk_slices` | 3,342 | 48 | |
| `sis_households` | 3,272 | 40 | |
| `rbac_desk_slices` | 2,491 | 27 | |
| `admission_desk_leads` | 683 | 135 | |

Since the stats reset on 12 Aug: `sis_students` whole-tenant selects ≈ 77,000; `masters_desk_slices` 90,261; `sis_staff` 74,102; `fee_desk_voucher_lines` 97,350; RPC `sis_push_guarded` 1,412 calls, mean 4.1 s, max 64 s. `fleet_edge_events` (93 MB, 88k rows) is sequentially scanned by the fleet-edge dedupe select (71,072 seq scans).

Database health is fine: 60 max connections, 1 active at measurement, no statement timeouts or deadlocks in the last 24 h. The database is not the bottleneck; the number of whole-table reads is.

## Masters writes from phones (Cloud Run app logs, 8–10 Oct — the build BEFORE PR #483 went live on 11 Oct 21:50 UTC)

Per day: ~20 `[masters-desk] function-only push by stf_…` (teacher phones pushing the class-subject slice from a snapshot), ~25 `unversioned push accepted (legacy client)`, 1–2 `rejected wipe push stored=15 incoming=0` (a browser tried to push an empty Masters and was refused by the guard). 8 `[desk-slice] … rows changed elsewhere first` on 12 Oct. Zero `stored-state read FAILED` in 7 days (the failed-read-as-empty path is latent, not daily). **After the 11 Oct deploy (rev 00851+, PR #483 'unversioned refused'): zero `unversioned push`, `function-only push` or `rejected wipe push` lines through 12 Oct** — legacy whole-book pushes from phones have stopped; the row-level staleness mechanisms in `evidence/propagation.md` remain.

## Database facts that shape the design

- 573 tables (50 are `*_pre_*` / `*_backup_*` copies); 35 `*_sync_meta` tables in production, each with `updated_at`. Migrations define 37: `purchase_desk_sync_meta` and `store_desk_sync_meta` are NOT in production (drift — see COMMAND.md 0.6). Bumped by the `*Normalized.server.ts` pushes, `sis_push_guarded` and `masters_write_slices`; NOT by `desk_write_guarded`, `rowStampWrite` or `sliceCas`. No sync_meta exists for staff (`sis_staff.updated_at` only), the 29 `module_local_state` books or the `*_state` blobs.
- `sis_students`: 717 rows, 671 "active", per academic year 2023-24: 88 · 2024-25: 142 · 2025-26: 235 · 2026-27: 252. One row per child per year; every screen that is not year-scoped double counts.
- `masters_desk_slices`: 29 slices, ~60 KB total payload (concessionGrants 13 KB, students projection 9 KB, feeStructureLines 5 KB, classSubjects 2.5 KB). Masters is tiny; it is the parse-per-read and the copy model that make it expensive.
- No table is published to Supabase Realtime (`pg_publication_tables` for `supabase_realtime` is empty).

## Re-measure recipe

```bash
# browser-facing desk GET volume + size, last 24 h
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND httpRequest.requestUrl:"/api/" AND timestamp>="<ISO-24h-ago>"' --limit 20000 --format="value(httpRequest.requestUrl,httpRequest.requestMethod,httpRequest.responseSize,httpRequest.latency)"
```

```sql
-- server→db read volume per table, last 24 h (Supabase query_logs, ClickHouse)
select log_attributes['request.method'] m, log_attributes['request.path'] p, count() c,
       round(avg(toFloat64OrZero(log_attributes['response.origin_time']))) avg_ms
from logs where source='edge_logs' group by m, p order by c desc limit 40
```

```sql
-- hottest statements since the last reset
select calls, round(total_exec_time/1000) total_s, round(mean_exec_time) mean_ms, left(query,120)
from pg_stat_statements where calls > 20 order by total_exec_time desc limit 30;
```
