/**
 * Run: npx tsx src/lib/clientMetricsRoute.selftest.ts
 *
 * data-layer 1.2. Drives the real POST /api/client-metrics handler with real
 * Requests: anonymous → 401, oversize → 413 (declared or not), unknown event
 * → 400, the 61st report in a minute → 429, and a good report → 204 with
 * EXACTLY ONE log line of the documented shape — persona and role from the
 * signed cookie, never from the body.
 */
import assert from "node:assert/strict";

process.env.APP_SESSION_SECRET = "client-metrics-selftest-secret";

type Line = Record<string, unknown>;
const logged: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  logged.push(a.map(String).join(" "));
};

void (async () => {
  try {
    const { POST } = await import("../app/api/client-metrics/route");
    const { signSession } = await import("./sessionCookie.server");
    const { MetricRateLimiter, parseMetricBody } = await import("./clientMetrics.server");

    const teacher = signSession({
      persona: "staff",
      fullName: "Test Teacher",
      roleCode: "teacher",
      staffId: "stf_1",
      tenantSlug: "bhb-international",
      academicYearCode: "2026-27",
    })!;
    const parent = signSession({
      persona: "parent",
      fullName: "Test Parent",
      roleCode: "parent",
      householdId: "hh_1",
      tenantSlug: "bhb-international",
      academicYearCode: "2026-27",
    })!;
    assert.ok(teacher && parent, "sessions sign");

    const good = { event: "page-ready", route: "/students", key: "nav", ms: 1234.4, build: "b-abc", roleCode: "owner", persona: "parent" };
    const req = (body: string | object, cookie?: string, headers: Record<string, string> = {}) =>
      new Request("https://example.test/api/client-metrics", {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8", ...(cookie ? { cookie: `x=1; bhb_demo_session=${cookie}` } : {}), ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });

    // 401: no cookie, a forged cookie, a cookie with a broken signature.
    logged.length = 0;
    assert.equal((await POST(req(good))).status, 401, "anonymous is refused");
    assert.equal((await POST(req(good, "eyJwZXJzb25hIjoic3RhZmYifQ.forged"))).status, 401, "a forged cookie is refused");
    assert.equal((await POST(req(good, teacher.slice(0, -2) + "xx"))).status, 401, "a tampered cookie is refused");
    assert.equal(logged.length, 0, "nothing logged for anonymous reports");

    // 413: declared too big, and too big without a declared length (a stream).
    const big = JSON.stringify({ ...good, key: "k", pad: "x".repeat(3000) });
    assert.equal((await POST(req(big, teacher))).status, 413, "a 3 KB body is refused");
    const enc = new TextEncoder().encode(big);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < enc.length; i += 500) c.enqueue(enc.slice(i, i + 500));
        c.close();
      },
    });
    const streamed = new Request("https://example.test/api/client-metrics", {
      method: "POST",
      headers: { cookie: `bhb_demo_session=${teacher}` },
      body: stream,
      // @ts-expect-error -- Node's fetch needs duplex for a stream body
      duplex: "half",
    });
    assert.equal(streamed.headers.get("content-length"), null, "the streamed body declares no length");
    assert.equal((await POST(streamed)).status, 413, "an undeclared oversize body is refused once it passes 2 KB");
    assert.equal(logged.length, 0, "nothing logged for oversize reports");

    // 400: unknown event, bad route, bad numbers, timing without ms.
    for (const [bad, why] of [
      [{ ...good, event: "page-read" }, "unknown event"],
      [{ ...good, event: undefined }, "no event"],
      [{ ...good, route: "students" }, "route not a path"],
      [{ ...good, route: "/" + "a".repeat(200) }, "route over 200 chars"],
      [{ ...good, route: "/students?id=1" }, "route with a query string"],
      [{ ...good, ms: -1 }, "negative ms"],
      [{ ...good, ms: 10_000_000 }, "absurd ms"],
      [{ ...good, ms: "12" }, "ms as a string"],
      [{ event: "desk-hydrate", route: "/home", key: "sis" }, "timing without ms"],
      [{ ...good, bytes: 1.5 }, "fractional bytes"],
      [{ event: "rendered-zero-rows", route: "/students", rows: 3 }, "zero-rows that is not zero"],
      [{ ...good, key: "GET /api/x?y=<script>" }, "key with odd characters"],
      ["not json", "not JSON"],
      [[good], "an array"],
    ] as const) {
      const res = await POST(req(bad as object | string, teacher));
      assert.equal(res.status, 400, `400 for ${why}`);
    }
    assert.equal(logged.length, 0, "nothing logged for bad reports");

    // 204 + exactly one line of the documented shape.
    const ok = await POST(req(good, teacher));
    assert.equal(ok.status, 204, "a good report is accepted");
    assert.equal(logged.length, 1, "exactly one log line per report");
    const line = JSON.parse(logged[0]) as Line;
    assert.deepEqual(line, {
      event: "client-metric",
      build: "b-abc",
      platform: "web",
      persona: "staff",
      roleCode: "teacher",
      route: "/students",
      metric: "page-ready",
      key: "nav",
      ms: 1234,
      bytes: null,
      rows: null,
    }, "the line carries the session's persona/role, not the body's, and nothing extra");

    // Flutter and failure events.
    logged.length = 0;
    assert.equal((await POST(req({ event: "query", route: "/api/v1/parent/summary", ms: 812, bytes: 2048, platform: "flutter", build: "parent-28" }, parent))).status, 204);
    assert.equal((await POST(req({ event: "rendered-zero-rows", route: "/students", key: "roster", rows: 0 }, parent))).status, 204);
    assert.equal((await POST(req({ event: "query-error", route: "/home", key: "GET /api/data/sis.students" }, parent))).status, 204);
    assert.equal(logged.length, 3);
    const flutter = JSON.parse(logged[0]) as Line;
    assert.equal(flutter.platform, "flutter");
    assert.equal(flutter.persona, "parent");
    assert.equal(flutter.bytes, 2048);
    assert.equal((JSON.parse(logged[2]) as Line).ms, null, "a query-error needs no ms");
    assert.equal((JSON.parse(logged[1]) as Line).build, "unknown", "a missing build is said to be unknown");

    // 429: one session gets 60 at once; the others are not affected.
    logged.length = 0;
    let accepted = 0;
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const s = (await POST(req({ event: "query-error", route: "/home" }, teacher))).status;
      if (s === 204) accepted++;
      else if (s === 429) limited++;
    }
    // Every signed-in POST takes a token before its body is read: the teacher
    // already spent 17 (2 oversize + 14 bad + 1 good), so 43 of these pass —
    // plus one per second of wall clock the test took (the bucket refills;
    // the exact arithmetic is checked with a fake clock below).
    assert.ok(accepted >= 43 && accepted <= 46, `the burst allowance is 60 per session (accepted ${accepted})`);
    assert.equal(accepted + limited, 70, "every other report is refused with 429");
    assert.ok(limited >= 24);
    assert.equal(logged.length, accepted, "a refused report logs nothing");
    assert.equal((await POST(req({ event: "query-error", route: "/home" }, parent))).status, 204, "another session still reports");

    // The bucket refills with time (driven by an injected clock).
    let t = 0;
    const lim = new MetricRateLimiter(60, 60, () => t);
    for (let i = 0; i < 60; i++) assert.equal(lim.take("s"), true);
    assert.equal(lim.take("s"), false, "61st in the same instant is refused");
    t += 1000;
    assert.equal(lim.take("s"), true, "one token back after a second");
    assert.equal(lim.take("s"), false);
    t += 60_000;
    for (let i = 0; i < 60; i++) assert.equal(lim.take("s"), true, "full again after a minute");
    const small = new MetricRateLimiter(1, 60, () => t, 3);
    for (const k of ["a", "b", "c", "d", "e"]) assert.equal(small.take(k), true, "the session map is bounded, never refusing a new session");

    // parseMetricBody ignores unknown fields.
    const p = parseMetricBody(JSON.stringify({ ...good, secret: "x" }));
    assert.ok(p.ok && !("secret" in p.metric), "unknown fields are dropped");

    console.log = realLog;
    console.log("clientMetricsRoute selftest: ok");
  } catch (e) {
    console.log = realLog;
    console.error(e);
    process.exit(1);
  }
})();
