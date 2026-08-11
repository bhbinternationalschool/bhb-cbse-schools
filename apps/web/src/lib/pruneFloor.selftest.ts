/**
 * No sync may delete a whole table because a client turned up empty.
 *
 * `deleteStale` was copy-pasted into 20 modules and called from 91 places.
 * An audit on 2026-08-11 found 86 of those calls unguarded: they passed the
 * ids the client happened to be holding, and every stored row not in that set
 * was deleted. With an EMPTY payload the keep-set is empty, so every row is
 * stale and the table is erased.
 *
 * That is not theoretical. The attendance register for 2026-08-10 was gone by
 * the next morning — pushed away by a phone whose localStorage had been
 * dropped on quota. The emptiness check in that module ran AFTER the delete.
 *
 * The tables reachable this way include bank and cash ledgers, payroll runs
 * and their audit trail, fee cheques, library issues, RTE seats, and the 1,919
 * admission records the school actually holds today. Most are empty only
 * because those modules are not in use yet — each becomes live the day it is.
 *
 * sis_students was the one module already protected, guarded after the roster
 * incident. It is why the roster survived a day that cost attendance a day.
 *
 * This test pins the floor everywhere: every deleteStale implementation must
 * refuse an empty keep-set, and must not treat a failed read as "no rows".
 *
 * The floor is NOT sufficient on its own. A client holding 3 of 900 rows
 * still prunes 897 — that needs per-module scoping, the way attendance now
 * prunes only within the dates its payload covers. Recorded in docs/TODO.md.
 *
 * Run: npx tsx src/lib/pruneFloor.selftest.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const LIB = __dirname;

const files = fs
  .readdirSync(LIB)
  .filter((f) => f.endsWith(".server.ts"))
  .filter((f) => fs.readFileSync(path.join(LIB, f), "utf8").includes("function deleteStale"));

// ── Every implementation is guarded ───────────────────────────────────────
{
  assert.ok(
    files.length >= 20,
    `expected the 20 known deleteStale modules, found ${files.length} — if a ` +
      "module was removed, update this test deliberately",
  );

  for (const f of files) {
    const src = fs.readFileSync(path.join(LIB, f), "utf8");

    assert.ok(
      /keepIds\.size === 0/.test(src),
      `${f}: deleteStale must refuse an empty keep-set. Without it, a client ` +
        "whose cache was dropped erases the whole table — which is how the " +
        "2026-08-10 attendance register was lost.",
    );

    assert.ok(
      /const \{ data, error \}/.test(src),
      `${f}: deleteStale must capture the read error. "Could not read the " +
        "table" and "the table is empty" must not be the same value in a ` +
        "function that deletes.",
    );
  }
}

// ── The predicate itself ──────────────────────────────────────────────────
function wouldDelete(storedIds: string[], keepIds: string[]): string[] {
  if (keepIds.length === 0) return [];
  const keep = new Set(keepIds);
  return storedIds.filter((id) => !keep.has(id));
}

{
  const stored = ["a", "b", "c"];

  assert.deepEqual(
    wouldDelete(stored, []),
    [],
    "an empty payload deletes nothing at all",
  );

  assert.deepEqual(
    wouldDelete(stored, ["a", "b", "c"]),
    [],
    "a complete payload deletes nothing",
  );

  assert.deepEqual(
    wouldDelete(stored, ["a", "b"]),
    ["c"],
    "a genuine removal still prunes — the floor must not disable pruning, " +
      "or a record deleted in the UI comes back on the next sync",
  );

  // The gap the floor does NOT close, stated so nobody mistakes it for safety.
  assert.deepEqual(
    wouldDelete(["a", "b", "c"], ["a"]),
    ["b", "c"],
    "a PARTIAL payload still prunes the rest — the floor stops the empty " +
      "case only. Per-module date/scope narrowing is the remaining work.",
  );
}

console.log(`pruneFloor.selftest: all assertions passed (${files.length} modules)`);
