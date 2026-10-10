/**
 * A failed read of stored masters must never be guarded against as "empty".
 *
 * What this cost, on 2026-08-10. fetchMastersDeskFromDb() destructured
 * `{ data }` from Supabase and dropped `error`, so a query that failed
 * returned an EMPTY bundle. The push route guards with
 * guardMastersOverwrite(stored.classes, incoming.classes), and that guard
 * treats zero stored classes as `bootstrap` — a first write for a new tenant,
 * allow it.
 *
 * The database was under load (26-48s latencies, one 500). A read timed out.
 * The guard saw no stored classes, called it a bootstrap, and accepted a
 * wholesale id replacement:
 *
 *   - all 15 class ids rewritten (Nursery cls_p7bw8cpc -> cls_esqvpaw3)
 *   - all section ids and academic year ids rewritten
 *   - 711 students orphaned on BOTH class_id and section_id
 *   - the academic year flipped back to one that ended 2026-03-31
 *
 * Recovery was a hand-built remap: each class's student head-count happened to
 * be unique, so name -> count -> old id could be reconstructed. That is luck,
 * not a recovery plan. Two classes of equal size and the mapping would have
 * been ambiguous.
 *
 * The rule: unknown is not empty. Refusing a push costs a retry; guarding
 * against data that was never read costs the id generation.
 *
 * This is the same rule ReadFail encodes in lib/data/types.ts, which
 * deliberately has no `rows` property. That type was written during Stage 1
 * precisely so this could not happen — but the masters push path predates it
 * and was never migrated. Worth remembering when judging how much of the
 * migration is "done".
 *
 * Run: npx tsx src/lib/mastersStoredReadFailure.selftest.ts
 */
import assert from "node:assert/strict";
import { guardMastersOverwrite } from "./mastersWriteGuard";

type Read = { classIds: string[]; readFailed: boolean };

const STORED = ["cls_p7bw8cpc", "cls_2hwxqq84", "cls_oobr6iej"];
const REGENERATED = ["cls_esqvpaw3", "cls_zo45unpl", "cls_r71796n8"];

/** The route's decision, in order: read check first, then the guard. */
function routeAccepts(read: Read, incoming: string[]): boolean {
  if (read.readFailed) return false; // 503, nothing written
  return guardMastersOverwrite(read.classIds, incoming).allow;
}

// ── The production failure ────────────────────────────────────────────────
{
  const failedRead: Read = { classIds: [], readFailed: true };

  // The guard alone, given what the failed read produced, says yes.
  assert.equal(
    guardMastersOverwrite([], REGENERATED).allow,
    true,
    "the guard treats zero stored classes as bootstrap — correct in itself, " +
      "which is exactly why the READ must be checked before reaching it",
  );

  assert.equal(
    routeAccepts(failedRead, REGENERATED),
    false,
    "the route must refuse when the stored read failed. This single decision " +
      "is what orphaned 711 students on class and section.",
  );
}

// ── A genuinely new tenant still bootstraps ───────────────────────────────
// Deleting this distinction would break first-time setup, so it is pinned.
{
  assert.equal(
    routeAccepts({ classIds: [], readFailed: false }, REGENERATED),
    true,
    "an empty tenant that was READ SUCCESSFULLY may still bootstrap",
  );
}

// ── Normal operation is unaffected ────────────────────────────────────────
{
  const ok: Read = { classIds: STORED, readFailed: false };

  assert.equal(
    routeAccepts(ok, [...STORED, "cls_new1"]),
    true,
    "an ordinary edit that keeps the id generation is accepted",
  );
  assert.equal(
    routeAccepts(ok, REGENERATED),
    false,
    "a regenerated id set is still refused when the read succeeded",
  );
  assert.equal(
    routeAccepts(ok, []),
    false,
    "an empty push is still refused as a wipe",
  );
}

// ── A failed read is refused whatever it carries ──────────────────────────
// Including a push that would otherwise look perfectly ordinary: the point is
// that we cannot judge it at all without the stored state.
{
  for (const incoming of [STORED, REGENERATED, [], ["cls_p7bw8cpc"]]) {
    assert.equal(
      routeAccepts({ classIds: [], readFailed: true }, incoming),
      false,
      `refused regardless of payload (${incoming.length} ids) — an unread ` +
        "database cannot be reasoned about",
    );
  }
}

console.log("mastersStoredReadFailure.selftest: all assertions passed");
