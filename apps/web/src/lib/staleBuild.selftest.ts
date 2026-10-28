/**
 * Run: npx tsx src/lib/staleBuild.selftest.ts
 *
 * data-layer 1.2. A write carrying an `X-Bhb-Build` that differs from the
 * server's build is LOGGED and marked `X-Bhb-Build-Stale: 1` — and is never
 * refused: status and body are exactly what the handler answered. Same
 * build, missing header, a read, or an unknown server build: nothing.
 *
 * The server's build is read from a real .next/BUILD_ID (the file
 * /api/app-version serves), and the real POST /api/data/<collection> route
 * is driven end to end on its no-auth path (an unknown collection → 404).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
const dir = mkdtempSync(join(tmpdir(), "stale-build-selftest-"));
mkdirSync(join(dir, ".next"));
writeFileSync(join(dir, ".next", "BUILD_ID"), "build-new\n");
process.chdir(dir);

const logged: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  logged.push(a.map(String).join(" "));
};

void (async () => {
  try {
    const { noteStaleBuild, withBuildCheck, STALE_HEADER } = await import("./staleBuild.server");
    const { serverBuildId } = await import("./serverBuild.server");
    const appVersion = await import("../app/api/app-version/route");
    assert.equal(serverBuildId(), "build-new", "the server build is .next/BUILD_ID");
    const served = (await (appVersion.GET() as Response).json()) as { build: string };
    assert.equal(served.build, "build-new", "/api/app-version serves the very id the check compares against");

    const req = (method: string, build: string | null, path = "/api/data/sis.students") =>
      new Request(`https://example.test${path}`, {
        method,
        headers: build === null ? {} : { "X-Bhb-Build": build },
        ...(method === "GET" ? {} : { body: "{}" }),
      });

    // The predicate.
    const lines: string[] = [];
    const sink = (l: string) => lines.push(l);
    assert.equal(noteStaleBuild(req("POST", "build-old"), "build-new", sink), true, "an older build's write is stale");
    assert.deepEqual(JSON.parse(lines[0]), {
      event: "stale-build-write",
      clientBuild: "build-old",
      serverBuild: "build-new",
      method: "POST",
      path: "/api/data/sis.students",
    });
    for (const m of ["PUT", "PATCH", "DELETE"]) assert.equal(noteStaleBuild(req(m, "build-old"), "build-new", sink), true, `${m} counts as a write`);
    lines.length = 0;
    assert.equal(noteStaleBuild(req("POST", "build-new"), "build-new", sink), false, "same build → nothing");
    assert.equal(noteStaleBuild(req("POST", null), "build-new", sink), false, "no header → nothing");
    assert.equal(noteStaleBuild(req("POST", "  "), "build-new", sink), false, "blank header → nothing");
    assert.equal(noteStaleBuild(req("POST", "unknown"), "build-new", sink), false, "a page that does not know its build → nothing");
    assert.equal(noteStaleBuild(req("POST", "build old;<x>"), "build-new", sink), false, "a malformed header → nothing");
    assert.equal(noteStaleBuild(req("POST", "build-old"), "unknown", sink), false, "a server that does not know its build → nothing");
    assert.equal(noteStaleBuild(req("GET", "build-old"), "build-new", sink), false, "a read → nothing");
    assert.equal(noteStaleBuild(req("POST", "build-old", "/login"), "build-new", sink), false, "not an API path → nothing");
    assert.equal(lines.length, 0, "and nothing logged for any of those");

    // The wrapper never answers in the handler's place.
    for (const status of [200, 400, 403, 409, 500]) {
      logged.length = 0;
      const wrapped = withBuildCheck(async () => Response.json({ ok: status === 200, n: status }, { status }));
      const stale = await wrapped(req("POST", "build-old"));
      assert.equal(stale.status, status, `a stale write keeps the handler's ${status}`);
      assert.deepEqual(await stale.json(), { ok: status === 200, n: status }, "and its body");
      assert.equal(stale.headers.get(STALE_HEADER), "1", "and is marked stale");
      assert.equal(logged.length, 1, "with one log line");
      const fresh = await wrapped(req("POST", "build-new"));
      assert.equal(fresh.status, status);
      assert.equal(fresh.headers.get(STALE_HEADER), null, "a current build is not marked");
      const none = await wrapped(req("POST", null));
      assert.equal(none.headers.get(STALE_HEADER), null, "no header is not marked");
      assert.equal(logged.length, 1, "neither logs");
    }
    let ran = 0;
    const counted = withBuildCheck(async () => {
      ran++;
      return new Response("x");
    });
    await counted(req("POST", "build-old"));
    assert.equal(ran, 1, "the handler runs exactly once for a stale write");
    const redirect = withBuildCheck(async () => Response.redirect("https://example.test/x", 302));
    assert.equal((await redirect(req("POST", "build-old"))).status, 302, "an immutable reply goes out unchanged, not as an error");

    // The real data route, end to end (no auth needed for an unknown collection).
    const { POST } = await import("../app/api/data/[collection]/route");
    const ctx = { params: Promise.resolve({ collection: "no.such.collection" }) };
    logged.length = 0;
    const res = await POST(req("POST", "build-old", "/api/data/no.such.collection"), ctx);
    assert.equal(res.status, 404, "the data route answers as it always did");
    assert.equal(((await res.json()) as { kind?: string }).kind, "not_found");
    assert.equal(res.headers.get(STALE_HEADER), "1", "marked stale");
    assert.equal(logged.filter((l) => l.includes('"stale-build-write"')).length, 1, "and logged once");
    const cur = await POST(req("POST", "build-new", "/api/data/no.such.collection"), ctx);
    assert.equal(cur.status, 404);
    assert.equal(cur.headers.get(STALE_HEADER), null);

    console.log = realLog;
    console.log("staleBuild selftest: ok");
  } catch (e) {
    console.log = realLog;
    console.error(e);
    process.exit(1);
  }
})();
