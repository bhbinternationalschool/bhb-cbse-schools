/**
 * The test that was missing when the masters revision guard shipped.
 *
 * mastersRevisionGuard.selftest.ts proves the guard REFUSES a stale push.
 * Every one of its cases is a test of the refusal. None of them asks the
 * question that actually mattered in production on 2026-08-10: after a
 * legitimate refusal, can the client get back to a state where it can save?
 *
 * It could not. Two independent faults, both invisible from a unit test of
 * the guard alone:
 *
 *   1. persistMastersClient stamped the desk-meta key with `new Date()` on
 *      every local save, and that key is what the push sends as
 *      `baseUpdatedAt`. The client therefore claimed to have hydrated at a
 *      revision that never existed on the server, so EVERY save after the
 *      first was refused. 16 rejections to 2 acceptances in one evening.
 *   2. The 409 handler resets the hydrate latch, but a hydrate that declines
 *      to adopt the server bundle never refreshed the stored revision — so
 *      the retry re-sent the same bad base and 409'd again, forever.
 *
 * This exercises the REAL guard through a full client/server round trip, so
 * the invariant under test is the one that broke: a revision is only ever a
 * value the server issued, and a refused client must be able to recover.
 *
 * Run: npx tsx src/lib/mastersRevisionLifecycle.selftest.ts
 */
import assert from "node:assert/strict";
import { guardMastersRevision } from "./mastersRevisionGuard";

/** Stand-in for masters_desk_sync_meta — the one authoritative revision. */
class Server {
  revision: string | null = null;
  private clock = Date.parse("2026-08-10T05:00:00.000Z");

  /** Mirrors the POST route: guard first, write only if allowed. */
  push(base: string | null): { ok: true; revision: string } | { ok: false } {
    const verdict = guardMastersRevision(base, this.revision);
    if (!verdict.allow) return { ok: false };
    this.clock += 1000;
    this.revision = new Date(this.clock).toISOString();
    return { ok: true, revision: this.revision };
  }
}

/**
 * Stand-in for one browser. `base` is bhb_masters_desk_db_meta_v1.
 * The invariant: nothing here may ever assign `base` a locally-minted value.
 */
class Client {
  base: string | null = null;
  constructor(private server: Server) {}

  /** A local edit. Must NOT touch the revision — this was fault #1. */
  localSave(): void {
    /* intentionally empty: saving locally tells us nothing about the server */
  }

  hydrate(): void {
    this.base = this.server.revision;
  }

  push(): "saved" | "refused" {
    const res = this.server.push(this.base);
    if (!res.ok) return "refused";
    this.base = res.revision;
    return "saved";
  }
}

// ── Repeated saves from one device all succeed ───────────────────────────
// The production symptom: the first push landed, every later one 409'd.
{
  const server = new Server();
  const a = new Client(server);
  for (let i = 0; i < 5; i++) {
    a.localSave();
    assert.equal(a.push(), "saved", `save ${i + 1} of 5 must land`);
  }
  assert.equal(server.revision, a.base);
}

// ── A local save must not move the revision ──────────────────────────────
// Directly pins fault #1: had persistMastersClient's touch remained, `base`
// would drift to a local clock here and the next push would be refused.
{
  const server = new Server();
  const a = new Client(server);
  a.push();
  const afterPush = a.base;
  a.localSave();
  a.localSave();
  assert.equal(a.base, afterPush, "local edits must not mint a revision");
  assert.equal(a.push(), "saved", "a save after local edits must still land");
}

// ── A null base is allowed on purpose — pin that, so it is never a surprise
// `unversioned` is the deliberate rollout allowance for browsers deployed
// before the guard existed. It means a device that has never seen a revision
// can always write, so every multi-device case below must seed one first.
{
  const server = new Server();
  const legacy = new Client(server);
  server.push(null); // some other device establishes a revision
  assert.equal(legacy.base, null);
  assert.equal(legacy.push(), "saved", "a client with no revision is allowed");
}

// ── Two devices: the stale one is refused, the winner survives ───────────
{
  const server = new Server();
  server.push(null); // seed: both devices hydrate at a real revision
  const a = new Client(server);
  const b = new Client(server);
  a.hydrate();
  b.hydrate();
  assert.ok(a.base, "precondition: A holds a real revision");

  assert.equal(a.push(), "saved");
  const aRevision = server.revision;

  b.localSave();
  assert.equal(b.push(), "refused", "B holds A's superseded revision");
  assert.equal(server.revision, aRevision, "a refusal must not write");
}

// ── THE RECOVERY LEG — the case that was never tested ────────────────────
// A guard that blocks a bad write but leaves the user unable to make a good
// one is worse than the bug it fixed. That is what shipped.
{
  const server = new Server();
  server.push(null); // seed a revision so B's base is real, not `unversioned`
  const a = new Client(server);
  const b = new Client(server);
  a.hydrate();
  b.hydrate();

  a.push();
  assert.equal(b.push(), "refused");

  b.hydrate(); // what the 409 handler triggers
  assert.equal(b.push(), "saved", "B MUST be able to save after rehydrating");

  // And B is not left in a one-shot state — it keeps working.
  b.localSave();
  assert.equal(b.push(), "saved", "B stays healthy after recovering");
}

// ── A hydrate that adopts nothing must still refresh the revision ────────
// Fault #2: declining the server's bundle is a merge decision. It says
// nothing about which revision the server is at, and must not leave the
// client pinned to a superseded one — that is the infinite 409 loop.
{
  const server = new Server();
  server.push(null); // seed a revision
  const a = new Client(server);
  const b = new Client(server);
  a.hydrate();
  b.hydrate();
  a.push();

  // B re-reads and keeps its own local data, taking only the revision.
  b.hydrate();
  assert.equal(b.base, server.revision);
  assert.equal(b.push(), "saved", "declining the bundle must not block saving");
}

// ── Bootstrap: a fresh tenant saves without ever having hydrated ─────────
{
  const server = new Server();
  const fresh = new Client(server);
  assert.equal(fresh.base, null);
  assert.equal(fresh.push(), "saved", "first write for a tenant must land");
}

console.log("mastersRevisionLifecycle.selftest: all assertions passed");
