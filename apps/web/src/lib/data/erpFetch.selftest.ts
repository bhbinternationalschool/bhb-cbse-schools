/**
 * Run: npx tsx src/lib/data/erpFetch.selftest.ts
 *
 * data-layer 1.2. erpFetch adds `X-Bhb-Build` and times the call — and
 * changes nothing else: method, body, credentials, cache, signal, keepalive
 * and the caller's own headers reach fetch as given; the response or the
 * error comes back unchanged; with no build known, `init` itself is passed.
 * Runs the real wrapper against a recording fetch.
 */
import assert from "node:assert/strict";
import { erpFetch, type ErpFetchTiming } from "./erpFetch";
import { noteLoadedBuild, resetClientBuildForTests } from "../clientBuild";

type Call = { input: string | URL; init?: RequestInit };

void (async () => {
  const calls: Call[] = [];
  const timings: ErpFetchTiming[] = [];
  let clock = 1000;
  const answer = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "{}", { status, headers });
  let next: () => Promise<Response> = async () => answer(200, { "content-length": "2" });
  const opts = {
    fetchImpl: async (input: string | URL, init?: RequestInit) => {
      calls.push({ input, init });
      clock += 37;
      return next();
    },
    now: () => clock,
    onTiming: (t: ErpFetchTiming) => timings.push(t),
  };

  // Everything passes through, and the header is added.
  const controller = new AbortController();
  const body = JSON.stringify({ ops: [] });
  const init: RequestInit = {
    method: "post",
    body,
    credentials: "include",
    cache: "no-store",
    signal: controller.signal,
    keepalive: true,
    redirect: "manual",
    headers: { "Content-Type": "application/json", "X-Custom": "kept" },
  };
  const res = await erpFetch("/api/data/sis.students?x=1", init, { ...opts, build: () => "build-7" });
  assert.equal(res.status, 200);
  const sent = calls[0].init!;
  assert.equal(calls[0].input, "/api/data/sis.students?x=1", "the URL is untouched");
  assert.equal(sent.method, "post", "method as given");
  assert.equal(sent.body, body, "the same body object");
  assert.equal(sent.credentials, "include");
  assert.equal(sent.cache, "no-store");
  assert.equal(sent.signal, controller.signal, "the same AbortSignal");
  assert.equal(sent.keepalive, true);
  assert.equal(sent.redirect, "manual");
  const h = new Headers(sent.headers);
  assert.equal(h.get("X-Bhb-Build"), "build-7", "the build header is added");
  assert.equal(h.get("content-type"), "application/json", "the caller's headers are kept");
  assert.equal(h.get("x-custom"), "kept");
  assert.deepEqual(new Headers(init.headers).get("x-bhb-build"), null, "the caller's init is not mutated");
  assert.deepEqual(timings[0], { method: "POST", path: "/api/data/sis.students", status: 200, ms: 37, bytes: 2, failed: false, aborted: false });

  // Headers given as a Headers object or as pairs survive too.
  await erpFetch("/a", { headers: new Headers({ A: "1" }) }, { ...opts, build: () => "b" });
  assert.equal(new Headers(calls[1].init!.headers).get("a"), "1");
  await erpFetch("/a", { headers: [["B", "2"]] }, { ...opts, build: () => "b" });
  assert.equal(new Headers(calls[2].init!.headers).get("b"), "2");

  // No build known yet: init is passed through as the very same object, no header.
  calls.length = 0;
  await erpFetch("/api/x", init, { ...opts, build: () => null });
  assert.equal(calls[0].init, init, "init passed as-is");
  await erpFetch("/api/x", undefined, { ...opts, build: () => null });
  assert.equal(calls[1].init, undefined, "no init stays no init");

  // The default build source is the update bar's first answer (lib/clientBuild).
  resetClientBuildForTests();
  calls.length = 0;
  await erpFetch("/api/x", {}, opts);
  assert.equal(new Headers(calls[0].init?.headers).get("x-bhb-build"), null, "unknown build → no header");
  noteLoadedBuild("from-app-version");
  await erpFetch("/api/x", {}, opts);
  assert.equal(new Headers(calls[1].init!.headers).get("x-bhb-build"), "from-app-version");
  noteLoadedBuild("a-later-build");
  await erpFetch("/api/x", {}, opts);
  assert.equal(new Headers(calls[2].init!.headers).get("x-bhb-build"), "from-app-version", "a later answer never replaces the page's own build");

  // Outcomes: 5xx is a failure (still returned), 4xx is an answer, a network error is rethrown.
  timings.length = 0;
  next = async () => answer(503);
  const r503 = await erpFetch("/api/x", undefined, opts);
  assert.equal(r503.status, 503, "a 5xx is returned, not thrown");
  assert.equal(timings[0].failed, true);
  assert.equal(timings[0].bytes, null, "no declared length → no bytes");
  next = async () => answer(409);
  assert.equal((await erpFetch("/api/x", { method: "DELETE" }, opts)).status, 409);
  assert.equal(timings[1].failed, false, "a 409 is an answer, not a failure");
  assert.equal(timings[1].method, "DELETE");
  const boom = new TypeError("Failed to fetch");
  next = async () => {
    throw boom;
  };
  await assert.rejects(erpFetch("/api/x", undefined, opts), (e) => e === boom, "the same error is rethrown");
  assert.deepEqual([timings[2].status, timings[2].failed, timings[2].aborted], [null, true, false]);
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  next = async () => {
    throw abort;
  };
  await assert.rejects(erpFetch("/api/x", undefined, opts), (e) => e === abort);
  assert.deepEqual([timings[3].failed, timings[3].aborted], [false, true], "an abort is not reported as a failure");

  // A throwing timing sink changes nothing.
  next = async () => answer(200);
  const r = await erpFetch("/api/x", undefined, { ...opts, onTiming: () => {
    throw new Error("sink");
  } });
  assert.equal(r.status, 200, "the response still arrives");

  // The default sink is a no-op in a test process (no window): nothing throws.
  await erpFetch("/api/x", undefined, { fetchImpl: opts.fetchImpl });

  console.log("erpFetch selftest: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
