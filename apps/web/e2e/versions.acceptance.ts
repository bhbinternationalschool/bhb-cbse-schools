/**
 * Acceptance check for data-layer step 1.3 on the local test stack.
 *
 *   bash scripts/e2e-stack.sh check      (runs acceptance.ts, then this)
 *
 * Needs the stack up, the app built with .env.e2e and running. Argument 1 is
 * the running app's log file (the stack's app.log): the server reference
 * cache logs one line per rebuild ("[reference-cache] masters rebuilt (…)"),
 * which is how this sees loadServerMasters rebuild from outside the process.
 *
 * What it proves, against Postgres 17 + PostgREST with every migration applied:
 *  1. erp_versions through PostgREST (service key): the 37 *_sync_meta desks,
 *     the staff row tables, the blobs; counts equal the seeded data; the
 *     dropped purchase/store desks are absent; anon is refused.
 *  2. erp_versions answers in < 50 ms (median of 30 warm calls over HTTP).
 *  3. The app's own reader makes exactly ONE request per read, and none for
 *     reads inside the 2 s window.
 *  4. GET /api/data/views/versions through the running app: 401 without a
 *     session; 200 {ok:true, versions, at} for office staff; 403 for a
 *     parent (school-wide counts are staff-only) and for an inactive family; it is the static route,
 *     not /api/data/[collection].
 *  5. A Masters change made through the app's own masters-desk POST moves the
 *     "masters" version, and the server's loadServerMasters rebuilds exactly
 *     once — not again on later calls, not after 31 s with no change.
 * The renamed subject is put back exactly as seeded afterwards.
 */

import { readFileSync } from "node:fs";
import { assertLocalStack, sessionCookieHeader } from "./session";
import { buildFixture } from "./fixture";
import type { DemoSession } from "@/lib/auth";
import { installServerOnlyStub } from "@/lib/fakePostgrest.testkit";

type Outcome = { name: string; ok: boolean; detail: string };
const outcomes: Outcome[] = [];
function record(name: string, ok: boolean, detail: string): void {
  outcomes.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

async function req(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _text: text.slice(0, 120) };
  }
  return { status: res.status, body: Array.isArray(body) ? { _array: body } : obj(body), ms };
}

