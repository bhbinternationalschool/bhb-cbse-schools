/**
 * Run: npx tsx src/lib/data/server/versionsRoute.selftest.ts
 *
 * data-layer 1.3. GET /api/data/views/versions and the shared versions read
 * behind it, against a fake PostgREST (no database):
 *  - readErpVersions: concurrent callers share ONE erp_versions call; the
 *    answer is held 2 s (keyed by tenant), then asked again; a failed call is
 *    {ok:false} — never {} — and is held for the window too; a non-object
 *    answer is a failure; forgetErpVersions forces the next call;
 *  - versionsGet: 401 without a valid session, 403 for an inactive family,
 *    503 {ok:false} when the auth read or the versions read fails,
 *    200 {ok:true, versions, at} otherwise, never cached by the browser;
 *  - the real route module (app/api/data/views/versions/route.ts), driven
 *    through the real guard (resolveApiAuth, here by API key): 200 with the
 *    versions; no credentials = 401. That the running app routes the path to
 *    this file and not to /api/data/[collection] is proven against the local
 *    stack (apps/web/e2e/versions.acceptance.ts).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "../../fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

const quiet = { log: console.log, error: console.error, warn: console.warn };
const logs: string[] = [];
console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));

const VERSIONS = {
  masters: { updated_at: "2026-10-13T00:00:00Z", count: 15 },
  sis: { updated_at: "2026-10-13T00:00:00Z", count: 401 },
  "module_state:fee_holds": { updated_at: "2026-10-13T00:00:00Z", count: 1 },
};
let mode: "ok" | "error" | "array" = "ok";
const seenArgs: unknown[] = [];
pg.rpc.erp_versions = (args) => {
  seenArgs.push(args);
  if (mode === "error") throw new Error("permission denied for function erp_versions");
  if (mode === "array") return [];
  return VERSIONS;
};
const rpcCalls = () => pg.log.filter((l) => l === "POST rpc/erp_versions").length;

void (async () => {
  try {
    const { readErpVersions, forgetErpVersions } = await import("./versions");
    const { versionsGet } = await import("./versionsRoute");
    const { ApiError } = await import("../../api/v1/errors");

    // ── One call shared by concurrent callers, held for the 2 s window, keyed by tenant.
    const snaps = await Promise.all(Array.from({ length: 8 }, () => readErpVersions()));
    assert.equal(rpcCalls(), 1, "eight concurrent callers = one erp_versions call");
    for (const s of snaps) assert.ok(s.ok && s.versions.masters.count === 15);
    assert.deepEqual(seenArgs[0], { p_tenant: "00000000-0000-4000-8000-000000000001" }, "called for this tenant");
    clock += 1_900;
    await readErpVersions();
    assert.equal(rpcCalls(), 1, "inside 2 s: the held answer");
    clock += 200;
    await readErpVersions();
    assert.equal(rpcCalls(), 2, "after 2 s: asked again");

    // ── A failure is {ok:false}, never {}; it is held for the window too.
    mode = "error";
    clock += 2_100;
    const failed = await readErpVersions();
    assert.equal(failed.ok, false, "a failed call is ok:false");
    assert.ok(!("versions" in failed), "…with no versions object at all");
    await readErpVersions();
    assert.equal(rpcCalls(), 3, "a failure is held for the window: one call per window during an outage");
    mode = "array";
    clock += 2_100;
    const notObject = await readErpVersions();
    assert.equal(notObject.ok, false, "an answer that is not an object is a failure");
    mode = "ok";
    forgetErpVersions();
    const afterForget = await readErpVersions();
    assert.ok(afterForget.ok, "forgetErpVersions: the next read asks the database");
    assert.equal(rpcCalls(), 5);

    // ── The handler: auth outcomes, 503 on a failed read, 200 shape, no-store.
    const req = new Request("https://example.test/api/data/views/versions");
    const okRead = async () => ({ ok: true as const, versions: VERSIONS, at: "2026-10-13T00:00:01.000Z", seq: 1 });
    const badRead = async () => ({ ok: false as const, error: "boom", seq: 2 });
    const okAuth = async () => ({});

    const r401 = await versionsGet(req, { auth: async () => { throw new ApiError("unauthorized", "Sign in", 401); }, read: okRead });
    assert.equal(r401.status, 401, "no session = 401");
    const r401b = await versionsGet(req, { auth: async () => { throw new Error("cookies() outside a request"); }, read: okRead });
    assert.equal(r401b.status, 401, "any other auth failure = 401");
    const r403 = await versionsGet(req, { auth: async () => { throw new ApiError("family_inactive", "closed", 403); }, read: okRead });
    assert.equal(r403.status, 403, "an inactive family = 403");
    const r503auth = await versionsGet(req, { auth: async () => { throw new ApiError("server_error", "setup unreadable", 503); }, read: okRead });
    assert.equal(r503auth.status, 503, "a 503 from the guard stays a 503");

    const r503 = await versionsGet(req, { auth: okAuth, read: badRead });
    assert.equal(r503.status, 503, "a failed versions read = 503");
    const b503 = (await r503.json()) as Record<string, unknown>;
    assert.equal(b503.ok, false, "…with ok:false");
    assert.ok(!("versions" in b503), "…and no versions object — never {}");

    const r200 = await versionsGet(req, { auth: okAuth, read: okRead });
    assert.equal(r200.status, 200);
    assert.equal(r200.headers.get("cache-control"), "no-store");
    const b200 = (await r200.json()) as { ok: boolean; versions: typeof VERSIONS; at: string };
    assert.deepEqual(b200, { ok: true, versions: VERSIONS, at: "2026-10-13T00:00:01.000Z" });

    // ── The real route file, beside [collection], through the real guard.
    const here = __dirname;
    assert.ok(existsSync(resolve(here, "../../../app/api/data/views/versions/route.ts")), "the route is a static segment file");
    assert.ok(existsSync(resolve(here, "../../../app/api/data/[collection]/route.ts")), "beside the dynamic [collection] segment");
    const route = await import("../../../app/api/data/views/versions/route");
    assert.equal(typeof route.GET, "function");
    assert.equal(route.runtime, "nodejs");

    const raw = "bhb_selftest_versions_key_0001";
    pg.tables.api_keys = [
      {
        id: "key_1",
        key_hash: createHash("sha256").update(raw).digest("hex"),
        scopes: [],
        is_active: true,
        expires_at: null,
      },
    ];
    pg.tables.masters_desk_slices = [
      { tenant_id: "t", slice_key: "classes", payload: [{ id: "cls_1", name: "Class 1", sortOrder: 1, isActive: true }], updated_at: "2026-10-13T00:00:00Z" },
    ];
    clock += 2_100;
    const before = rpcCalls();
    const viaRoute = await route.GET(new Request("https://example.test/api/data/views/versions", { headers: { authorization: `Bearer ${raw}` } }));
    assert.equal(viaRoute.status, 200, `the real route with a valid API key = 200 (${viaRoute.status})`);
    const body = (await viaRoute.json()) as { ok: boolean; versions: Record<string, unknown> };
    assert.equal(body.ok, true);
    assert.deepEqual(Object.keys(body.versions).sort(), Object.keys(VERSIONS).sort());
    assert.equal(rpcCalls() - before, 1, "one request: the guard's caches and the route share the one versions read");

    const anon = await route.GET(new Request("https://example.test/api/data/views/versions"));
    assert.equal(anon.status, 401, "the real route with no credentials = 401");

    Date.now = realNow;
    Object.assign(console, quiet);
    console.log("versionsRoute selftest: ok");
    process.exit(0);
  } catch (e) {
    Object.assign(console, quiet);
    console.error(e);
    console.error(logs.slice(-30).join("\n"));
    process.exit(1);
  }
})();
