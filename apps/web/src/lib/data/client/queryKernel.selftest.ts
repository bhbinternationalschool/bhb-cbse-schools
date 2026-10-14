/**
 * Run: npx tsx src/lib/data/client/queryKernel.selftest.ts
 *
 * data-layer 1.4 — the client query kernel's rules, with no browser:
 *  - retry: twice, only when it can help (no answer, 5xx, 408, 429), never on
 *    a 4xx; backoff 1 s, 2 s;
 *  - the versions poll's outcomes: 200 = apply; 401/403 = stop (a parent, a
 *    signed-out tab); 503 / no answer / a malformed body = keep (nothing
 *    invalidated, nothing stopped);
 *  - which queries an answer makes stale: a moved desk value invalidates the
 *    queries that read that desk and no other; the first answer invalidates
 *    nothing unless a query knows it was built from an older value (the race
 *    between a view's read and the poll's first read); a missing desk is a
 *    value of its own;
 *  - the wiring, on a real React Query client (makeErpQueryClient):
 *    pollVersionsOnce marks exactly those queries invalidated and keeps the
 *    last answer; a 403 sets `stopped`; a 503 changes nothing; invalidateDesks
 *    (useErpMutation's after-write step) hits only the desk's queries; the
 *    client's defaults are staleTime 60 s, refetch on focus, retry 2;
 *  - readView: a failure never carries data; `ok:true` without data is a
 *    failure; the server's `versions` comes back as builtFrom;
 *  - parseMyTeaching (useMyTeaching): a shape without unrestricted/teaching
 *    is a failed read, not "no classes".
 */
import assert from "node:assert/strict";

