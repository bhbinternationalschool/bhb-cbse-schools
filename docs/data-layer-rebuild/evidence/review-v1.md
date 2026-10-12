# Review of COMMAND.md v1 — three independent critics (12–13 Oct 2026)

v2 of COMMAND.md was rewritten from these critiques. Kept here so an executor can see why a step is shaped the way it is. Paths cite origin/main 2f0eb3d4.

---

# Critic: feasibility

## verdict
The diagnosis (§1–§3) is well-grounded and most file paths exist, but §4 is not yet executable by a Sonnet-class session given only §0+§3+step+§7. Phase 1 would stall on the first step: the "seeded local database" recipe (`scripts/rehearse-migrations.sh`) is a bare PG17 with a role shim and no PostgREST, while the app reaches the database only through supabase-js (`lib/supabase/server.ts:203-206`, `lib/serverTenant.ts`), so `next start` against it cannot work as written; office/teacher login is WhatsApp OTP with no test bypass; and the Masters seed format (29 jsonb slice keys) is nowhere described. §7.2 misdescribes three of its eleven primitives (the data route is not inert and already has a `{ops:[…]}` contract that contradicts R4's `{row, baseUpdatedAt}`; `desk_probe` cannot probe any `*_sync_meta` table because of its allowlist; `sliceCas.server.ts` is a TS retry loop, not a lock used by an RPC), and R3's premise that "every server write already bumps `*_sync_meta`" is false for `desk_write_guarded`. Several acceptance tests depend on strings or counts that do not exist (`unversioned push accepted`, `JSON.parse(readCache(`, "200 files under app/api/v1"), and the 109/90-file batch lists that 2.1/3.3 point at are not in the evidence files. Ratings: Phase 0 feasible (director-run); Phase 1 needs-rewrite; Phase 2 feasible after 2.1's file list and 2.2's acceptance are fixed; Phase 3 needs-rewrite (3.1 year-scope contradiction with `registry.ts`, route-namespace collision, 3.2's open-dues dependency on the path Phase 5 deletes); Phase 4 feasible if 4.1 is split per route and 4.3/4.4 prerequisites are stated; Phase 5 needs-rewrite (22 desks in one paragraph, no per-desk brief); Phase 6 feasible as deletion.

## blocking

### §4 step 1.1 (COMMAND.md:180-203) and §7.2 'local throwaway DB'
- PROBLEM: The recipe named (`erp-fresh-db-migration-rehearsal` / `scripts/rehearse-migrations.sh`) starts a bare Postgres 17 with a role shim (`rehearse-migrations.sh:43-96`: creates `service_role`, applies migrations, nothing else). The app never speaks SQL directly — every read/write goes through supabase-js over PostgREST (`apps/web/src/lib/supabase/server.ts:203-206` needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; `lib/serverTenant.ts:16-19` resolves the tenant from the `tenants` table by `TENANT.slug`; `lib/postgresPool.server.ts` is used only by BigQuery sync). `supabase/config.toml` is only `project_id` + `[db]`. So 'start `next start` against it' is impossible as written and a Sonnet executor will either guess at `supabase start` (CLI not configured) or give up.
- FIX: Add a 1.0 step: 'Local API stack for tests' — either run PostgREST (pinned version) + a minted service-role JWT against the rehearsal cluster and set `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to it, or complete `supabase/config.toml` so `supabase start` works, then make `scripts/e2e-db.sh` wrap that. State the exact env vars `next start` needs (`APP_SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, every `*_READ_FROM_DB=true` flag, `MASTERS_READ_FROM_ROWS`) and that `tenants` must hold a row with `TENANT.slug`.

### §4 step 1.1 (COMMAND.md:184) '1 office login, 1 teacher login'
- PROBLEM: Login is WhatsApp OTP (`app/api/auth/otp/request|verify`, `app/api/auth/staff-otp/request|verify`); the only fixed-credential bypass is the store-review *parent* login (`otp/verify/route.ts:25-60`). A Playwright context cannot log in as office or teacher without something the doc does not name.
- FIX: Specify the login mechanism: either Playwright mints a cookie with `signSession()` (`lib/sessionCookie.server.ts:58`, needs `APP_SESSION_SECRET`) for a seeded `stf_` id, or add an env-gated `E2E_FIXED_OTP` to `staff-otp/verify`. Name the cookie name and the session shape (`DemoSession` fields: persona, staffId, academicYearCode).

### §4 step 1.1 fixtures (COMMAND.md:183-184)
- PROBLEM: 'fixtures = 15 classes, 13 sections, 44 subjects, 34 staff, 250 students' names counts but not the storage shape. Masters lives in `masters_desk_slices (tenant_id, slice_key, payload jsonb)` across 29 slice keys (production-measurements.md), plus `rbac_desk_slices`, `module_registry_desk_slices`, `sis_students`/`sis_households`/`sis_staff` columns, and the `*_sync_meta` rows that CoreDataGate/hydration need to mark loaded. An executor must reverse-engineer `mastersNormalized.server.ts`'s slice format to seed anything.
- FIX: Point the seed at a generator: 'write `scripts/e2e-seed.ts` that builds a `MastersState` via the existing TS types, splits it with the same function `masters-desk/route.ts` POST uses to write slices, and inserts `sis_*` rows through `sis_push_guarded`'. List the slice keys that must be non-empty for the app to boot (classes, sections, subjects, classSubjects, academicYears, feeHeads, settings) and the rbac/module-registry seed source.

### §3 R4 (COMMAND.md:128-134) vs §7.2 'inert Stage-1 data route' vs §4 step 1.5
- PROBLEM: R4 says `POST /api/data/<collection>` takes `{row, baseUpdatedAt}`. The existing route (`app/api/data/[collection]/route.ts:80-160`) already enforces `{ops: WriteOp[]}` with `WriteOp = {op:'upsert'|'delete', id, base: Revision|null, row}` (`lib/data/types.ts:105-116`), a 10-collection registry (`lib/data/registry.ts:88-300`), a keyset-paged `list()` (`lib/data/server/repo.ts:113-195`), an approval gate, and client hooks `lib/data/client/{query,mutate,useSaveMutation}.ts`. 1.4 says 'Add `lib/data/useErpQuery.ts`' and 1.5 'wire the inert route' as if none of this existed. A small executor will either build a second kernel beside the first or break the existing contract.
- FIX: Rewrite R4 to the existing `{ops:[{op,id,base,row}]}` contract (it is strictly better: batchable, typed Revision). In 1.4 say 'wrap `readPage`/`readAll` (`lib/data/client/query.ts:53,154`) in React Query; `useErpMutation` is `useSaveMutation` (`client/useSaveMutation.ts:40`) plus invalidation'. In 1.5 say 'the row path already works through `desk_write_guarded` for registered tables; the new work is (a) the `desk_slice_row_write` RPC, (b) sync_meta bumps, (c) a `kind:'slice'` registry entry type'.

### §3 R3 (COMMAND.md:125-126) and §4 step 1.5 (COMMAND.md:237)
- PROBLEM: 'Every server write already bumps its `*_sync_meta.updated_at`' is false for the row path the plan builds on: `desk_write_guarded` (migrations 20260810010000, 20260810050000) never references any `sync_meta`; 0 of the 16 triggers in `supabase/migrations` touch a `sync_meta` table. Only app code (`sisNormalized.server.ts`, `sisSeparate.server.ts`, `sisProfile.server.ts`) and two RPCs (`sis_push_guarded`, `masters_write_slices:77`) bump. So after 1.5 a student row written via `/api/data/sis.students` would never move `sis_sync_meta`, and R3's versions poll would never invalidate it — the propagation spec would silently fail for every row table.
- FIX: Make 1.5 explicit: add a migration that bumps the owning `*_sync_meta.updated_at` inside `desk_write_guarded` (table→desk map in `desk_writable_tables`, add a `sync_meta_table` column) or a per-table trigger; add a unit test on the local DB that a `desk_write_guarded` call moves the stamp. Delete the sentence 'a write that does not is a bug' or make it a test.

### §4 step 1.3 (COMMAND.md:216-219) 'versions … probe-cached 2 s' and §7.2 'probe-gated response cache'
- PROBLEM: `desk_probe` has a hard allowlist (`supabase/migrations/20261009090000_desk_probe_transport.sql:19-36`) and raises `not allowlisted` for anything else; it contains zero `*_sync_meta` tables and none of the 37 that exist (`sis_sync_meta`, `masters_desk_sync_meta`, …). `cachedDeskJson` (`lib/deskProbeCache.server.ts:57`) therefore cannot key a versions endpoint on sync_meta. Also the doc says 35 tables; there are 37, the SIS one is `sis_sync_meta` (not `sis_desk_sync_meta`) and there is no staff sync_meta at all.
- FIX: Say in 1.3: 'versions does NOT use `deskProbe`; it does one `select` over the 37 sync_meta tables (list them, or generate the list from `information_schema` at boot) plus `max(updated_at)` on `sis_staff`, cached in-process for 2 s'. Or add a migration extending the allowlist. Give the executor the table list verbatim.

### §4 step 1.4 (COMMAND.md:227-229) and step 3.1 (COMMAND.md:278-283)
- PROBLEM: `/api/data/masters`, `/api/data/staff-list`, `/api/data/rbac`, `/api/data/module-registry`, `/api/data/students?…`, `/api/data/students/:id`, `/api/data/households/:id`, `/api/data/fee-search` all fall into the existing dynamic segment `app/api/data/[collection]/route.ts`, which returns 404 `Unknown collection` for ids not in `COLLECTIONS` (registry ids are dotted: `sis.students`, `sis.households`). The executor is not told whether to register these as collections, add static sibling routes (Next picks static over dynamic, but `students/[id]` needs its own folder), or use a different prefix.
- FIX: Decide the namespace once: e.g. 'reference views live at `app/api/data/views/<name>/route.ts`; row collections keep `[collection]`'. State it in R2 and in 1.4/3.1 with the exact folder paths to create.

### §4 step 3.1 (COMMAND.md:279-281) 'year-scoped by default'
- PROBLEM: The one file the executor must edit, `lib/data/registry.ts:95-110`, carries a loud comment saying the opposite: 'scoping a roster by academic_year_code would have hidden 442 of 680 active students… a roster query is tenant-wide'. The memory note `erp-stale-academic-year-rows` (31 Aug) and `production-measurements.md` ('one row per child per year') say the doc is right and the comment (10 Aug) is stale, but a Sonnet session reading only §0/§3/step/§7 will trust the in-code comment and ship a tenant-wide query, re-creating the double count.
- FIX: In 3.1 say explicitly: 'the comment at `registry.ts:95-110` is stale (pre-31 Aug); the table now holds one active row per child per year; replace the comment, add `academic_year_code` to `scope`, default `ay` to the session year, and keep an explicit `?all_years=1` for exports.'

### §4 step 1.3 (COMMAND.md:219-220) 'Delete the disk mirror … `diskPersist` → no-op' and §0/§7.3 frozen list
- PROBLEM: No symbol `diskPersist` exists; `schoolDataMirror.server.ts:26` defines `DATA_FILE` and the persist code is inline. More importantly `schoolDataMirror*.ts` is on the §7.3 frozen list (delete-only until Phase 6) — step 1.3 asks the executor to edit a frozen file. Also 1.1's `counts.spec.ts` depends on `CoreDataGate` (frozen) behaving, and 2.3 asks to delete `CoreDataGate` — fine — but 1.3 is a modification.
- FIX: Either rephrase 1.3 as a deletion ('remove the `writeFileSync` to `.data/school_mirror.json` and its reader; keep the in-memory path') or move it to Phase 6. Name the actual lines to delete.

### §4 step 1.5 (COMMAND.md:234-236) `desk_slice_row_write(desk, slice, row, base_rev)`
- PROBLEM: Under-specified in four ways: (a) `*_desk_slices` rows have `updated_at`, not `_rev` (`20260802370000_masters_desk_normalized.sql:3-9`); the doc alternates `_rev`/`base_rev`/`updated_at`; (b) 'replaces one element by id' assumes every payload element has an `id` — write-path.md §6 says settings/object slices are written whole and are not arrays; (c) a security-definer function taking a table name must allowlist it (copy the `desk_probe` pattern) — not stated; (d) there are 16 `*_desk_slices` tables; the doc does not say whether one RPC serves all or whether the service_role grant/`desk_writable_tables` row is needed per table.
- FIX: Specify: signature `desk_slice_row_write(p_tenant uuid, p_table text, p_slice_key text, p_op text, p_id text, p_row jsonb, p_base timestamptz)`; allowlist = the 16 `*_desk_slices` tables; CAS on `updated_at = p_base`; bump `<desk>_sync_meta`; object slices (settings) get a sibling `desk_slice_object_write`. Add `supabase/tests/desk_slice_row_write.test.sql` beside the two existing pgTAP-style tests.

### §4 step 1.6 (COMMAND.md:242-246)
- PROBLEM: 'Add to `scripts/ratchets.txt`' is not enough: `check-ratchets.sh:30-163` has a hard-coded `case` per metric; an unknown metric fails with `UNKNOWN METRIC`. Two proposed patterns are dead on arrival: `JSON.parse(readCache(` has 0 occurrences today (a ratchet at 0 that nobody will trip) and `fetch("/api/school-data/` matches only 4 component files. `ensure[A-Za-z]+Hydrated(` in components is 69 files today (not given).
- FIX: Say 'add a `case` to `count_metric` in `scripts/check-ratchets.sh` AND a budget line'. Replace the dead pattern with `readCache(` (71 files in src). Give today's counts: loadMasters( 109, loadSis( 77, ensure*Hydrated( in components 69, readFileSync in selftests 66, ensureSchoolMirrorHydrated in app/api/v1 100.

### §4 Phase 5 (COMMAND.md:341-361)
- PROBLEM: Twenty-two desks are given one five-line procedure and '~10–15 sessions'. Fees alone spans vouchers, lines, tenders, open dues, payment links, concessions, defaulter holds, receipts and the counter search; 'one PR per desk' for fees would be the largest PR in the repo's history, and the executor is not told which views exist, which tables, which RPCs ('day close' is named but not located), or which `*Persistence.ts` to delete. 3.2 also makes `fee-search` read `fee_desk_open_dues`, which is maintained by `app/api/school-data/fees-vouchers/route.ts` and `app/api/fees/rebuild-open-dues/route.ts` — i.e. by the whole-desk save path Phase 5 deletes — a hidden prerequisite nobody owns.
- FIX: Write Phase 5 as 5.1–5.22 with, per desk, the tables, the `*Persistence.ts`/`*NormalizedClient.ts`/`ensure*HydratedServer` files to delete, the screens to convert, and the sub-steps for fees (5.1a counter, 5.1b vouchers/lines, 5.1c open-dues maintenance moved into the write RPC, 5.1d links). Add an owner for `fee_desk_open_dues` maintenance before 3.2 ships.

## improvements

### §0 executor header (COMMAND.md:9-10, 30-39)
- PROBLEM: '§0, §3, its own step in §4, and §7 — nothing else is needed' is untrue for 1.1 (needs a memory note the session may not have), 2.1/3.3 (point at evidence tables), 3.1/3.4 (cite evidence sections), and 4.4 (cites 1.2). A fresh worktree session has no memory directory.
- FIX: Add the local-DB script path (`scripts/rehearse-migrations.sh`) and the deploy recipe to §7.2 so no step depends on memory; for 2.1/3.3 embed the batch lists in the step.

### §4 step 2.1 (COMMAND.md:250-253)
- PROBLEM: 'the 109 files listed in evidence/propagation.md (picker table) and evidence/read-path.md (read-once list)' — the picker table (propagation.md:92-112) lists 17 screens / ~28 paths with line numbers; the read-once list (read-path.md:124-140) lists ~25 component names without paths. 109 is only a grep total. The executor cannot pick 'batches of ~10 files, highest-traffic first' without re-deriving the list.
- FIX: Generate the list once (`grep -rl 'loadMasters(' apps/web/src/components 'apps/web/src/app/(erp)'`), group it into the 10 named batches in the step, and paste it; each batch becomes 2.1.a–2.1.j.

### §4 step 1.2 (COMMAND.md:205-211)
- PROBLEM: 'Every browser fetch to /api/* sends X-Bhb-Build (the .next/BUILD_ID)' — the browser has no access to `.next/BUILD_ID` (only `app/api/app-version/route.ts:25-26` reads it); there is no shared fetch wrapper in the client (hydrate code calls `fetch` directly in dozens of files), so a small executor will monkey-patch `window.fetch`. `POST /api/client-metrics` does not exist yet; the Cloud Logging query 'in production-measurements.md style' is undefined for a new event shape.
- FIX: Say: expose the build id as `NEXT_PUBLIC_BUILD_ID` from `next.config` (`generateBuildId`) or read it once from `/api/app-version`; add one `lib/data/erpFetch.ts` that every new hook uses (old code may keep raw fetch until deleted); define the beacon JSON shape and the `jsonPayload.event` field name the log query filters on.

### §4 step 1.4 acceptance (COMMAND.md:231-232)
- PROBLEM: '`propagation.spec.ts` passes for that screen in two contexts' — the spec as defined in 1.1 targets `/homework` and the real Masters editor. For 1.4 the edit must come from somewhere: the only writer is the old `MastersWorkspace` (whole-slice `masters_write_slices`, which does bump `masters_desk_sync_meta:77`, so it would work) — but the spec needs a parameter for the observing page.
- FIX: Write the spec with `observeAt(path)` and `editVia('old-editor'|'api')`; in 1.4 run it as `observeAt('/__kernel'), editVia('old-editor')`. Also specify how `/__kernel` is dev-gated (`notFound()` unless `process.env.E2E=1`).

### §4 step 2.2 acceptance (COMMAND.md:265-267)
- PROBLEM: Acceptance is 'Cloud Run log lines stop' — a production observation that cannot be green in CI on the PR, contradicting §0 'merge only when the named acceptance test is green in CI'. Also the strings: `function-only push by` is emitted by `lib/deskFeatureGate.server.ts:174` (not `masters-desk/route.ts`), and `unversioned push accepted` is not in main at all (`mastersRevisionEverywhere.selftest.ts:37` asserts its absence; the route logs `rejected unversioned push` at :299).
- FIX: Make the CI acceptance 'the `masters-desk` POST handler returns 410 for a body with `classSubjects` and the function-only branch of `deskFeatureGate.server.ts` is deleted (ratchet `deskFeatureGate` = 0)'; keep the log-line check as a post-deploy measure under §6.3.

### §4 step 4.1 (COMMAND.md:312-322)
- PROBLEM: Nine routes rewritten 'in this order' is one step = one PR, but each route is a distinct SQL design (popups by household, attendance by date range, a new `principal_snapshot` SQL function + migration + grant + process cache). That is 9 PRs, and the snapshot alone is a session. The acceptance mixes per-route p95s with a global ratchet that can only reach 0 after all nine plus the ~90 other `app/api/v1` files that call `ensureSchoolMirrorHydrated` (100 files today).
- FIX: Split into 4.1.a–4.1.i, one route each, each with its own p95 and its own ratchet decrement; make the 'falls to 0' claim the Phase 4 exit, not 4.1's.

### §4 step 4.3 (COMMAND.md:329-332)
- PROBLEM: Cloud Tasks requires a queue, IAM for the runtime SA, and a target URL secret — infrastructure a worktree session cannot create and the director must run. The alternative '`/api/wa/process` self-call with a job guard' is exactly the 'new guard' §6.5 forbids. `ensureWabaWebhookSubscription` (`lib/waMeta.server.ts:162`) is referenced correctly.
- FIX: Add a Phase-0-style director sub-step (create queue, grant `cloudtasks.enqueuer`, add `WA_TASKS_QUEUE` env) before 4.3, and name the existing `WA_DISPATCH_SECRET` as the auth for the worker route.

### §4 step 4.4 acceptance (COMMAND.md:338-339)
- PROBLEM: 'the approvals call count per session drops to ≤ 2 (telemetry 1.2)' — 1.2 is web-only (`navigator.sendBeacon` from the browser); the Flutter app (`api_client.dart`, 4,901 lines) has no beacon. There is no way to measure the acceptance as written.
- FIX: Either add a Flutter counterpart to 1.2 (`POST /api/client-metrics` from `api_client.dart` with `platform:'flutter'`) as 4.4's first sub-step, or make the acceptance a Cloud Run log count of `/api/v1/staff/approvals` per session token.

### §4 step 3.4 (COMMAND.md:303-308)
- PROBLEM: Two row-write paths are offered for the same table: `sis_push_guarded` ('call it with one row'; signature is `(p_tenant_id, p_households jsonb, p_students jsonb)`, mean 4.1 s/call in production) and the registry's `sis.students` collection through `desk_write_guarded` (`registry.ts:90-114`, already allowlisted in `desk_writable_tables`). An executor must choose and the doc gives no criterion. `sis_push_guarded` also bumps `sis_sync_meta`; `desk_write_guarded` does not (see blocking item).
- FIX: Pick `desk_write_guarded` via `/api/data/sis.students` (already typed, paged, registered) and state that `sis_push_guarded` stays only for the UDISE/import bulk path; make the sync_meta bump part of 1.5.

### §7.2 'server-scoped hook precedent' `components/staff/useMyTeaching.ts`
- PROBLEM: The cited precedent is a module-level `cache` + 60 s TTL + `useState` + mount-only `useEffect` (`useMyTeaching.ts:21-55`) — exactly the read-once/TTL replica pattern §3 outlaws. A small executor told to copy it will build `useMasters()` the same way instead of on React Query.
- FIX: Replace the precedent with `lib/data/client/query.ts` (`readPage`/`readAll`, typed `ReadFail`) and say 'useMyTeaching is the shape to migrate away from; convert it to `useErpQuery('my-teaching', '/api/v1/staff/my-classes')` in 2.3'.

### §4 step 0.3 (COMMAND.md:171-174)
- PROBLEM: 'add `--labels=commit=$COMMIT_SHA` to the `gcloud run deploy` step' does not say which file. `cloudbuild.yaml:130-185` has the `gcloud run deploy` args; `cloudbuild.deploy-on-merge.yaml:64-74` has an `id: deploy` step that delegates (it sets `DEPLOY_SA_KEY`) rather than calling `gcloud run deploy` inline. Also 0.2 says `cloudbuild.yaml` 'says 0' — true (`:152`), but the comment at `:150` explains a 22 Aug incident the executor should read before flipping it.
- FIX: Name `cloudbuild.yaml:130-152` for both edits and note the `:150` comment; say the deploy-on-merge yaml inherits it.

### §4 step 1.1 `budget.spec.ts` and §5 table
- PROBLEM: '≤ 300 KB transferred (gzip)' and 'no single response > 150 KB' — Playwright's `response.body()` gives decoded bytes; `transferSize` needs CDP `Network.loadingFinished.encodedDataLength`. A Sonnet executor will measure the wrong number and the gate will fail or pass for the wrong reason.
- FIX: Specify the measurement: 'use `page.route`/CDP `Network.responseReceived` + `loadingFinished.encodedDataLength`; count only `/api/*`; exclude `_next/static`'.

### §2 / §3 R5 'Reference data is served from a per-process cache keyed on `masters_desk_sync_meta.updated_at` (probe)'
- PROBLEM: Same allowlist issue as 1.3, and `loadServerMasters` (`lib/api/v1/auth.ts:197-224`) already is a per-process TTL cache that falls back to `defaultMasters()` on failure — the executor needs to know it is the thing being replaced, not extended.
- FIX: In 1.3 name `loadServerMasters` and `mastersCache` as the code `referenceCache('masters', …)` replaces, and that its `catch → defaultMasters()` is the R6 violation to delete in the same PR.

### §4 step 2.3 (COMMAND.md:269-274)
- PROBLEM: '`useAccessData`'s desk listeners' — `useAccessData` (`components/shell/useAccessData.ts:63`) is consumed by 23 files and gates on `deskEverHydrated('rbac'|'staff')`; deleting its listeners without converting its consumers' `status` contract is a hidden sub-step. `CORE_IDS` is at `deskHydrationSchedule.ts:40` (ids `masters`, `staff`, `rbac`, `moduleRegistry` at :128/:171/:182/:226) — fine, but the step should say removing four entries from a frozen file is a permitted deletion.
- FIX: List the 23 consumer files and say `useAccessData` keeps its return type but is re-implemented on `useRbac()`+`useStaffList()`; state the frozen-file exception explicitly.

## factual errors

- CLAIM: §7.2: 'inert Stage-1 data route `app/api/data/[collection]` + `desk_write_guarded`' and §3 R4: `POST /api/data/<collection>` with `{row, baseUpdatedAt}`
  TRUTH: The route is live code with a full contract: body must be `{ops: WriteOp[]}` (`route.ts:94-108` rejects anything else with a message naming `{state}`), `WriteOp = {op:'upsert'|'delete', id, base: Revision|null, row}` (`lib/data/types.ts:105-116`), ten registered collections (`registry.ts:88-300`), keyset-paged `list()` (`repo.ts:113-195`), approval gate; client side `lib/data/client/query.ts`, `mutate.ts`, `useSaveMutation.ts` already exist. 'Inert' only means no screen consumes it (TODO.md:258-261).
  EVIDENCE: apps/web/src/app/api/data/[collection]/route.ts; apps/web/src/lib/data/{types.ts,registry.ts,server/repo.ts,client/*}

- CLAIM: §3 R3: 'Every server write already bumps its `*_sync_meta.updated_at`; a write that does not is a bug.'
  TRUTH: `desk_write_guarded` (the row path §7.2 tells 1.5 to use) never touches a sync_meta table; no database trigger does (0 of 16 triggers). Bumps happen only in app code (`sisNormalized.server.ts`, `sisSeparate.server.ts`, `sisProfile.server.ts`) and in `sis_push_guarded` / `masters_write_slices` (migration `20261010220000:77`).
  EVIDENCE: grep 'sync_meta' supabase/migrations/20260810010000_desk_write_guarded.sql and 20260810050000_masters_allowlist_and_guard_defaults.sql → no matches; trigger files containing sync_meta → none

- CLAIM: §4 1.3 / R3 / R5: the versions endpoint and reference cache are 'probe-cached' via `deskProbe` over the '35 `*_sync_meta` tables'
  TRUTH: `desk_probe` raises `not allowlisted` for any table outside a fixed array of 36 data tables that contains no `*_sync_meta` table (`20261009090000_desk_probe_transport.sql:19-36,46`). There are 37 sync_meta tables, the SIS one is `sis_sync_meta`, and staff has none (hence the doc's own `sis_staff max(updated_at)`).
  EVIDENCE: supabase/migrations/20261009090000_desk_probe_transport.sql; `grep -rhoE 'create table (if not exists )?(public\.)?[a-z_]+_sync_meta' supabase/migrations | sort -u | wc -l` = 37

- CLAIM: §7.2: 'slice lock + all-or-none — `supabase/migrations/20261010220000_masters_write_slices.sql`, `lib/sliceCas.server.ts`'; Phase 6: 'Keep … `sliceCas.server.ts` (used by the RPC)'
  TRUTH: `casWriteSlice` (`sliceCas.server.ts:34-60`) is a TypeScript read→compute→`update … eq('updated_at', stamp)` retry loop (6 attempts) with no lock and is not callable from SQL. The lock and all-or-none live in the `masters_write_slices` RPC (`for update` at :49). An RPC cannot 'use' a TS file.
  EVIDENCE: apps/web/src/lib/sliceCas.server.ts:34-60; supabase/migrations/20261010220000_masters_write_slices.sql:22-80

- CLAIM: §1 S5 / production-measurements: '~25 `unversioned push accepted (legacy client)` a day' and §4 2.2 acceptance 'the Cloud Run log lines `function-only push by stf_` and `unversioned push accepted` stop'
  TRUTH: `unversioned push accepted` does not exist in origin/main; `mastersRevisionEverywhere.selftest.ts:37` asserts the route no longer contains it, and `masters-desk/route.ts:299` logs `rejected unversioned push`. `function-only push by` is emitted by `lib/deskFeatureGate.server.ts:174`, not by `masters-desk/route.ts`. (The log counts may come from another route or an older revision; the doc attributes them to the wrong file.)
  EVIDENCE: grep -rn 'unversioned push accepted\|function-only push by' apps/web/src

- CLAIM: §4 4.1: '`ensureSchoolMirrorHydrated` call count under `app/api/v1` falls from 200 files to 0'
  TRUTH: 100 files under `apps/web/src/app/api/v1` reference it; 200 is the count across all of `apps/web/src`.
  EVIDENCE: grep -rl ensureSchoolMirrorHydrated apps/web/src/app/api/v1 | wc -l = 100; across src = 200

- CLAIM: §4 2.1: 'the 109 files listed in `evidence/propagation.md` (picker table) and `evidence/read-path.md` (read-once list)'
  TRUTH: The picker table (propagation.md:92-112) lists 17 screens / ~28 file paths; the read-once list (read-path.md:124-140) lists ~25 component names, most without paths. The 109 is a grep total stated in a footnote (propagation.md:114), not a list.
  EVIDENCE: docs/data-layer-rebuild/evidence/propagation.md:92-114; read-path.md:124-140

- CLAIM: §4 1.6 ratchet patterns: '`JSON.parse(readCache(`' and '`fetch("/api/school-data/` in components'
  TRUTH: `JSON.parse(readCache(` occurs 0 times in `apps/web/src`; `fetch("/api/school-data/` occurs in 4 component files. `readCache(` alone is in 71 files.
  EVIDENCE: grep -rn 'JSON.parse(readCache(' apps/web/src | wc -l = 0; grep -rl 'fetch("/api/school-data/' apps/web/src/components | wc -l = 4

- CLAIM: §4 1.3: '`schoolDataMirror.server.ts` `diskPersist` → no-op when NODE_ENV=production'
  TRUTH: No symbol `diskPersist` exists in the file; the disk path is `DATA_FILE` at `schoolDataMirror.server.ts:26` with inline write code. The file is also on the §7.3 frozen (delete-only) list.
  EVIDENCE: grep -n diskPersist apps/web/src/lib/schoolDataMirror.server.ts → only the DATA_FILE line matches '.data/'

- CLAIM: §1 S3: 'Only 8 component files listen to `bhb-masters-updated`'; §4 3.3: '~90 component files that call `loadSis()`'
  TRUTH: 10 files under `components/` reference `bhb-masters-updated` (history.md:50 says 15); 77 files under `components/` + `app/(erp)` call `loadSis(`.
  EVIDENCE: grep -rl bhb-masters-updated apps/web/src/components | wc -l = 10; grep -rl 'loadSis(' components 'app/(erp)' | wc -l = 77

- CLAIM: §4 1.1 / §7.2: the local throwaway DB recipe is enough to 'start `next start` against it'
  TRUTH: `scripts/rehearse-migrations.sh` creates a bare PG17 cluster with role/extension shims and applies migrations (lines 12-96); it starts no PostgREST or auth service. The app only reaches the database through supabase-js at `NEXT_PUBLIC_SUPABASE_URL` (`lib/supabase/server.ts:203-206`; `lib/serverTenant.ts:16-19`); the `pg` dependency is used solely by `postgresPool.server.ts` for BigQuery sync. `supabase/config.toml` holds only `project_id` and `[db]`.
  EVIDENCE: scripts/rehearse-migrations.sh; apps/web/src/lib/supabase/server.ts:203-206; apps/web/src/lib/serverTenant.ts; grep -rl postgresPool.server apps/web/src → bigQuerySync.server.ts and analytics/bigquery-sync/tick only

- CLAIM: §4 3.1: `sis_students` should be 'year-scoped by default' (stated as settled)
  TRUTH: The code the executor edits says the opposite and gives numbers: `registry.ts:95-110` — 'scoping a roster by it would have hidden 442 of 680 active students … a roster query is tenant-wide'. The doc's position matches the newer memory note (31 Aug: one active row per child per year) and production-measurements.md, but the doc never flags the in-code comment as stale.
  EVIDENCE: apps/web/src/lib/data/registry.ts:95-110 vs memory/erp-stale-academic-year-rows.md and evidence/production-measurements.md 'Database facts'

---

# Critic: safety

## verdict
The diagnosis (replica system, no change signal, copies as truth) and the target (server truth, per-screen queries, single-row CAS writes, one versions signal) are right, and the kernel pieces it names do exist. But the plan as written creates a months-long mixed state (Phases 2–5) in which three writers coexist on the same tables — legacy whole-desk pushes from browsers AND from Cloud Run mirror copies, stamped/_rev pushes, and the new row kernel — and several steps delete a legacy accept path or hydrate before the last reader/writer of it has moved. The sharpest live-data hazard is the fee-settlement path (Cashfree webhook → `ensureSchoolMirrorHydrated()` → `pushFeesRemoteServer(loadFees())`): Phase 5 "fees first" converts browser screens while the webhook keeps pushing a 45-s-old whole-desk copy with "ancillary replace / header LWW" semantics, so every counter cheque, day-close, instalment plan or voided receipt written by the kernel can be reverted by the next online payment. The write kernel it builds on (`desk_write_guarded`) today accepts NULL-base updates and deletes, hard-deletes `sis_students` (cascading) on module `edit` alone, bumps no `*_sync_meta`, and the generic GET has no teacher scope; the versions endpoint and `referenceCache` cannot be keyed on `desk_probe` because its allowlist contains none of the `*_sync_meta`, `rbac_desk_slices` or `module_registry_desk_slices` tables (it raises → fail-open → rebuild per request, the 9 Oct 417×400 incident). Phase 0 is mostly sound, but `--labels=commit=$COMMIT_SHA` yields an empty label in the tarball-submitted build, 0.1 as written runs the prod RBAC bootstrap script, and the min-instances cost figure omits memory and the Tier-2 region. Every item below is fixable with server-side ordering and guard changes; none needs client-side merge logic.

## blocking

### COMMAND.md §4 Phase 5 (fees first), §4 1.3 (delete disk mirror), §4 Phase 6 (delete ensure*HydratedServer, schoolMirrorRemote) — vs apps/web/src/lib/paymentSettlement.server.ts:47,152; app/api/payments/{cashfree,razorpay}/webhook, parent-pay, attach-gateway, registration-attach; lib/feePayLink.server.ts, duePayCheckout.server.ts, cashfreeRefunds.server.ts, receiptArchive.server.ts, feesDeskAncillary.server.ts (20 lib files + 12 payments/fees routes read or push the server fee copy); evidence/write-path.md table row 'fees' and §6
- PROBLEM: Online payment settlement records a receipt by hydrating the whole server mirror (45 s TTL) and pushing the ENTIRE fee desk back through the fees-vouchers POST, whose server merge is 'headers upsert last-write-wins, lines append-only, ancillary REPLACE, open-dues rebuild'. Phase 5 converts browser fee screens to row writes but never names the server-side writers. Mixed state: the kernel row-writes a cheque/day-close/instalment plan/voided header; within 45 s a parent pays online; the webhook pushes the pre-write copy and replaces ancillary / reverts the header. This is the same class as the 1 Sep and 6 Sep fee-line wipes, now money-side and server-triggered. Phase 1.3's diskPersist no-op and Phase 6's deletion of ensureFeesHydratedServer/mirror also break settlement outright if the webhook has not been converted first. A receipt (header + lines + tenders + open dues) also spans 3–4 tables and desk_write_guarded is single-table per call, so kernel receipts would not be atomic either — the exact non-transactional shape of the 6 Sep wipe.
- FIX: Reorder Phase 5 fees: (1) PR 5.fees.0 = inventory every server importer of ensureFeesHydratedServer / loadFees / pushFeesRemoteServer / ensureSchoolMirrorHydrated under app/api/payments, app/api/fees, lib/fee*, lib/cashfree*, lib/paymentSettlement (grep counts: app/api/v1 103, ai 19, wa 9, auth 7, payments 5, school-data 4, comms 4, fees 3) — do this as step 1 of EVERY Phase 5 desk; (2) PR 5.fees.1 = one transactional RPC fee_voucher_write(header, lines[], tenders[], base_updated_at) that also upserts fee_desk_open_dues for that student and bumps fee_desk_sync_meta, with service_role grant, rehearsed on the local DB; convert paymentSettlement, parent-pay, attach-gateway, cashgram refunds and the bulk-payment tool to it BEFORE any browser screen; (3) PR 5.fees.2 = fees-vouchers POST stops 'ancillary replace' and 'header LWW': ancillary rows become stamped (storedNewerIds) and a header older than stored is refused; (4) only then convert screens; (5) add an e2e case to the fees acceptance: 'counter receipt row-written, then an online payment webhook from a stale copy — the counter receipt, its cheque and the day-close survive'.

### COMMAND.md §3 R4 and §4 1.5 — vs supabase/migrations/20260810010000_desk_write_guarded.sql and 20260810050000_masters_allowlist_and_guard_defaults.sql (lines 96-116, 138-160: `if base_ts is null then n_unversioned := n_unversioned + 1` for both delete and update; no *_sync_meta statement anywhere), apps/web/src/lib/data/server/repo.ts:228-232, lib/rowStampWrite.server.ts (no sync_meta), lib/sliceCas.server.ts (no sync_meta), app/api/data/[collection]/route.ts:61-77 (GET = module view only), desk_writable_tables seed ('sis_students', false = hard delete) + `references public.sis_students(id) on delete cascade`
- PROBLEM: The inert Stage-1 route that 1.5 wires `useErpMutation` into does not implement R4: (a) a missing/NULL `base` on an existing row is counted as 'unversioned' and APPLIED, for updates and deletes — a client bug or an old build omitting base silently overwrites; (b) `op:'delete'` on sis_students is a hard delete with FK cascades, gated only by `students` module edit (requireStaffPermission, apiRouteAuth.server.ts:151) — one fetch from any students-edit holder removes a child and its dependent rows, no approval rule; (c) neither desk_write_guarded, writeStampedRows nor casWriteSlice bumps `*_sync_meta.updated_at`, so R3's versions signal never fires for kernel writes (the bumps live in the *Normalized.server.ts callers that Phase 6 deletes); (d) `GET /api/data/sis.students` already exists in the registry with no teacher scope — a teacher with students.view can page the whole roster, a regression of the sis-roster teacher branch; (e) 1.5 says 'wired to rowStampWrite.server.ts' while repo.write() calls desk_write_guarded — two CAS mechanisms for row tables would be a third writer, not a kernel.
- FIX: New migration (rehearsed locally, service_role grant) for desk_write_guarded v3: refuse `base` null whenever the row exists (keep null only for op:'insert' on an absent id); add a `sync_meta_table` column to desk_writable_tables and bump it (updated_at + counts) inside the same transaction for every applied op; make deletes on sis_students/sis_households require an `approval` rule in the registry (or soft_delete=true with a deleted_at column); return 409 for unversioned exactly like conflicts. Pick desk_write_guarded as the ONLY row-table writer in 1.5 (drop the rowStampWrite mention; writeStampedRows stays only for legacy routes until Phase 6). Add scope to repo.list(): collections flagged `teacherScoped` run staffSectionScope and add `section_id in (...)`/`household_id =` filters, or keep /api/data/sis.* GET returning 403 for non-school-wide sessions until 3.1 lands. Acceptance for 1.5 must include: 'a write without base is refused', 'a delete needs approve', 'a teacher cannot list sis.students'.

### COMMAND.md §4 1.3 (referenceCache keyed on desk_probe; GET /api/school-data/versions 'probe-cached 2 s' from the 35 *_sync_meta tables), §3 R3, §7.2 'probe-gated response cache' — vs supabase/migrations/20261009090000_desk_probe_transport.sql allowlist (no *_sync_meta table, no rbac_desk_slices, no module_registry_desk_slices, no sis_departments/designations beyond staff, no domain blob tables) and apps/web/src/lib/deskProbeCache.server.ts:23-39 (any RPC error → null → fail-open rebuild every call)
- PROBLEM: As specified, referenceCache('rbac'|'module-registry'|…) and the versions endpoint would probe tables desk_probe refuses; the RPC raises 'not allowlisted', deskProbe returns null, and the cache rebuilds on every request — the 9 Oct incident (417 POST /rpc/desk_probe 400s in one evening, mirror re-pulled on every call) repeated on the hottest path, now also polled every 20 s by every tab and paying resolveApiAuth each time. Separately, R3's premise that every write bumps sync_meta is false today (module_local_state's 29 books incl. fee_holds/visitors/app_popups, domain blobs teaching/salary_setup, sis_staff/departments/designations, masters_desk_settings, attendance policy, and every kernel write per the previous item), so a versions poll built on sync_meta alone would tell screens 'nothing changed' after real changes — a new flavour of stale replica.
- FIX: Add in 1.3 a migration `desk_versions(p_tenant uuid) returns jsonb` (SECURITY DEFINER, service_role-only) that reads updated_at + counts from the 37 *_sync_meta tables named in migrations (verify which exist in prod: grep finds 37 incl. sis_sync_meta, erp_chat, fee_recovery_tasks, purchase, store, staff_chat, wa) plus max(updated_at) over sis_staff, sis_departments, sis_designations, module_local_state (grouped by module key), the *_state blob tables and masters_desk_settings; key referenceCache on that RPC's per-desk value, not on desk_probe; make /versions return ok:false (not {}) when the RPC fails; and make the ratchet in 1.6 refuse any new server write path that does not route through a function that bumps its desk's version. Alternatively extend the desk_probe allowlist by migration — but the RPC approach is one round trip for all 40 signals.

### COMMAND.md §4 2.3 ('delete the four CORE_IDS tasks, CoreDataGate … with every reader on hooks') and §4 1.6 ratchets (count loadMasters( only in components/ + app/(erp)/) — vs apps/web/src/lib: 107 non-selftest files call loadMasters() (lib/fees.ts ×11, lib/exams.ts ×11, lib/sis.ts ×7, lib/payroll.ts, lib/attendance.ts ×2); lib/masters.ts:2049-2053 returns emptyMastersShell() when the memory copy is cold; 15 saveMasters callers outside MastersWorkspace (lib/counterConcession.ts ×3, lib/fees.ts, lib/feeAdjustments.ts, lib/numberSeries.ts, lib/rteEws.ts ×2, lib/referralRewards.ts, lib/staffAttendanceRules.ts, components/staff/StaffProfileForm.tsx ×3, TimetableRulesSetup.tsx)
- PROBLEM: 'Every reader on hooks' is measured by a ratchet that ignores lib/. After 2.3 removes the masters hydrate task, every lib-level reader still on the memory copy (fee heads, fee structures, concessions, late-fee rules in lib/fees.ts; statutoryConfig for payroll; exam schemes) reads the empty shell for the rest of Phases 3–5: Fee Take shows ₹0 dues, receipts print without heads, payroll loses PF/ESIC ceilings — 'unknown became fact' at the counter, the 2026-08-10 class of incident. The counter-side writers (counterConcession, numberSeries, feeAdjustments) would then saveMasters from that empty copy; the unversioned-409 refusal saves the data but the office cannot work.
- FIX: Split 2.3 into 2.3a (delete CoreDataGate's wait, the listeners and events) and 2.3b (delete the hydrate tasks) and gate 2.3b on a NEW ratchet `loadMasters(` and `loadSis(` across ALL of apps/web/src reaching 0. Until then keep one thin adapter, not a merge: useMasters()'s onSuccess calls writeMastersLocalRaw(bundle) (replace, server wins, no localBefore) so lib readers see the same server answer the hooks do; same adapter for useStaffList() → staff slices and for /api/data/students → the SIS copy during Phase 3. Add the 15 non-Masters saveMasters callers to Phase 2.2's brief: each becomes a desk_slice_row_write of its own slice (concessionGrants, numberSeries, specialFees…) or is deleted.

### COMMAND.md §4 2.2 (delete whole-book/section push + function-only branch), 3.3 (sis-roster behind ?export=1), 3.4 (delete saveSis whole-roster push), Phase 5 step 4, Phase 6 — vs evidence/harness.md §5 (UpdateBar reloads only on tap, 15-min poll; sw.js network-first), apps/web/src/components/pwa/UpdateBar.tsx:7-25,92, evidence/mobile-app.md §6 (phones keep the morning's copy until pull-to-refresh)
- PROBLEM: Once 0.3 makes deploys automatic, server accept paths are removed while teachers' tabs opened that morning still run the old bundle and keep POSTing whole desks / section saves and GETting sis-roster without ?export=1. Those requests get 404/400/410: the staff member's edits are lost with at best a toast, and the old build's hydrates fail so its screens go empty mid-day (S2/S5 reproduced by the migration itself). There is no compatibility window anywhere in the plan, and 1.2's X-Bhb-Build header is logged but not acted on.
- FIX: Extend 1.2: the server compares X-Bhb-Build with its BUILD_ID on every POST/PUT and answers 426 {reason:'build_stale', reload:true}; the client fetch wrapper hard-reloads on 426 (and on the next navigation when /api/app-version changes). Only after that is live may any step delete an accept path, and each deletion keeps a 410 stub returning the same 426 body for one release. Add to every Phase 2–5 acceptance a 'stale old-build writer' Playwright case: a context pinned to the previous build's POST shape (whole-desk body from a pre-write copy) must be refused and must not remove or revert the row the kernel wrote — that is the one test that guards the mixed state directly.

### COMMAND.md §4 3.3 ('sis-roster GET stays only for exports and the UDISE robot, behind an explicit ?export=1') and §4 Phase 6 ('24 h Cloud Run shows no /api/school-data/*-desk or sis-roster bulk GETs') — vs 39 files that authenticate via MIRROR_SYNC_SECRET / viaMirrorSecret (apps/web/src/app/api/school-data/{sis-roster,staff-roster,masters-desk,attendance-registers,desk-slice,module-state,domain-blob,homework-desk,exams-desk,ptm-desk,student-leave-desk,events}/route.ts, app/api/v1/udise/robot/teacher-details/apply, app/api/payouts/*, app/api/fees/tools/*, lib/apiRouteAuth.server.ts), scripts/deploy-online.sh (sync-lite-service.sh for school-erp-lite), the nightly BigQuery sync and 3-hourly watch routines (memory: nightly-erp-audit, fee-line restore from BigQuery on 1 Sep)
- PROBLEM: The bulk desk GETs are also the export path used by the lite service, the nightly BigQuery sync (the only disaster-recovery copy that restored 134 receipts' lines on 1 Sep), the watch emails and the UDISE robot (1.4.0 in store review, first live run pending). Gating sis-roster behind ?export=1 and declaring Phase 6 done when no bulk GET appears in 24 h breaks DR and the robot silently (they run at night, outside the 24 h window an executor checks).
- FIX: Insert a step 3.0 (before 3.3) and 6.0 (before Phase 6): enumerate every caller that authenticates with MIRROR_SYNC_SECRET, X-App-Flavor/X-App-Build (Flutter), the Chrome robot's headers, Cloud Scheduler jobs (bhb-*-tick), scripts/ and school-erp-lite; give each an explicit `GET /api/export/<desk>` (service-secret only, paged, probe-cached) before the browser route is gated; keep BigQuery nightly sync green as a named acceptance for 3.3 and Phase 6 ('the 01:30 IST sync and the watch email ran the night after deploy').

### COMMAND.md §4 0.1 and 0.3 — vs scripts/deploy-online.sh:296-304 (`npm run bootstrap:go-live` and `npm run wa:subscribe` run unless SKIP_BOOTSTRAP=1 / SKIP_WA_SUBSCRIBE=1), apps/web/scripts/bootstrap-go-live.mts:66-199 (writes tenants, roles, rbac_state, rbac_desk_slices, profiles, user_role_assignments on PROD), deploy-online.sh:318 (`gcloud builds submit "$ROOT"` = tarball source, no COMMIT_SHA), cloudbuild.deploy-on-merge.yaml deploy step (runs deploy-online.sh, i.e. a NESTED tarball build of cloudbuild.yaml)
- PROBLEM: 0.1 as written ('Run scripts/deploy-online.sh from a clean git archive export') contradicts the executor header 'Never run apps/web/scripts/*.ts': the script runs the prod RBAC bootstrap (benign only because a git-archive export has no node_modules; from a real checkout it rewrites rbac_desk_slices/user_role_assignments under the new #574–#577 role model). 0.3's `--labels=commit=$COMMIT_SHA` on the `gcloud run deploy` step of cloudbuild.yaml will always produce `commit=` (empty): $COMMIT_SHA is only populated for trigger-sourced builds, and both the manual deploy and the trigger's own nested `gcloud builds submit` are tarball-sourced. The plan's §7.1 'first check' and §5 'live revision traceable to a commit' then never work.
- FIX: 0.1: `SKIP_BOOTSTRAP=1 SKIP_WA_SUBSCRIBE=1 DEPLOY_SA_KEY=/nonexistent bash scripts/deploy-online.sh` from the export with .env.local copied in (the trigger already sets the first three). 0.3: add `_COMMIT_SHA: ""` to cloudbuild.yaml substitutions; deploy-online.sh passes `_COMMIT_SHA=${COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}`; in cloudbuild.deploy-on-merge.yaml's deploy step `export COMMIT_SHA=$COMMIT_SHA` (the outer build has it); label `--labels=commit=${_COMMIT_SHA}` and also write it to a COMMIT file the image serves from /api/app-version. Verify with `gcloud run revisions describe <rev> --format='value(metadata.labels.commit)'`.

### COMMAND.md §4 1.1 ('starts next start against it') and §6 rule 4 — vs apps/web/.env.local (= production, memory local-dev-must-not-write-prod), apps/web/src/lib/supabase/server.ts:59-69,212 (prodWriteGuard: writes throw unless ALLOW_LOCAL_PROD_WRITES=1; reads pass), .github/workflows/ci.yml:642-644 (placeholder Supabase env only — good)
- PROBLEM: A developer running the Playwright suite on the Mac gets `next start` reading .env.local, i.e. production: reads and logins hit prod, the propagation/conflict specs' writes are refused by the guard (confusing red), and the first person who 'fixes' it with ALLOW_LOCAL_PROD_WRITES=1 runs 'two contexts edit the same subject' against the live Masters. The plan names the local DB recipe but not the enforcement.
- FIX: scripts/e2e-db.sh writes apps/web/.env.e2e and starts `next start` with ONLY that file (`env -i` + explicit vars, or dotenv-cli -e .env.e2e), never .env.local; the e2e global-setup asserts NEXT_PUBLIC_SUPABASE_URL and the service URL point at 127.0.0.1 and aborts otherwise; CI keeps zero production secrets in the e2e job (ci.yml today has only placeholders — add a check that fails if any secret named *SERVICE_ROLE* is present). Add this to §6 as rule 4b.

## improvements

### COMMAND.md §4 0.2 (min-instances=1; 'removes most of the 126 cold rebuilds'; cost) — vs cloudbuild.yaml --cpu=1 --memory=2Gi --concurrency=20 --cpu-throttling; evidence/server-cost.md §2 and §8 (mirrorLooksEmpty TTL bypass; chat route comment: disk file overwrote in-memory masters with nothing and the 45 s TTL kept returning it)
- PROBLEM: Idle min instances are billed for CPU AND memory under request-based billing and asia-southeast1 is a Tier-2 price region, so 1 vCPU + 2 GiB warm all month is roughly US$20–27, not 8–10 (still worth it). One warm instance removes idle-gap cold starts only: with concurrency 20 a sign-in burst (the 29 Sep freeze) still spins cold instances, and every deploy's new revision starts cold — '63 distinct instance ids' will not fall to 1. A permanently warm instance also makes today's per-process failure states (empty mirror re-hydrate loop, stale 30 s masters cache, disk snapshot overwriting good memory) persist until the next deploy instead of healing on the next cold start.
- FIX: State the cost as ≈US$20–27/month and the gain as 'idle-gap cold starts' only; land 1.3's diskPersist no-op + a memoised ensureSchoolMirrorLoaded + 'never cache readFailed' in loadServerMasters in the same deploy as 0.2 (or the next one), so a warm instance cannot hold a poisoned copy for a day; consider --min-instances=2 during 08:00–15:00 via Cloud Scheduler if bursts dominate.

### COMMAND.md §4 0.3 (trigger on every push to main) — vs scripts/setup-deploy-on-merge.sh step 6 (`--branch-pattern='^main$'`, no --included-files), scripts/deploy-online.sh:330-354 (two extra `services update` → 4 revisions per deploy), evidence/harness.md §7
- PROBLEM: Every merge — including docs-only PRs like this COMMAND.md — becomes a school-hours deploy that evicts warm instances and creates 4 revisions; a manual deploy running concurrently with a trigger build races on `update-traffic --to-latest`. The smoke test (reviewer OTP + /login) does not open an ERP screen, so a deploy that empties classes passes.
- FIX: Create the trigger with `--included-files='apps/web/**,packages/**,cloudbuild*.yaml,deploy/**,supabase/**,scripts/deploy-online.sh'`; fold the desk-cutover and BigQuery env updates into the single `run deploy` (static committed values) so a deploy is one revision; after 0.3, forbid manual deploy-online.sh runs (document in §7.1); add `curl /api/school-data/versions` (once 1.3 exists) and a staff-login-count check to the smoke step so rollback triggers on an empty-school revision.

### COMMAND.md §3 R4 / §4 1.5 desk_slice_row_write(desk, slice, row, base_rev) — vs apps/web/src/lib/mastersNormalized.server.ts:14-55 (MASTERS_OBJECT_SLICES midYearFeePolicy/schoolProfile/schoolTiming/statutoryConfig; 25 array slices incl. 'students' projection and the staff-owned staff/departments/designations), lib/sliceRevMerge.ts (_rev integer per element for transport/trust + 13 desk-slice modules), supabase/migrations/20261010220000_masters_write_slices.sql (masters versions are slice-level updated_at, no per-element _rev), mastersNormalized.server.ts:177-187 (counts update + masters_sync_rows_from_slices after every slice write), evidence/write-path.md §5 (5 s probe cache serves the pre-save body)
- PROBLEM: One generic RPC spec covers three incompatible shapes: masters slices (element has no _rev; the base is the slice's updated_at), _rev desks (element _rev integers that sliceRevMerge compares and increments), and object slices with no elements. 'Replaces one element by id' assumes every element has a stable id (verify classSubjects links, holidays, feeStructureLines, concessionGrants). If the RPC does not also run masters_sync_rows_from_slices + the counts update, the masters_desk_* row tables (Stage-2 registry collections, MASTERS_READ_FROM_ROWS path) silently diverge; if it does not bump the slice updated_at, legacy masters_write_slices section saves from older builds pass their base check and overwrite the kernel's element.
- FIX: Specify two RPCs and their base semantics explicitly in 1.5: desk_slice_row_write(desk, slice, element, base) where for masters base = the slice updated_at the client loaded (locks the slice row, refuses if moved, replaces/inserts/deletes the element by id, writes a new slice updated_at AND the element's own updated_at), and for _rev desks base = the element's _rev (increment exactly as sliceRevMerge does); desk_slice_object_write(desk, slice, value, base_updated_at) for the four object slices and the desk-slice modules' objectSlices; both bump <desk>_sync_meta and, for masters, call masters_sync_rows_from_slices + the counts update; the route calls clearDeskProbeCaches()/bumps the probe key after a write so the 5 s response cache cannot serve the pre-write body. Add 'element without id' to the local-DB rehearsal.

### COMMAND.md §4 3.1 ('year-scoped by default (one row per child: the 717-row table holds 4 academic years)') and §4 1.1 fixtures ('250 students in 2026-27') — vs apps/web/src/lib/data/registry.ts:94-111 (academic_year_code records creation/import year; scoping by it hid 442 of 680 active students on 2026-08-10) and memory erp-stale-academic-year-rows (rows with no academicYearCode are KEPT; dedupe on admission no AND name; helpers studentsInSession/childrenOfHousehold; dueKey-resolving callers must stay unscoped)
- PROBLEM: A naive `WHERE academic_year_code = :ay` in /api/data/students reproduces the 10 Aug 'data loss' (hundreds of current children vanish) while a naive unscoped query double-counts (the ₹62,050-for-₹10,500 receipt). The seeded fixture has one clean row per child and cannot catch either.
- FIX: 3.1 encodes the existing rule server-side (studentsInSession semantics: prefer the session-year row, else newest, keep year-less rows, dedupe admission_no+name; `?ay=all` for exports; dueKey resolvers unscoped) and documents it in the endpoint; 1.1 fixtures must mirror production shape: 30 % of children with 2–4 per-year rows, some rows with blank academic_year_code, duplicate admission numbers for different names, placeholder 0000000000 mobiles, an all-inactive household, a teacher whose only link is the timetable.

### COMMAND.md §4 1.3 (readFailed handling only for referenceCache) and §4 Phase 4 — vs apps/web/src/lib/api/v1/auth.ts:189-224 (readFailed ignored, empty bundle cached 30 s; catch → defaultMasters() with random ids), lib/api/v1/staffScope.ts:77-121 (sections derived from ctx.masters → empty masters = empty scope), app/api/school-data/sis-roster teacher branch (returns [] ok:true), evidence/hydration.md §2-3
- PROBLEM: The mobile S5 hazard and the web teacher-scope collapse (empty masters → zero sections → roster [] with 200 → accepted as fact on a fresh page) are left until Phase 4/6 although 1.3 builds the exact primitive that fixes them. The demo-masters fallback is also a correctness hazard for RBAC (roles resolved by regex on random ids).
- FIX: In 1.3, switch loadServerMasters and loadServerRbac to referenceCache (previous value kept on failure, 503 when there is none, never defaultMasters() on a configured tenant) and make the sis-roster teacher branch answer {ok:true, scoped:true, sections:[], students:[]} or 503 so the client can distinguish 'no sections' from 'unknown'. Add to teacher.spec.ts: 'masters read forced to fail → teacher sees retry, never an empty school'.

### COMMAND.md §4 2.2 (delete the function-only push branch) and §4 2.1/2.3 — vs apps/web/src/components/timetable/TimetableRulesSetup.tsx:413-425 (SubjectRulesPanel periods/week → saveMasters), lib/masters.ts:2157-2164 (every saveMasters also scheduleStaffSync(state)), masters-desk/route.ts:108-118 (teachers get teachingMastersResponse on 403)
- PROBLEM: The one legitimate function-only writer (periods/week on the Timetable page) loses its save path when the branch is deleted; the staff slice push that rides on saveMasters is dropped with it before the Staff desk is converted (Phase 5 'staff HR'); and useMasters() for a teacher must still receive the teaching subset (the 29 Sep incident: every teacher saw 'Select class…' empty on a 403).
- FIX: 2.2's brief: convert SubjectRulesPanel to desk_slice_row_write(classSubjects element) under the class_subjects function grant in the same PR; move staff (sis_staff is already a stamped row table) into Phase 2 with useStaffList() + useErpMutation so scheduleStaffSync can go with saveMasters; 1.4 acceptance adds 'teacher login: useMasters() returns classes/sections/subjects (teaching subset), no fee heads, no 403'.

### COMMAND.md §4 4.3 (WhatsApp webhook off the request path via Cloud Tasks or /api/wa/process self-call) — vs cloudbuild.yaml --cpu-throttling (no CPU after the reply), lib/serverWorkTracker.server.ts (reply held ≤25 s), memory erp-wa-webhook-redelivery (Meta re-sent → triple processing), 14 lib/wa*.ts files that read the mirror (waUnifiedBotServer.ts:2297 etc.)
- PROBLEM: With cpu-throttling, anything started after the 200 gets no CPU, so a 'self-call' must be a fully accepted enqueue before the reply; Meta re-delivers when it sees no 200, so a fast ack without idempotency turns the current triple-processing into a guaranteed duplicate; and the bot's 14 mirror readers are not inventoried, so 'bot replies unchanged in the WA self-tests' cannot be proven by self-tests that never ran a real inbound.
- FIX: 4.3 brief: Cloud Tasks (or a durable row in a wa_jobs table claimed by /api/wa/process) with the Meta message id as the idempotency key; the webhook inserts the row and returns 200 only after the insert commits; the processor is a separate request with its own 25 s budget; list the 14 lib/wa*.ts mirror readers and convert them to referenceCache + per-household queries in the same phase; acceptance includes the existing NOT_IN_SUITE wa-webhook live test against the local DB.

### COMMAND.md §0 bullet 4 / §4 0.4 / §7.3 (frozen files, delete-only until Phase 6) — vs §4 1.3 which modifies schoolDataMirror.server.ts (diskPersist no-op), and the incident cadence in evidence/history.md (a data-loss bug a week)
- PROBLEM: The freeze has no hotfix path and 1.3 itself violates it. The next production wipe discovered in a frozen file (likely, given 16 PA incidents) will either be left live or fixed by breaking the rule silently.
- FIX: Add an explicit exception: 'a change to a frozen file is allowed only to (a) delete code, (b) make a path a no-op, or (c) stop a verified production data loss, with the director named in the PR and a Playwright regression spec added in the same PR'.

### COMMAND.md §4 1.5, 3.1, 4.1 (principal_snapshot SQL function), the versions RPC, fee_voucher_write — vs memory erp-class-gallery ('migration BEFORE deploy; merge ≠ deploy'), erp-supabase-new-table-grant ('every new table/function needs explicit service_role grant')
- PROBLEM: The plan never says who applies migrations to production or in what order relative to the auto-deploy that 0.3 creates; a merge that deploys code calling an RPC that does not yet exist fails every write on that path (and, if the code falls back to the legacy push, silently reintroduces whole-slice writes).
- FIX: §6 rule 8: 'A step that adds a migration names it in the PR title; the director applies it to production (Supabase MCP apply_migration or CLI) and confirms before merging; the code fails closed with ok:false + a logged error when the RPC/table is missing — never a fallback to a whole-desk push.' Add `supabase/migrations` drift to the smoke step (compare list_migrations with the repo).

### COMMAND.md §4 1.2 (POST /api/client-metrics via sendBeacon, 1-in-5)
- PROBLEM: An unauthenticated beacon endpoint on the same 1-vCPU service can be spammed and bloats Cloud Logging; without a session it also cannot attribute 'rendered-zero-rows' to a role (teacher vs office), which is the signal that matters for S2/S5.
- FIX: Require the session cookie (sendBeacon sends cookies), cap body at 2 KB, rate-limit per session, include persona/role and build; keep the server work to one structured log line.

### COMMAND.md §1 facts table / §4 Phase 5 ordering ('attendance second because it is 7,904 DB reads a day') — vs evidence/production-measurements.md (7,904 attendance_desk_marks reads are SERVER hydrates: parent/attendance, principal/snapshot, i.e. Phase 4 routes)
- PROBLEM: The attendance desk's browser conversion (Phase 5) will not remove those reads; Phase 4.1 (per-student marks query) does. Ordering by the wrong cause spends 2–3 sessions for no measured gain.
- FIX: Keep Phase 4.1 as the owner of the 7,904 number (its acceptance already targets it); order Phase 5 by browser bytes and wipe history instead: fees → homework (two wipes, whole-desk unversioned, server-side homeworkPost.server.ts rebuilds from the mirror) → attendance → exams.

## factual errors

- CLAIM: §4 0.2: 'Cost ≈ US$8–10/month idle' for --min-instances=1
  TRUTH: Idle min instances under request-based billing (--cpu-throttling) are charged for both vCPU and memory per second; the service is 1 vCPU + 2 GiB in asia-southeast1 (a Tier-2 price region), so a month idle is roughly US$20–27 after the free tier — still cheap, but 2–3× the figure in the plan.
  EVIDENCE: cloudbuild.yaml deploy step: --cpu=1 --memory=2Gi --cpu-throttling; evidence/production-measurements.md 'Service shape | 1 vCPU, 2 GiB … cpu-throttling on'; Cloud Run idle-instance pricing lists separate per-second vCPU and GiB rates with a Tier-2 multiplier for asia-southeast1.

- CLAIM: §4 0.3: 'add --labels=commit=$COMMIT_SHA to the gcloud run deploy step so a revision names its commit'
  TRUTH: $COMMIT_SHA is populated only for builds started by a trigger from a connected repository. Both the manual deploy (gcloud builds submit of a tarball) and the deploy-on-merge trigger (which runs deploy-online.sh, i.e. a NESTED tarball `gcloud builds submit --config cloudbuild.yaml`) leave it empty, so the label would be `commit=` on every revision.
  EVIDENCE: scripts/deploy-online.sh:318 `gcloud builds submit "$ROOT" --config="$ROOT/cloudbuild.yaml"`; cloudbuild.deploy-on-merge.yaml deploy step `bash scripts/deploy-online.sh`; evidence/harness.md §1 'source = storage tgz; no TRIGGER_NAME/COMMIT_SHA'.

- CLAIM: §3 R3: 'Every server write already bumps its *_sync_meta.updated_at; a write that does not is a bug.'
  TRUTH: The three primitives the plan builds the kernel on bump nothing: desk_write_guarded (both migrations), writeStampedRows (rowStampWrite.server.ts) and casWriteSlice (sliceCas.server.ts) contain no sync_meta statement; the bumps live in the *Normalized.server.ts push functions that Phase 6 deletes. module_local_state (29 books), domain blobs, sis_staff/departments/designations and masters_desk_settings have no sync_meta at all.
  EVIDENCE: supabase/migrations/20260810010000_desk_write_guarded.sql and 20260810050000 (grep sync_meta → none); apps/web/src/lib/rowStampWrite.server.ts, lib/sliceCas.server.ts (none); grep 'sync_meta' upserts found only in lib/*Normalized.server.ts (31 sites); lib/moduleLocalState.server.ts:33-45 unconditional upsert (evidence/write-path.md §12).

- CLAIM: §4 1.3: referenceCache 'keyed on desk_probe of the named tables — the existing deskProbeCache.server.ts primitive', and the versions endpoint 'probe-cached 2 s' from the *_sync_meta tables
  TRUTH: desk_probe's allowlist contains none of the *_sync_meta tables, rbac_desk_slices or module_registry_desk_slices; an unlisted table makes the RPC raise, deskProbe returns null and the cache fails open (rebuild every call). The probe memo is 5 s, not 2 s.
  EVIDENCE: supabase/migrations/20261009090000_desk_probe_transport.sql allowlist (33 tables; masters_desk_slices and sis_staff are in, rbac/module_registry/*_sync_meta are not); apps/web/src/lib/deskProbeCache.server.ts:17 PROBE_MIN_INTERVAL_MS = 5_000 and :30-38 fail-open; same migration's header describes the 417×400 fail-open incident.

- CLAIM: §4 3.1: students are 'year-scoped by default (one row per child: the 717-row table holds 4 academic years)' as though academic_year_code identifies the current child row
  TRUTH: sis_students.academic_year_code is the year the row was created/imported and was never advanced for many children; scoping by it hid 442 of 680 active students on 2026-08-10. The project's rule since 13 Sep is: prefer the session-year row, else the newest, KEEP rows with no year, dedupe on admission number AND name, and never scope dueKey resolvers.
  EVIDENCE: apps/web/src/lib/data/registry.ts:94-111 (the comment that reverted the scope); memory erp-stale-academic-year-rows (PR #197/#198, helpers studentsInSession / childrenOfHousehold, test:session-scoped-students).

- CLAIM: §4 1.3 / §7.2: 'the 35 *_sync_meta tables'
  TRUTH: 37 distinct *_sync_meta tables are created in supabase/migrations (incl. sis_sync_meta, erp_chat, fee_recovery_tasks, purchase, store, staff_chat, wa); production-measurements counted 35 in the live DB. The versions endpoint must be built from the live catalog (pg_catalog query) rather than a hand-typed list of 35, or two desks will never signal.
  EVIDENCE: grep -ho 'public\.[a-z_]*_sync_meta' supabase/migrations/*.sql | sort -u → 37; evidence/production-measurements.md 'Database facts' → 35.

- CLAIM: §4 0.1 executor header: 'Never run apps/web/scripts/*.ts (they write production)' while 0.1 instructs 'Run scripts/deploy-online.sh'
  TRUTH: deploy-online.sh runs `npm run bootstrap:go-live` (apps/web/scripts/bootstrap-go-live.mts: writes tenants, roles, rbac_state, rbac_desk_slices, profiles, user_role_assignments on production) and `npm run wa:subscribe` unless SKIP_BOOTSTRAP=1 and SKIP_WA_SUBSCRIBE=1 are set; it only fails harmlessly in a git-archive export because node_modules is absent.
  EVIDENCE: scripts/deploy-online.sh:296-304; apps/web/package.json:471-472; apps/web/scripts/bootstrap-go-live.mts:66-199; memory erp-production-deploy ('bootstrap:go-live always fails in a git archive export with ERR_MODULE_NOT_FOUND … only matters if run from the real checkout').

---

# Critic: completeness

## verdict
The verdict (§1) is well supported: every mechanism in the six rows traces to a file:line in the evidence and I re-verified the load-bearing ones in code (live mastersPersistence localBefore merge, masters-desk route dropping readFailed at route.ts:176-188, auth.ts:222 returning defaultMasters(), timetable.ts:471 empty on the server, 109 loadMasters files, 13 ensureMastersHydrated callers, 66 readFileSync self-tests, 47 persistence files). The incident-history argument (98 fixes, 66 % follow-ups, three identical snapshot-before-await fixes) is the document's strongest and most honest part. Where it slips is §5: four of the twelve "Today" numbers are not in any evidence file and two of them cannot have been measured (there is no per-page byte/request capture and no client telemetry, as harness §4 states), the whole-roster-read count and "all saves are whole-desk" are overstated, and "12,682 → 0" contradicts Phase 6's own keep list. The plan omits a Phase 0 for the three one-line, unfrozen fixes the evidence hands it (503 on readFailed, no defaultMasters() fallback, conflict reloads one desk), freezes the files that hold the ensureAllDeskHydrated storm for months with no exception process, assigns the home dashboards and the universal search bar to no phase, double-assigns the teacher-scope fix to two phases it allows in parallel, and specifies a versions endpoint and a write contract that collide with what already exists (desk_probe allowlist has no sync_meta tables; /api/data/[collection] takes {ops}). §2's "needs CRDTs" dismissal is rhetorical — the plan itself keeps server-wins read copies (R2, R5); the real reason the replica cannot be "fixed properly" is that multi-MB whole-desk GETs and per-request server rebuilds (S4, S6) are intrinsic to it, and the document should say that instead. The director will still not know which complaint goes away after which phase, or why 0.2 reverses a cost decision recorded in cloudbuild.yaml:142-150.

## blocking

### §5 rows 3–5 ("Bytes downloaded … 3.6 MB / 2.7 MB / 1.5 MB", "API requests to open a page 21–34", "Data visible on a phone 3–9 s") and §1 S4
- PROBLEM: None of these appear in evidence/production-measurements.md or any lens; harness §4 and read-path open-questions state explicitly that no per-page byte/request capture and no client timing exist. Summing deskHydrationSchedule.ts:46-78 ROUTE_IDS (students = CORE sis 1,903 + masters 235 + rbac 37 + fees 1,482 + attendance 685 + payments + staff 148 via useAccessData) gives ≥4.4 MB for /students, not 2.7 MB, and ≈3.1 MB for /attendance, not 1.5 MB. A column headed "Today (12 Oct)" presenting estimates as measurements is the exact 'unknown became fact' class the document condemns.
- FIX: Mark each estimated cell as 'estimated from route lists; first measured by budget.spec in 1.1' or drop it, and show the arithmetic once (route ids × measured avg bytes). Replace '3–9 s' with 'not measured; 1.2 beacon will give it'.

### §0 freeze / §7.3 vs hydration §5, write-path §4 (sliceRevClient.ts:180-195, rowStampClient.ts:124-135, sisNormalizedClient.ts:250-257)
- PROBLEM: Every row conflict re-downloads every desk (~5 MB, ~45 requests) and clears the tab-wide in-flight map. All three files are frozen 'delete-only' until Phase 6 (10–15+ sessions away), and narrowing ensureAllDeskHydrated() to one desk is a modification, not a deletion, so the plan forbids the single cheapest S4 relief for months. There is also no incident-exception process: the next production wipe mid-rebuild has no sanctioned fix path.
- FIX: Add Phase 0.5 'surgical, delete-shaped interim fixes' with an explicit named allowlist: (a) conflict handlers call resetDeskHydrated(module)+ensure<Module>Hydrated only; (b) masters-desk/route.ts:176-188 returns 503 on readFailed (file is not frozen); (c) lib/api/v1/auth.ts:222 keeps the last cache or throws instead of defaultMasters(); (d) principalSnapshot in-flight dedupe. State the exception rule: a production data-loss incident may touch frozen files with the director's written OK and a note in COMMAND.md.

### §6 rule 5 ('a new TTL … stop') vs §4.1 ('cache its result per process for 30 s'), §4 step 1.3 referenceCache, R2 staleTime 60 s, R5 per-process cache
- PROBLEM: The executor rules forbid what three steps and two architecture rules prescribe. An executor doing 4.1 will either refuse the step or ignore rule 5; both outcomes are what the document is trying to prevent.
- FIX: Reword rule 5: 'Do not add a guard, merge function or client-side copy. Server-side caches must be keyed on *_sync_meta.updated_at (never a wall-clock TTL alone) and live in lib/data/*; React Query staleTime is the only client TTL.'

### §4 step 1.1 (seeded local DB from 'the throwaway local PG17 + Supabase shim') and CI job e2e
- PROBLEM: scripts/rehearse-migrations.sh is a macOS Homebrew script (PGBIN=/opt/homebrew/…, LC_ALL=C for macOS, nc port walk) whose 'shim' is SQL objects only. The app reads through supabase-js over PostgREST (sb.from(...)), so `next start` against bare Postgres fails on the first request. Nothing in the repo provides PostgREST or a service_role JWT for CI. Also, the step requires the job to FAIL on today's code for propagation and budget; if the e2e job is a required check, every unrelated PR is blocked (automerge label needs green CI) and the executor will be pushed to 'weaken the test' — the thing rule 2 forbids.
- FIX: Specify the CI substrate: postgres:17 service container + a postgrest container (or `supabase start`), migrations via the rehearsal SQL, SUPABASE_URL pointed at PostgREST, a locally minted service_role JWT; or a fetch-level fake of PostgREST. Declare the e2e job 'continue-on-error per spec' with a scoreboard file until each spec is green, then flip it to required spec by spec.

### §3 R3 ('Every server write already bumps its *_sync_meta.updated_at'), R5 (keyed on sync_meta.updated_at) vs §4 step 1.3 ('keyed on desk_probe of the named tables', 'probe-cached 2 s')
- PROBLEM: Three defects: (1) desk_probe's allowlist (supabase/migrations/20261009090000_desk_probe_transport.sql:19-37) contains no *_sync_meta table and raises on any other name, so 1.3 as written throws on its first call; a migration (+ the explicit service_role grant gotcha) is required and not mentioned. (2) write-path table shows staff writes bump only sis_staff.updated_at (1.3 covers this), but module_local_state's 29 books and the *_state domain blobs bump only their own row — neither is in the versions payload, so fee_holds, complaints, visitors, teaching, salary setup never invalidate. (3) R3/R5 say sync_meta is the key; 1.3 says desk_probe of named tables — the latter is the primitive whose incomplete table lists already serve stale fees/attendance ancillary (write-path §5).
- FIX: Make the signal source one SQL view/RPC `erp_versions(tenant)` that unions every *_sync_meta, max(updated_at) of sis_staff, module_local_state per module key, and each *_state blob; drop desk_probe from 1.3; add the migration and grant to 1.3's acceptance.

### §3 R4 and §4 step 1.5 ('POST /api/data/<collection> with {row, baseUpdatedAt}', 'the inert Stage-1 route')
- PROBLEM: apps/web/src/app/api/data/[collection]/route.ts already exists with a different contract — body `{ ops: WriteOp[] }`, a collection registry (lib/data/registry), an approval gate and a repo layer — and its header explicitly forbids whole-state bodies. An executor told to 'wire the inert route' to a {row, baseUpdatedAt} shape will either fork the contract or rewrite the registry; the two documents (this and lib/data/types.ts) will disagree.
- FIX: Adopt the existing `{ops: WriteOp[]}` contract and `Revision` brand in R4 and 1.5 (one op = one row with base revision), or state in 1.5 that the Stage-1 route is replaced and list what is deleted.

### §4 step 3.1 ('timetable rows read from timetable_desk_slices on the server') and step 4.2 ('staffSectionScope computes sections from … timetable_desk_slices rows'); §4 Phase 4 header ('can run in parallel with Phase 3')
- PROBLEM: The same fix to lib/api/v1/staffScope.ts:77-96 is assigned to two steps in two phases the document allows to run concurrently with different executors — a guaranteed merge conflict on the one function both symptoms depend on.
- FIX: Make the server-side timetable scope its own step (e.g. 1.7 or 3.0, before both), acceptance = teacher.spec.ts; have 3.1 and 4.2 depend on it.

### §4 step 0.1 ('clean git archive origin/main export') and evidence/history.md open question (api/inventory/assets/route.ts absent from the live tarball)
- PROBLEM: The cause is .gcloudignore:13 `assets/`, which excludes apps/web/src/app/api/inventory/assets/ from every `gcloud builds submit` upload (scripts/deploy-online.sh:318). `git archive` does not bypass .gcloudignore, so 0.1 re-ships a build in which /api/inventory/assets 404s, and the document leaves the evidence's open question unanswered while prescribing the deploy.
- FIX: In 0.1: change the ignore to `/assets/` (or `public/assets/`) and add `!apps/web/src/**` guard; verify with `gcloud meta list-files-for-upload | grep inventory/assets` before submitting.

### §4 Phases 2–5 (no step names SchoolHomeDashboard, PrincipalCockpit, TeacherHome, ModuleDashboardHost, UniversalSearchBar)
- PROBLEM: read-path §5–§6 and hydration §7 locate the heaviest per-interaction CPU on exactly these: UniversalSearchBar.tsx:101-243 parses masters+sis+fees+admissions per keystroke on every page; SchoolHomeDashboard runs listLiveDefaulters = 713× loadTransport() per tick; PrincipalCockpit refetches the 5 s snapshot on 5 triggers with no in-flight dedupe; ModuleDashboardHost fires open-dues-summary + inventory/sales per bhb-* event (1,559 + 1,578 calls/day). Phase 5 enumerates desks, not dashboards; 2.1/3.3 convert only the masters/sis reads, so the fees/admissions parse per keystroke and the transport loop survive to Phase 5's fees/transport desks.
- FIX: Add a Phase 3.5 'Home & shell': GET /api/data/search?q= (server search, ≤ 40 hits), GET /api/data/home-kpis (defaulters tile from fee_desk_open_dues), PrincipalCockpit on useErpQuery with one key, ModuleDashboardHost figures on one query per desk; acceptance = budget.spec for /home and a keystroke-cost assertion.

## improvements

### §2 'Why another round of guards cannot end it'
- PROBLEM: The argument says convergence 'needs a real synchronisation engine (server-driven subscriptions or CRDTs)'. The plan itself keeps four whole-desk read copies in the browser (R2 useMasters/useStaffList/useRbac/useModuleRegistry) and per-process copies on the server (R5 referenceCache) and converges them with a 20 s versions poll — no CRDT. The cheaper path the evidence's own FIX HINTs describe (versions poll + one useDesk hook + memoised parse + conflict reloads one desk + server TTL/probe on ensure*HydratedServer + write-time reads) would cure S1/S3/S5; what it cannot cure is S4/S6, because multi-MB whole-desk GETs and per-request server rebuilds are intrinsic to holding modules whole. That is the honest reason and it is not stated. 'Nothing here needs offline copies' is also an assumption about teachers on mobile data, not evidence.
- FIX: Rewrite §2 as: (1) copies may exist only if read-only, server-wins, invalidated by one signal and never pushed back (which is what R2/R5 are); (2) Phases 1–2 are that cheaper path and fix S1/S3/S5; (3) S4/S6 are size and per-request cost, which no invalidation fixes, hence Phases 3–6; (4) label the no-offline assumption and state the R6 behaviour on a flaky network.

### §1 S4 ('126 cold starts a day'), §4 step 0.2 ('126 cold rebuilds'), §1 S6 ('63 instances a day')
- PROBLEM: production-measurements.md says 126 startup-probe LINES and 63 distinct instance ids; a start logs more than one probe line. The document uses both numbers as if they were different facts.
- FIX: Use 63 cold starts (instances) everywhere; cite the probe-line count only as the raw measure.

### §1 S6 and §5 row 8 ('Supabase sees 3,525 full roster reads', 'Server whole-roster reads per day 3,525')
- PROBLEM: 3,525 is the edge-log count of all GETs on the sis_students path (paged reads, single-student lookups, parent OTP, etc.). pg_stat_statements in the same file gives ≈77,000 whole-tenant selects since the 12 Aug reset ≈ 1,260/day. The 'Done' cell '0 (reference cache: ≤ instances × changes)' also contradicts itself.
- FIX: Quote both numbers with their source; set Done = '≤ instances × sync_meta changes per day, measured by the pg_stat_statements query in production-measurements.md', not 0.

### §5 row 9 ('Whole-desk POSTs from browsers per day: all saves')
- PROBLEM: write-path's per-desk table shows masters sends only changed sections and 13 stamped desks (staff, admissions, attendance, staff-attendance, exams, accounts, ptm, library, payroll, vault, statutory, rte) send changed rows + stamps. The whole-desk set is sis, fees, homework, comms/notifications/student-leave, payments, timetable, blobs, module-state, 13 desk-slice modules.
- FIX: Replace 'all saves' with 'sis, fees, homework, payments, timetable, comms, notifications, student leave, 29 module books, 13 slice modules (write-path table)' so the ratchet in 1.6 has a real baseline.

### §5 row 10 ('Replica-consistency code in lib/ 12,682 lines → 0') vs §4 Phase 6 ('Keep: rowStampWrite.server.ts, sliceCas.server.ts, deskProbeCache.server.ts, pageAll.ts'; 'lib/ shrinks by ≥ 12,000 lines')
- PROBLEM: harness.md's 12,682 count includes rowStampWrite.server.ts (118), sliceCas.server.ts (81), deskProbeCache.server.ts (155) that Phase 6 keeps; the two sections disagree.
- FIX: Done = '≤ 400 lines (the four kept server primitives); the rest deleted'; make Phase 6's acceptance quote the same number.

### §4 step 4.1 acceptance ('ensureSchoolMirrorHydrated call count under app/api/v1 falls from 200 files to 0')
- PROBLEM: grep -rl over src/app/api/v1 gives 100 files, not 200.
- FIX: State 100 (and have the executor record the live count in the ratchet line).

### §4 step 1.6 ('loadSis( (today ~90)'; 'Add to scripts/ratchets.txt')
- PROBLEM: 77 files in components + app/(erp) call loadSis(. Also scripts/check-ratchets.sh defines each metric in a `case` block in the script (lines 31-160); ratchets.txt only carries the budget, so new metrics need script edits too.
- FIX: Use the measured counts and say 'add a case to check-ratchets.sh and a line to ratchets.txt per metric'.

### §1 S3 ('Only 8 component files listen to bhb-masters-updated') and §1 S4 ('484 + 430 call sites')
- PROBLEM: The three lenses disagree (8 / 9 / 10 listeners; 277+226 vs 484+430 call sites) because they count different things. grep today: 10 files contain the string, 8 addEventListener literals; 476 loadMasters( and 426 loadSis( occurrences excluding selftests and definitions.
- FIX: Pick one unit per number (files vs literals; occurrences vs files) and state it; executors will re-grep and distrust the document if the numbers do not reproduce.

### §4 step 0.2 ('Cost ≈ US$8–10/month idle')
- PROBLEM: cloudbuild.yaml:142-152 records that min-instances was deliberately set to 0 because a warm instance was 'the largest single line on the GCP bill'. The director will remember; the document does not acknowledge the earlier decision or explain why the arithmetic differs now (1 vCPU, --cpu-throttling, idle rate).
- FIX: Cite the comment and show: idle vCPU-s and GiB-s rates for asia-southeast1 × 1 vCPU × 2 GiB ≈ US$9–11; contrast with the old 2 vCPU un-throttled line; keep the 'put it in cloudbuild.yaml' instruction (the comment explains why).

### §4 step 0.3 ('run scripts/setup-deploy-on-merge.sh')
- PROBLEM: The script header says it must be run by the director logged in as director@ (creates an identity), has one browser step (authorising Cloud Build's GitHub app), and hardcodes REPO_URL=github.com/bhbinternationalschool/bhb-cbse-schools — which must match the actual repo (git user is ashishsingh80-web). deploy.yml alternative needs WIF. Also `--labels=commit=$COMMIT_SHA` is empty on the manual tarball path and the manual path still creates 4 revisions per deploy (harness §7).
- FIX: Mark 0.3 director-only with the browser step; have the executor verify REPO_URL first; pass `_COMMIT=$(git rev-parse HEAD)` from deploy-online.sh as a substitution; fold the two post-deploy `services update` env steps into the single deploy.

### §5 row 2 ('A Masters change visible on other open screens and devices ≤ 30 s') vs §4 step 4.4 ('refetch summary/features on resume if older than 2 min')
- PROBLEM: propagation.spec is two browser contexts, not two devices; the Flutter app has no change signal at all and 4.4 sets a 2-minute resume rule, so the phone target is 2 min by design, not 30 s. Also no mobile telemetry step exists (1.2 is web-only), so 4.4's '< 200 ms paint' acceptance is unmeasurable in production.
- FIX: Split the row: web ≤ 30 s (propagation.spec); app ≤ 2 min on resume or on the versions poll if 4.4 adopts it. Add a mobile beacon (route, ms, build) to 1.2 or 4.4.

### evidence/production-measurements.md ('fleet_edge_events … 71,072 seq scans') — not mentioned anywhere in COMMAND.md
- PROBLEM: The lens recorded it; the plan neither addresses nor dismisses it. supabase/migrations/20261011120000_db_cleanup_stage2.sql:42 already adds (tenant_id, vehicle_ref, event_type), matching the first-seen predicate at fleetEdge.server.ts:583-588, and the seq-scan figure is cumulative since 12 Aug.
- FIX: One line in §7 or 0.x: 'fleet-edge seq scans: index landed 11 Oct; confirm applied and that pg_stat_user_tables.seq_scan stops rising'.

### write-path §5 (probe table lists omit fee/attendance ancillary and sis tags/upgrades) — no step
- PROBLEM: Day-close, cheque, installment-plan and attendance-policy saves are served stale from the per-instance cache until an unrelated row changes; fees is Phase 5's first desk but still ~15 sessions away.
- FIX: Interim (route files are not frozen): make each cachedDeskJson probe the desk's *_sync_meta table (one table, every writer bumps it) — a delete-and-replace of the table list, consistent with R3.

### harness §5 (UpdateBar never reloads an idle tab; 15-min poll) — no step; §7.1 'ask the person to hard-reload'
- PROBLEM: 1.2 lets you SEE which build a request came from but nothing moves a parked tab to the new build, so 'still broken' reports after every deploy continue and §7.1 depends on a human remembering to hard-reload.
- FIX: Add to 1.2: when /api/app-version differs from the running BUILD_ID, reload on the next navigation (never mid-form); verify with the build header in logs.

### §3 R5 ('reads the tables it needs with the request's scope in the WHERE clause') and §4 Phase 5 step 2 ('paged, scoped')
- PROBLEM: masters, rbac, timetable, transport, trust and the 13 desk-slice modules are jsonb arrays in *_desk_slices; there is no row to scope. The server will still load the slice and filter in Node — fine at 60 KB, but the rule as written sends an executor looking for tables that do not exist.
- FIX: State the jsonb exception in R5: 'slice desks are read whole on the server through referenceCache and filtered there; row desks are scoped in SQL'.

### §4 step 1.3 ('GET /api/school-data/versions … from the 35 *_sync_meta tables … probe-cached 2 s')
- PROBLEM: Naively this is 35 PostgREST selects per poll per instance; with ~200 open tabs polling every 20 s and a 2 s cache it is still 35 queries every 2 s per instance.
- FIX: Require one RPC/view returning all rows in one round trip; acceptance includes 'one DB request per poll'.

### §4 step 1.3 ('Delete the disk mirror … diskPersist → no-op')
- PROBLEM: server-cost §2: ensureSchoolMirrorLoaded() fs.readFile+JSON.parse's the ~4 MB file on EVERY call (schoolDataMirror.server.ts:66-95), separate from diskPersist; making only the write a no-op leaves the per-call read.
- FIX: 1.3: both ensureSchoolMirrorLoaded and diskPersist become no-ops under NODE_ENV=production.

### §1 S6 ('app/popups loads all 717 students to find one household')
- PROBLEM: mobile-app table: true for parent sessions only; staff popups take no SIS.
- FIX: Say 'for parents'.

### §2 ('35 staff') vs §4 0.1 ('Staff page showing 34') vs 1.1 fixtures (34 staff)
- PROBLEM: harness quotes 'DB 35'; the document uses both.
- FIX: Use the DB count from sis_staff where status active and say which.

### §0 'Who this is for' / §5 / timeline
- PROBLEM: The director is told to read §1–§3 and §6, but §5 is what he is meant to check; nothing maps S1–S6 to the phase that removes each, nor the ~30–42 serial sessions (§0 says one step at a time, Phase 4 says parallel). He cannot tell whether 'students not loading' is fixed after Phase 2 or Phase 3.
- FIX: Add a six-row table under §1: symptom → first step that removes it on web / on app → cumulative sessions → how he will see it (which spec, which §5 row). Point him at §5.

### §4 step 1.1 fixtures ('15 classes, 13 sections')
- PROBLEM: Fewer sections than classes is unusual; if the seed does not resemble production shape, counts.spec proves little about the real roster.
- FIX: Derive fixture counts from masters_desk_sync_meta (class_count, subject_count) and sis_sync_meta (active_student_count) on the day 1.1 is run and record them.

### harness §6 (three docs describe a pipeline that does not exist) — no step
- PROBLEM: docs/DEPLOY_ON_MERGE.md, DEPLOY_CLOUD_BUILD_TRIGGER.md and verify.sh:5-8 will keep misleading the next session that reads them.
- FIX: Add to 0.3: correct or delete the three documents in the same PR that creates the trigger.

## factual errors

- CLAIM: §5: 'Bytes downloaded to open /fees, /students, /attendance — Today: 3.6 MB / 2.7 MB / 1.5 MB'
  TRUTH: No per-page measurement exists. Summing deskHydrationSchedule.ts ROUTE_IDS with the measured per-route averages gives ≈3.9 MB / ≥4.4 MB / ≈3.1 MB; /students and /attendance are under-stated.
  EVIDENCE: evidence/production-measurements.md gives only per-route averages; apps/web/src/lib/deskHydrationSchedule.ts:46-78 (students: fees, payments, attendance; attendance: attendance, staffAttendance, staffHr, staff) plus CORE sis/masters/rbac

- CLAIM: §5: 'API requests to open a page — Today: 21–34'; 'Data visible on a phone (4× CPU throttle, 4G) — Today: 3–9 s'
  TRUTH: Not measured anywhere; harness §4 states no client telemetry or timing exists and read-path's open questions say per-call timings were not measured.
  EVIDENCE: evidence/harness.md finding 4; evidence/read-path.md open questions line 144

- CLAIM: §1 S4 and §4 0.2: '126 cold starts a day' / '126 cold rebuilds a day'
  TRUTH: 126 is the count of startup-probe log lines; 63 distinct instance ids served traffic — the cold-start count is 63 (which §1 S6 itself uses).
  EVIDENCE: evidence/production-measurements.md 'Cold starts in 24 h' row

- CLAIM: §1 S6 / §5: 'Supabase sees 3,525 full roster reads … a day' / 'Server whole-roster reads per day: 3,525'
  TRUTH: 3,525 is all GETs on the sis_students PostgREST path (including single-row and paged reads); pg_stat_statements shows ≈77,000 whole-tenant selects since 12 Aug ≈ 1,260/day.
  EVIDENCE: evidence/production-measurements.md 'Server → database' table and the 'Since the stats reset on 12 Aug' line

- CLAIM: §5: 'Whole-desk POSTs from browsers per day — Today: all saves'
  TRUTH: masters sends changed sections only; 13 stamped desks send changed rows + stamps; only sis, fees, homework, payments, timetable, comms/notifications/student-leave, blobs, module-state and the 13 desk-slice modules push whole state.
  EVIDENCE: evidence/write-path.md per-desk save inventory table (columns 'What it sends', 'Version mechanism')

- CLAIM: §5: 'Replica-consistency code in lib/ — Done: 0'
  TRUTH: Phase 6 keeps rowStampWrite.server.ts, sliceCas.server.ts, deskProbeCache.server.ts and pageAll.ts, which are inside the 12,682-line count.
  EVIDENCE: evidence/harness.md guard inventory table (rowStampWrite.server.ts 118, sliceCas.server.ts 81, deskProbeCache.server.ts 155 listed within the 12,682 total); COMMAND.md Phase 6 'Keep:' line and '≥ 12,000'

- CLAIM: §4 step 4.1: 'ensureSchoolMirrorHydrated call count under app/api/v1 falls from 200 files to 0'
  TRUTH: 100 files under apps/web/src/app/api/v1 reference ensureSchoolMirrorHydrated.
  EVIDENCE: grep -rl ensureSchoolMirrorHydrated apps/web/src/app/api/v1 | wc -l → 100 (origin/main 2f0eb3d4 worktree)

- CLAIM: §4 step 1.6: 'loadSis( (today ~90)'
  TRUTH: 77 files under components/ + app/(erp)/ call loadSis(.
  EVIDENCE: grep -rl 'loadSis(' apps/web/src/components 'apps/web/src/app/(erp)' | wc -l → 77

- CLAIM: §3 R3: 'Every server write already bumps its *_sync_meta.updated_at; a write that does not is a bug'
  TRUTH: Staff writes bump only sis_staff.updated_at; the 29 module_local_state books and the *_state domain blobs bump only their own row; there is no sync_meta for any of them.
  EVIDENCE: evidence/write-path.md save inventory rows 'staff' (yes: row updated_at), '29 module_local_state books' (row updated_at), 'teaching / salary_setup (blob-only)' (blob updated_at); migrations list shows no staff/module-state sync_meta table

- CLAIM: §4 step 1.3: versions endpoint 'probe-cached' via desk_probe of the *_sync_meta tables (§7.2 'deskProbe RPC with table allowlist')
  TRUTH: The desk_probe allowlist contains no *_sync_meta table and raises 'not allowlisted' for any other name; a migration is required.
  EVIDENCE: supabase/migrations/20261009090000_desk_probe_transport.sql:19-37 (allowed array) and :45-46 (raise exception)

- CLAIM: §3 R4 / §4 1.5: '/api/data/<collection> … {row, baseUpdatedAt}' on 'the inert Stage-1 route'
  TRUTH: The existing route's contract is POST body `{ ops: WriteOp[] }` through a collection registry, approval gate and repo; its header forbids whole-state bodies and says nothing of {row, baseUpdatedAt}.
  EVIDENCE: apps/web/src/app/api/data/[collection]/route.ts:1-26 and imports of lib/data/registry, lib/data/approvalGate, lib/data/server/repo

- CLAIM: §1 S3: 'Only 8 component files listen to bhb-masters-updated'
  TRUTH: 10 component files contain a bhb-masters-updated listener (8 addEventListener literals plus useAccessData's event array and CoreDataGate).
  EVIDENCE: grep -rl bhb-masters-updated apps/web/src/components → 10 files; evidence/write-path.md finding 1 lists the same 10

- CLAIM: §1 S6: '`app/popups` loads all 717 students to find one household'
  TRUTH: Only for parent sessions; staff popups take no SIS read.
  EVIDENCE: evidence/mobile-app.md home-screen table: Principal '/api/v1/app/popups … (staff: no SIS)' vs Parent 'householdChildren → SIS re-page'

- CLAIM: evidence/history.md open question (why api/inventory/assets/route.ts is absent from the live tarball) is carried into §0.1 unanswered; §0.1 implies a clean git archive export deploys origin/main faithfully
  TRUTH: .gcloudignore line 13 `assets/` excludes apps/web/src/app/api/inventory/assets/ from every `gcloud builds submit` upload; git archive does not change that, so 0.1 would ship the same missing route.
  EVIDENCE: .gcloudignore:13; scripts/deploy-online.sh:318 `gcloud builds submit "$ROOT"`

- CLAIM: §2: 'the school has 35 staff'; §4 0.1 and 1.1: 34 staff
  TRUTH: The document uses two numbers for one fact; harness quotes the DB at 35.
  EVIDENCE: evidence/harness.md guard inventory ('HR staff 0 vs DB 35'); COMMAND.md 0.1 'Staff page showing 34', 1.1 '34 staff'