async function main(): Promise<void> {
  assertLocalStack();
  const appLog = process.argv[2] || "";
  if (!appLog) throw new Error("usage: versions.acceptance.ts <app.log>");
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const app = process.env.E2E_APP_URL || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(app)) throw new Error(`E2E_APP_URL is "${app}", not 127.0.0.1`);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const svc = { apikey: service, Authorization: `Bearer ${service}` };
  const fx = buildFixture();
  const e = fx.expected;

  const tenant = await req(`${api}/rest/v1/tenants?slug=eq.bhb-international&select=id`, { headers: svc });
  const tenantId = String(obj(arr(tenant.body._array)[0]).id || "");
  if (!tenantId) throw new Error("no tenant on the stack");

  // ── 1. erp_versions through PostgREST.
  const rpc = () => req(`${api}/rest/v1/rpc/erp_versions`, { method: "POST", headers: svc, body: { p_tenant: tenantId } });
  const first = await rpc();
  const v = first.body as Record<string, { updated_at: string | null; count: number | null }>;
  const keys = Object.keys(v);
  const syncMetaKeys = keys.filter((k) => !k.startsWith("module_state:") && !k.endsWith("_state") && !k.startsWith("sis_") && k !== "masters_desk_settings");
  record("rpc: erp_versions answers (service key)", first.status === 200 && keys.length > 0, `HTTP ${first.status}, ${keys.length} keys`);
  // 35 in production before 1.5; data-layer 1.5 adds website_desk_sync_meta
  // and udise_sheet_desk_sync_meta (the generic write route's two desks);
  // admission_survey_sync_meta (the survey team & beats rows, 15 Oct 2026);
  // erp_notifications_sync_meta (the notification inbox, 20 Oct 2026).
  record(
    "rpc: one key per *_sync_meta table present (39)",
    syncMetaKeys.length === 39 &&
      syncMetaKeys.includes("website") &&
      syncMetaKeys.includes("udise_sheet") &&
      syncMetaKeys.includes("admission_survey") &&
      syncMetaKeys.includes("erp_notifications"),
    `${syncMetaKeys.length} desk keys: ${syncMetaKeys.join(" ")}`,
  );
  record("rpc: dropped purchase/store desks are absent, not an error", !("purchase" in v) && !("store" in v) && !("store_state" in v), "purchase, store, store_state absent");
  record("rpc: masters count = seeded classes", v.masters?.count === e.classes && !!v.masters?.updated_at, `masters ${JSON.stringify(v.masters)} (want count ${e.classes})`);
  record("rpc: sis count = seeded student rows", v.sis?.count === e.studentRows, `sis ${JSON.stringify(v.sis)} (want ${e.studentRows})`);
  record("rpc: sis_staff count = seeded staff", v.sis_staff?.count === e.staff, `sis_staff ${JSON.stringify(v.sis_staff)} (want ${e.staff})`);
  record(
    "rpc: staff tables, masters_desk_settings and blobs are present",
    ["sis_departments", "sis_designations", "masters_desk_settings", "rbac_state", "fees_state", "school_mirror_state"].every((k) => k in v),
    "sis_departments sis_designations masters_desk_settings rbac_state fees_state school_mirror_state",
  );
  const anonCall = await req(`${api}/rest/v1/rpc/erp_versions`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: { p_tenant: tenantId },
  });
  record("rpc: the anon key is refused", anonCall.status === 401 || anonCall.status === 403, `HTTP ${anonCall.status} ${String(anonCall.body.message ?? "")}`);

  // ── 2. Latency: warm calls over HTTP (PostgREST + the proxy included).
  for (let i = 0; i < 5; i++) await rpc();
  const times: number[] = [];
  for (let i = 0; i < 30; i++) times.push((await rpc()).ms);
  const med = median(times);
  record(
    "rpc: erp_versions < 50 ms warm (median of 30, over HTTP)",
    med < 50,
    `median ${med.toFixed(1)} ms, p95 ${pct(times, 95).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`,
  );

  // ── 3. The app's reader: one request per read, none inside the window.
  {
    installServerOnlyStub();
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(typeof input === "string" || input instanceof URL ? input : input.url));
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const { readErpVersions, forgetErpVersions } = await import("@/lib/data/server/versions");
      await readErpVersions(); // resolves the tenant once per process
      forgetErpVersions();
      seen.length = 0;
      const t0 = performance.now();
      const snap = await readErpVersions();
      const ms = performance.now() - t0;
      const calls = [...seen];
      record(
        "app reader: one read = exactly one request (rpc/erp_versions)",
        snap.ok && calls.length === 1 && calls[0]!.endsWith("/rest/v1/rpc/erp_versions"),
        `${calls.length} request(s): ${calls.map((c) => c.replace(api, "")).join(", ")}; ${ms.toFixed(1)} ms`,
      );
      seen.length = 0;
      await Promise.all(Array.from({ length: 10 }, () => readErpVersions()));
      record("app reader: ten reads inside the 2 s window = no request", seen.length === 0, `${seen.length} request(s)`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── 4. The route through the running app.
  const office = { cookie: sessionCookieHeader(fx.sessions.office) };
  {
    const none = await req(`${app}/api/data/views/versions`);
    record("app: versions without a session = 401", none.status === 401, `HTTP ${none.status} ${JSON.stringify(none.body).slice(0, 80)}`);
    const r = await req(`${app}/api/data/views/versions`, { headers: office });
    const versions = obj(r.body.versions);
    record(
      "app: versions as office = 200 {ok, versions, at}",
      r.status === 200 && r.body.ok === true && typeof r.body.at === "string" && Object.keys(versions).length === keys.length,
      `HTTP ${r.status}, ${Object.keys(versions).length} keys (rpc: ${keys.length}), at=${String(r.body.at)}`,
    );
    const coll = await req(`${app}/api/data/views`, { headers: office });
    record(
      "app: the static route, not [collection] (which answers 'Unknown collection')",
      r.body.ok === true && coll.status === 404 && coll.body.code === "not_found",
      `/api/data/views/versions → ${r.status}; /api/data/views ([collection]) → ${coll.status} ${String(coll.body.error ?? "")}`,
    );

    const activeHh = fx.sis.households.find((h) =>
      fx.sis.students.some((s) => s.householdId === h.id && s.status === "active" && s.academicYearCode === fx.sessions.office.academicYearCode),
    );
    const inactiveHh = fx.sis.households.find((h) => {
      const kids = fx.sis.students.filter((s) => s.householdId === h.id);
      return kids.length > 0 && kids.every((s) => s.status !== "active");
    });
    const parent = (householdId: string): DemoSession => ({
      persona: "parent",
      fullName: "E2E Parent",
      roleCode: "parent",
      householdId,
      tenantSlug: fx.sessions.office.tenantSlug,
      academicYearCode: fx.sessions.office.academicYearCode,
    });
    if (activeHh) {
      const p = await req(`${app}/api/data/views/versions`, { headers: { cookie: sessionCookieHeader(parent(activeHh.id)) } });
      record("app: versions as a parent = 403 (staff only)", p.status === 403, `HTTP ${p.status} (household ${activeHh.id})`);
    } else {
      record("app: versions as a parent = 403 (staff only)", false, "fixture has no household with an active child");
    }
    if (inactiveHh) {
      const p = await req(`${app}/api/data/views/versions`, { headers: { cookie: sessionCookieHeader(parent(inactiveHh.id)) } });
      record("app: versions for an inactive family = 403", p.status === 403, `HTTP ${p.status} (household ${inactiveHh.id})`);
    }

    const appTimes: number[] = [];
    for (let i = 0; i < 20; i++) appTimes.push((await req(`${app}/api/data/views/versions`, { headers: office })).ms);
    console.log(
      `INFO  app: GET /api/data/views/versions warm, 20 calls: median ${median(appTimes).toFixed(1)} ms, ` +
        `p95 ${pct(appTimes, 95).toFixed(1)} ms (session check + held snapshot or one rpc)`,
    );
  }

  // ── 5. A Masters change through the app moves the version; loadServerMasters rebuilds once.
  // The fixture's office role reads Masters but may not edit it (the built-in
  // office role has no masters.edit); the edit is made as the principal (no
  // roster link, as a director's email login is), who holds masters.edit.
  const principal = {
    cookie: sessionCookieHeader({
      persona: "staff",
      fullName: "E2E Principal",
      roleCode: "principal",
      tenantSlug: fx.sessions.office.tenantSlug,
      academicYearCode: fx.sessions.office.academicYearCode,
    }),
  };
  const rebuilds = () => readFileSync(appLog, "utf8").split("\n").filter((l) => l.includes("[reference-cache] masters rebuilt")).length;
  const versionsNow = async () => obj(obj((await req(`${app}/api/data/views/versions`, { headers: office })).body.versions).masters);
  const desk = await req(`${app}/api/school-data/masters-desk`, { headers: office });
  const subjects = arr(desk.body.subjects).map(obj);
  const stamp = String(obj(desk.body.sliceStamps).subjects || "");
  const target = subjects[0];
  if (!target || !stamp) throw new Error("masters-desk gave no subjects / no subjects stamp");
  // Subjects carry their English name in `nameEn`.
  const originalName = String(target.nameEn ?? "");
  if (!originalName) throw new Error("the first subject has no nameEn");
  const renamed = `${originalName} (e2e 1.3)`;

  await sleep(2_100);
  const v0 = await versionsNow();
  const r0 = rebuilds();
  const post = await req(`${app}/api/school-data/masters-desk`, {
    method: "POST",
    headers: principal,
    body: { subjects: subjects.map((s) => (s.id === target.id ? { ...s, nameEn: renamed } : s)), sliceBases: { subjects: stamp } },
  });
  record("masters: rename a subject through the app's masters-desk POST (principal)", post.status === 200, `HTTP ${post.status} ${JSON.stringify(post.body).slice(0, 120)}`);

  await sleep(2_100);
  const v1 = await versionsNow();
  record(
    "masters: the write moved the masters version",
    !!v1.updated_at && v1.updated_at !== v0.updated_at,
    `before ${String(v0.updated_at)} → after ${String(v1.updated_at)}`,
  );
  // The versions GET above runs the session guard, i.e. loadServerMasters.
  const r1 = rebuilds();
  await req(`${app}/api/data/views/versions`, { headers: office });
  await req(`${app}/api/school-data/staff-roster`, { headers: office });
  await sleep(2_100);
  await req(`${app}/api/data/views/versions`, { headers: office });
  const r2 = rebuilds();
  record("masters: loadServerMasters rebuilt exactly once after the write", r1 - r0 === 1 && r2 === r1, `rebuild lines: before ${r0}, after the write ${r1}, after 3 more calls ${r2}`);

  const after = await req(`${app}/api/school-data/masters-desk`, { headers: office });
  const seenName = String(obj(arr(after.body.subjects).map(obj).find((s) => s.id === target.id)).nameEn || "");
  record("masters: the rename is what masters-desk now serves", seenName === renamed, `"${seenName}"`);

  // No change for 31 s: no rebuild (the 30 s TTL is gone).
  await sleep(31_000);
  await req(`${app}/api/data/views/versions`, { headers: office });
  const v2 = await versionsNow();
  const r3 = rebuilds();
  record("masters: no change for 31 s = no rebuild", r3 === r2 && v2.updated_at === v1.updated_at, `rebuild lines ${r2} → ${r3}; version ${String(v2.updated_at)}`);

  // Put the seed back, exactly.
  const restore = await req(`${app}/api/school-data/masters-desk`, {
    method: "POST",
    headers: principal,
    body: {
      subjects: arr(after.body.subjects).map(obj).map((s) => (s.id === target.id ? target : s)),
      sliceBases: { subjects: String(obj(after.body.sliceStamps).subjects || "") },
    },
  });
  const back = await req(`${app}/api/school-data/masters-desk`, { headers: office });
  const restored = obj(arr(back.body.subjects).map(obj).find((s) => s.id === target.id));
  // Content exactly as seeded; its `_rev` (data-layer 2.2a) moved twice — the
  // rename and the restore are two versions, never a reset to the old number.
  const { _rev: revBack, ...restoredContent } = restored;
  const { _rev: revSeed, ...seedContent } = target;
  record(
    "masters: the subject is restored exactly as seeded (its _rev moved on: rename + restore)",
    restore.status === 200 &&
      JSON.stringify(restoredContent) === JSON.stringify(seedContent) &&
      Number(revBack) === Number(revSeed ?? 0) + 2,
    `HTTP ${restore.status}, "${String(restored.nameEn)}", _rev ${String(revSeed)} → ${String(revBack)}`,
  );

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed (data-layer 1.3)`);
  if (failed.length) {
    console.log("failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
