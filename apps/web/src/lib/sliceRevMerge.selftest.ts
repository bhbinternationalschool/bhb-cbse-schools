import assert from "node:assert/strict";
import { mergeWithRevs, rowContent, rowRev } from "./sliceRevMerge";

console.log("sliceRevMerge.selftest.ts");

/**
 * The row-version rule. A browser that says which rows it changed, and from
 * which `_rev`, may overwrite a row only if the stored row is still at that
 * `_rev`. Rows it didn't change keep their stored version. Saves that don't
 * say (server writers, older browsers) win as before but bump `_rev` on a
 * real change, so every older copy is behind.
 */

const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id);

// ── The case that started this: approved on WhatsApp, stale "pending" written back
{
  const stored = [{ id: "lr1", status: "approved", _rev: 2 }];
  // The office tab edited the request from version 1 (when it was pending).
  const res = mergeWithRevs(stored, [{ id: "lr1", status: "pending", note: "x" }], { base: { lr1: 1 } });
  assert.deepEqual(res.conflicts, ["lr1"], "an edit from an old version is refused");
  assert.deepEqual(res.rows, stored, "the approval stands");
  assert.deepEqual(res.revs, {});
}

// ── The same tab, current version: accepted and bumped
{
  const stored = [{ id: "lr1", status: "pending", _rev: 1 }];
  const res = mergeWithRevs(stored, [{ id: "lr1", status: "cancelled" }], { base: { lr1: 1 } });
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(res.rows, [{ id: "lr1", status: "cancelled", _rev: 2 }]);
  assert.deepEqual(res.revs, { lr1: 2 });
}

// ── Rows the save didn't change keep the stored version, however stale the copy
{
  const stored = [{ id: "a", v: "new", _rev: 5 }, { id: "b", v: 1, _rev: 1 }];
  const res = mergeWithRevs(stored, [{ id: "a", v: "old" }, { id: "b", v: 2 }], { base: { b: 1 } });
  assert.deepEqual(res.rows, [{ id: "a", v: "new", _rev: 5 }, { id: "b", v: 2, _rev: 2 }]);
  assert.deepEqual(res.conflicts, []);
}

// ── New rows; a row deleted elsewhere is not resurrected
{
  const res = mergeWithRevs([{ id: "a", _rev: 1 }], [{ id: "n" }, { id: "gone", v: 1 }, { id: "old-untouched" }], {
    base: { n: 0, gone: 3 },
  });
  assert.deepEqual(ids(res.rows), ["n", "a"], "new row added; untouched unknown row not added");
  assert.deepEqual(res.revs, { n: 1 });
  assert.deepEqual(res.conflicts, ["gone"], "changing a row deleted meanwhile is a conflict");
}

// ── Legacy rows (no _rev yet) are version 0: the first edit from 0 is accepted
{
  const res = mergeWithRevs([{ id: "a", v: 1 }], [{ id: "a", v: 2 }], { base: { a: 0 } });
  assert.deepEqual(res.rows, [{ id: "a", v: 2, _rev: 1 }]);
}

// ── An unchanged row sent as changed is not bumped
{
  const stored = [{ id: "a", x: 1, y: [1, 2], _rev: 4 }];
  const res = mergeWithRevs(stored, [{ y: [1, 2], x: 1, id: "a" }], { base: { a: 4 } });
  assert.deepEqual(res.rows, stored);
  assert.deepEqual(res.revs, {});
}

// ── No base (server writers / older browsers): save wins, real changes bump
{
  const stored = [{ id: "a", v: 1, _rev: 3 }, { id: "b", v: 1, _rev: 1 }, { id: "c", _rev: 2 }];
  const res = mergeWithRevs(stored, [{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "d" }]);
  assert.deepEqual(res.rows, [
    { id: "a", v: 2, _rev: 4 },
    { id: "b", v: 1, _rev: 1 },
    { id: "d", _rev: 1 },
    { id: "c", _rev: 2 },
  ]);
  assert.deepEqual(res.revs, { a: 4, d: 1 });
  assert.deepEqual(res.conflicts, []);
}

// ── Keys other than id (leave types by code)
{
  const res = mergeWithRevs([{ code: "CL", days: 8, _rev: 1 }], [{ code: "CL", days: 10 }], { key: "code", base: { CL: 1 } });
  assert.deepEqual(res.rows, [{ code: "CL", days: 10, _rev: 2 }]);
}

// ── Chat read receipts: combined even when the copy is late
{
  const stored = [{ id: "m1", text: "hi", readBy: ["s1"], _rev: 2 }];
  const res = mergeWithRevs(stored, [{ id: "m1", text: "hi", readBy: ["s2"] }], { base: { m1: 1 }, union: ["readBy"] });
  assert.deepEqual(res.conflicts, ["m1"]);
  assert.deepEqual(res.rows, [{ id: "m1", text: "hi", readBy: ["s1", "s2"], _rev: 3 }]);
}

// ── Helpers
{
  assert.equal(rowRev({ _rev: 3 }), 3);
  assert.equal(rowRev({}), 0);
  assert.equal(rowRev({ _rev: "x" }), 0);
  assert.equal(rowContent({ b: 1, a: { d: 1, c: 2 }, _rev: 9 }), rowContent({ a: { c: 2, d: 1 }, b: 1 }));
}

console.log("sliceRevMerge.selftest: all assertions passed");