void (async () => {
  try {
    const k = await import("./queryKernel");
    const { ErpQueryError } = k;

    // ── Retry.
    assert.equal(k.shouldRetry(0, new ErpQueryError(null, "offline")), true, "no answer: retry");
    assert.equal(k.shouldRetry(0, new ErpQueryError(503, "down")), true, "503: retry");
    assert.equal(k.shouldRetry(1, new ErpQueryError(500, "boom")), true, "5xx, second try: retry");
    assert.equal(k.shouldRetry(2, new ErpQueryError(503, "down")), false, "at most two retries");
    for (const s of [400, 401, 403, 404, 409]) {
      assert.equal(k.shouldRetry(0, new ErpQueryError(s, "no")), false, `${s}: the server's verdict, not retried`);
    }
    assert.equal(k.shouldRetry(0, new ErpQueryError(429, "slow down")), true, "429: retry");
    assert.equal(k.shouldRetry(0, new Error("TypeError: Failed to fetch")), true, "a thrown error with no status: retry");
    assert.deepEqual([0, 1, 2, 5].map(k.retryDelay), [1000, 2000, 4000, 8000], "backoff 1 s, 2 s, … capped at 8 s");

    // ── The poll's outcome.
    const V = (u: string, c: number | null = 1) => ({ updated_at: u, count: c });
    assert.deepEqual(k.pollOutcome(200, { ok: true, versions: { masters: V("a") } }), { kind: "apply", versions: { masters: V("a") } });
    assert.deepEqual(k.pollOutcome(401, { ok: false }), { kind: "stop" }, "401 stops");
    assert.deepEqual(k.pollOutcome(403, { ok: false, error: "Staff only" }), { kind: "stop" }, "403 (a parent) stops");
    assert.deepEqual(k.pollOutcome(503, { ok: false }), { kind: "keep" }, "503 keeps what is on screen");
    assert.deepEqual(k.pollOutcome(null, null), { kind: "keep" }, "no answer keeps");
    assert.deepEqual(k.pollOutcome(500, null), { kind: "keep" });
    assert.deepEqual(k.pollOutcome(200, { ok: true }), { kind: "keep" }, "200 without versions is not 'nothing moved'");
    assert.deepEqual(k.pollOutcome(200, { ok: true, versions: [] }), { kind: "keep" }, "an array is not a versions object");
    assert.deepEqual(k.pollOutcome(200, null), { kind: "keep" }, "an unreadable body keeps");

    // ── Which queries go stale.
    const prev = { masters: V("a", 15), sis_staff: V("s", 35), timetable: V("t") };
    const queries = [
      { id: "masters-view", desks: ["masters"], builtFrom: { masters: V("a", 15), sis_staff: V("s", 35) } },
      { id: "staff-list", desks: ["sis_staff", "sis_departments"], builtFrom: { sis_staff: V("s", 35), sis_departments: null } },
      { id: "my-teaching", desks: ["sis_staff", "timetable", "masters"], builtFrom: null },
      { id: "rbac", desks: ["rbac"], builtFrom: null },
    ];
    assert.deepEqual(k.queriesToInvalidate(prev, prev, queries), [], "nothing moved: nothing invalidated");
    assert.deepEqual(
      k.queriesToInvalidate(prev, { ...prev, masters: V("b", 16) }, queries),
      ["masters-view", "my-teaching"],
      "masters moved: the masters view and my-teaching (reads masters), not the staff list or rbac",
    );
    assert.deepEqual(
      k.queriesToInvalidate(prev, { ...prev, sis_staff: V("s", 34) }, queries),
      ["staff-list", "my-teaching"],
      "a delete moves the count only: the staff readers go stale (the masters view does not read sis_staff)",
    );
    assert.deepEqual(
      k.queriesToInvalidate(prev, { ...prev, timetable: V("t2") }, queries),
      ["my-teaching"],
    );
    assert.deepEqual(
      k.queriesToInvalidate(null, prev, queries),
      [],
      "first answer: queries built from the current values stay; unknown-built ones have nothing to compare",
    );
    assert.deepEqual(
      k.queriesToInvalidate(null, { ...prev, masters: V("b", 16) }, queries),
      ["masters-view"],
      "first answer newer than what the view was built from: the view is refetched (the read/poll race)",
    );
    assert.deepEqual(
      k.queriesToInvalidate(prev, { masters: V("a", 15), timetable: V("t") }, queries),
      ["staff-list", "my-teaching"],
      "a desk that disappears from the answer moved (absent is a value)",
    );
    assert.equal(k.versionFingerprint(null), k.versionFingerprint(undefined), "null and missing are the same value");
    assert.notEqual(k.versionFingerprint(V("a", 1)), k.versionFingerprint(V("a", 2)));
    assert.deepEqual([...k.movedDesks(null, prev)], [], "nothing moves before the first answer");

    assert.deepEqual(k.queriesForDesks(["masters"], queries), ["masters-view", "my-teaching"], "a masters write: its readers only");
    assert.deepEqual(k.queriesForDesks(["fee"], queries), []);

    // ── The wiring, on a real React Query client.
    const h = await import("./hooks");
    const client = h.makeErpQueryClient();
    const d = client.getDefaultOptions().queries!;
    assert.equal(d.staleTime, 60_000, "staleTime 60 s");
    assert.equal(d.refetchOnWindowFocus, true, "refetch on window focus");
    assert.equal(d.retry, k.shouldRetry, "retry = shouldRetry (2, network/5xx only)");
    assert.equal(d.retryDelay, k.retryDelay);

    const seed = async (key: string, desks: string[], builtFrom: Record<string, unknown> | null) => {
      await client.prefetchQuery({ queryKey: [key], queryFn: async () => ({ data: key, builtFrom }), meta: { desks } });
    };
    await seed("masters", ["masters"], { masters: V("a", 15) });
    await seed("staff-list", ["sis_staff"], { sis_staff: V("s", 35) });
    await seed("my-teaching", ["sis_staff", "timetable", "masters"], null);
    await seed("not-a-desk-query", [], null);
    const invalidated = () =>
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.state.isInvalidated)
        .map((q) => String(q.queryKey[0]))
        .sort();
    const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const state: { last: Record<string, unknown> | null; stopped: boolean } = { last: null, stopped: false };

    const first = await h.pollVersionsOnce(client, state as never, reply(200, { ok: true, versions: prev }));
    assert.equal(first.kind, "apply");
    assert.deepEqual(invalidated(), [], "first answer = what the queries were built from: nothing invalidated");
    assert.deepEqual(state.last, prev, "the answer is remembered");

    const down = await h.pollVersionsOnce(client, state as never, reply(503, { ok: false, error: "unavailable" }));
    assert.equal(down.kind, "keep");
    assert.deepEqual(invalidated(), [], "503: nothing invalidated");
    assert.deepEqual(state.last, prev, "503: the last answer stays the baseline");
    const offline = await h.pollVersionsOnce(client, state as never, async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.equal(offline.kind, "keep", "no answer: keep");

    const moved = await h.pollVersionsOnce(client, state as never, reply(200, { ok: true, versions: { ...prev, masters: V("b", 16) } }));
    assert.deepEqual(moved.invalidated.length, 2);
    assert.deepEqual(invalidated(), ["masters", "my-teaching"], "masters moved: exactly its two readers are invalidated");
    assert.equal(state.stopped, false);

    const parent = await h.pollVersionsOnce(client, state as never, reply(403, { ok: false, error: "Staff only" }));
    assert.equal(parent.kind, "stop");
    assert.equal(state.stopped, true, "403: the poll is told to stop");

    const fresh = h.makeErpQueryClient();
    await fresh.prefetchQuery({ queryKey: ["masters"], queryFn: async () => ({ data: 1, builtFrom: null }), meta: { desks: ["masters"] } });
    await fresh.prefetchQuery({ queryKey: ["staff-list"], queryFn: async () => ({ data: 1, builtFrom: null }), meta: { desks: ["sis_staff"] } });
    const hit = h.invalidateDesks(fresh, ["sis_staff"]);
    assert.equal(hit.length, 1, "invalidateDesks: the desk's queries only");
    assert.deepEqual(
      fresh.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey[0]),
      ["staff-list"],
    );
    client.clear();
    fresh.clear();

    // ── readView.
    const { readView } = await import("./query");
    const json = (status: number, body: unknown) => async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const ok = await readView<{ n: number }>("/api/data/views/masters", {
      fetchImpl: json(200, { ok: true, data: { n: 1 }, versions: { masters: V("a") }, stale: false }),
    });
    assert.ok(ok.ok && ok.data.n === 1);
    assert.deepEqual(ok.ok && ok.builtFrom, { masters: V("a") }, "versions → builtFrom");
    const v1 = await readView("/api/v1/staff/my-classes", { fetchImpl: json(200, { ok: true, data: { unrestricted: true, teaching: [] } }) });
    assert.ok(v1.ok && v1.builtFrom === null, "a v1 answer has no builtFrom");
    const r503 = await readView("/api/data/views/masters", { fetchImpl: json(503, { ok: false, error: "Could not read the school setup" }) });
    assert.ok(!r503.ok && r503.status === 503 && r503.error === "Could not read the school setup");
    assert.ok(!("data" in r503), "a failure carries no data");
    const r401 = await readView("/api/v1/staff/my-classes", { fetchImpl: json(401, { ok: false, error: { code: "unauthorized", message: "Sign in" } }) });
    assert.ok(!r401.ok && r401.status === 401 && r401.error === "Sign in", "the v1 error envelope's message");
    const noData = await readView("/api/data/views/masters", { fetchImpl: json(200, { ok: true }) });
    assert.ok(!noData.ok && noData.status === 502, "ok:true without data is a failure, not an empty answer");
    const notJson = await readView("/api/data/views/masters", { fetchImpl: json(200, "<html>") });
    assert.ok(!notJson.ok, "an unreadable body is a failure");
    const net = await readView("/api/data/views/masters", {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    assert.ok(!net.ok && net.status === null, "no answer: status null");

    // ── parseMyTeaching.
    const { parseMyTeaching } = await import("../../../components/staff/useMyTeaching");
    assert.deepEqual(parseMyTeaching({ unrestricted: false, academicYearCode: "2026-27", teaching: [] }).teaching, [], "a real empty list is a fact");
    for (const bad of [null, {}, { unrestricted: "no", teaching: [] }, { unrestricted: false }]) {
      assert.throws(() => parseMyTeaching(bad), (e: unknown) => e instanceof ErpQueryError, `malformed ${JSON.stringify(bad)} is a failed read`);
    }

    console.log("queryKernel selftest: ok");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
