/**
 * An empty masters desk must never refuse the server's data.
 *
 * The freeze, as observed in production on 2026-08-10. A browser held zero
 * classes. Every GET /api/school-data/masters-desk returned 135 KB containing
 * 15 classes, and the client discarded all of it, because `shouldTake`
 * required `remoteAt > localEditAt` and hydration itself stamps `localEditAt`.
 * The device then pushed its emptiness and the server logged, once per push:
 *
 *   [masters-desk] rejected wipe push stored=15 incoming=0
 *
 * So the roster showed no classes, the class and section pickers were empty
 * when editing a student, and the 2026-27 session — `status: 'current'` in the
 * database — could not be seen or selected. The server was right, the client
 * was empty, and nothing could move it. Clearing site data was the only cure,
 * which is the repair step this whole migration exists to abolish.
 *
 * The rule: emptiness is not an edit. A desk with no classes never hydrated,
 * so it has nothing worth defending against the database.
 *
 * Safe in one direction only — it can pull data in, never push it out. And
 * there is no legitimate "I deleted every class" state to lose:
 * guardMastersOverwrite refuses those pushes server-side, so such a state
 * can never have become authoritative. This is the client-side half of a rule
 * the server already enforced.
 *
 * The predicate is mirrored here rather than imported because
 * mastersNormalizedClient.ts touches localStorage and Toast at module scope.
 * Keep the two in step.
 *
 * Run: npx tsx src/lib/mastersFreeze.selftest.ts
 */
import assert from "node:assert/strict";

/** Exactly the decision in hydrateMastersDeskFromDb (readFromDb branch). */
function shouldTake(o: {
  remoteAt: string;
  metaUpdatedAt: string;
  localEditAt: string;
  hasRemote: boolean;
  localIsEmpty: boolean;
}): boolean {
  const remoteIsNewer =
    !!o.remoteAt &&
    (!o.metaUpdatedAt || o.remoteAt > o.metaUpdatedAt) &&
    (!o.localEditAt || o.remoteAt > o.localEditAt);
  return remoteIsNewer || ((!o.localEditAt || o.localIsEmpty) && o.hasRemote);
}

const OLD = "2026-08-10T10:15:11.000Z"; // masters row tables' updated_at
const NEW = "2026-08-10T11:05:00.000Z"; // a later local stamp

// ── The exact production freeze ───────────────────────────────────────────
// Empty desk, local stamp NEWER than the server's masters timestamp.
{
  assert.equal(
    shouldTake({
      remoteAt: OLD,
      metaUpdatedAt: "",
      localEditAt: NEW,
      hasRemote: true,
      localIsEmpty: true,
    }),
    true,
    "an EMPTY desk must accept 15 server classes even though its localEditAt " +
      "is newer — this is the state that showed empty class/section pickers " +
      "and hid the 2026-27 session",
  );
}

// ── The protection that must survive ──────────────────────────────────────
// A populated desk with genuine newer local edits still wins. Breaking this
// would silently discard a user's unsaved work, which is worse than a freeze.
{
  assert.equal(
    shouldTake({
      remoteAt: OLD,
      metaUpdatedAt: OLD,
      localEditAt: NEW,
      hasRemote: true,
      localIsEmpty: false,
    }),
    false,
    "real local edits must NOT be clobbered by older server data",
  );
}

// ── Ordinary cases ────────────────────────────────────────────────────────
{
  assert.equal(
    shouldTake({
      remoteAt: NEW,
      metaUpdatedAt: OLD,
      localEditAt: OLD,
      hasRemote: true,
      localIsEmpty: false,
    }),
    true,
    "genuinely newer server data is taken",
  );

  assert.equal(
    shouldTake({
      remoteAt: OLD,
      metaUpdatedAt: "",
      localEditAt: "",
      hasRemote: true,
      localIsEmpty: true,
    }),
    true,
    "a brand-new device bootstraps",
  );

  assert.equal(
    shouldTake({
      remoteAt: OLD,
      metaUpdatedAt: "",
      localEditAt: NEW,
      hasRemote: false,
      localIsEmpty: true,
    }),
    false,
    "an empty server must never overwrite an empty client — nothing to take, " +
      "and pulling 'nothing' would just re-arm the same broken state",
  );
}

// ── Emptiness beats any stamp, however far in the future ──────────────────
// Clock skew on a phone is real, and must not be able to brick a desk.
{
  assert.equal(
    shouldTake({
      remoteAt: OLD,
      metaUpdatedAt: "",
      localEditAt: "2099-01-01T00:00:00.000Z",
      hasRemote: true,
      localIsEmpty: true,
    }),
    true,
    "a wildly skewed clock must not let an empty desk refuse the server",
  );
}

console.log("mastersFreeze.selftest: all assertions passed");
