/**
 * Self-test: shared table sorting.
 * Run: npx tsx apps/web/src/lib/tableSort.selftest.ts
 *
 * The rule worth protecting: a blank cell is unknown, not zero and not "A".
 * It sinks to the bottom in both directions, so reversing a sort never
 * promotes missing data to the top of the screen.
 */

import assert from "node:assert/strict";

import {
  compareSortValues,
  nextSortDir,
  sortRowsBy,
} from "./tableSort";

console.log("tableSort.selftest.ts");

/* ── numbers sort numerically, not lexically ────────────────── */

assert.deepEqual(
  sortRowsBy([{ n: 10 }, { n: 9 }, { n: 100 }], (r) => r.n).map((r) => r.n),
  [9, 10, 100],
);
assert.deepEqual(
  sortRowsBy([{ n: 10 }, { n: 9 }, { n: 100 }], (r) => r.n, "desc").map((r) => r.n),
  [100, 10, 9],
);

/* ── strings use natural order ──────────────────────────────── */

// "Class 10" must follow "Class 9", not sit between 1 and 2.
assert.deepEqual(
  sortRowsBy(
    [{ c: "Class 10" }, { c: "Class 2" }, { c: "Class 9" }],
    (r) => r.c,
  ).map((r) => r.c),
  ["Class 2", "Class 9", "Class 10"],
);

// Roll numbers held as text still order like numbers.
assert.deepEqual(
  sortRowsBy([{ r: "12" }, { r: "2" }, { r: "1" }], (r) => r.r).map((r) => r.r),
  ["1", "2", "12"],
);

// Case does not split the list.
assert.deepEqual(
  sortRowsBy([{ n: "banerjee" }, { n: "Ahmed" }, { n: "Chopra" }], (r) => r.n).map(
    (r) => r.n,
  ),
  ["Ahmed", "banerjee", "Chopra"],
);

/* ── THE rule: blanks are unknown, and stay at the bottom ───── */

const withBlanks = [
  { name: "Meera", roll: 3 },
  { name: "Arun", roll: null },
  { name: "Zoya", roll: 1 },
  { name: "Kabir", roll: null },
];

assert.deepEqual(
  sortRowsBy(withBlanks, (r) => r.roll).map((r) => r.name),
  ["Zoya", "Meera", "Arun", "Kabir"],
  "ascending: values first, blanks last",
);

assert.deepEqual(
  sortRowsBy(withBlanks, (r) => r.roll, "desc").map((r) => r.name),
  ["Meera", "Zoya", "Arun", "Kabir"],
  "descending: order flips but blanks STAY last",
);

// Empty and whitespace-only strings count as blank too.
assert.deepEqual(
  sortRowsBy(
    [{ s: "b" }, { s: "" }, { s: "a" }, { s: "   " }],
    (r) => r.s,
  ).map((r) => r.s),
  ["a", "b", "", "   "],
);

// Zero is a value, not a blank — it must not be exiled with the unknowns.
assert.deepEqual(
  sortRowsBy([{ n: 5 }, { n: null }, { n: 0 }], (r) => r.n).map((r) => r.n),
  [0, 5, null],
);

/* ── stability ──────────────────────────────────────────────── */

const ties = [
  { id: "a", k: 1 },
  { id: "b", k: 1 },
  { id: "c", k: 1 },
];
assert.deepEqual(sortRowsBy(ties, (r) => r.k).map((r) => r.id), ["a", "b", "c"]);
assert.deepEqual(
  sortRowsBy(ties, (r) => r.k, "desc").map((r) => r.id),
  ["a", "b", "c"],
  "equal rows keep their original order in both directions",
);

/* ── the input array is not mutated ─────────────────────────── */

const original = [{ n: 3 }, { n: 1 }, { n: 2 }];
sortRowsBy(original, (r) => r.n);
assert.deepEqual(original.map((r) => r.n), [3, 1, 2]);

/* ── booleans ───────────────────────────────────────────────── */

assert.deepEqual(
  sortRowsBy([{ b: true }, { b: false }], (r) => r.b).map((r) => r.b),
  [false, true],
);

/* ── direction toggle ───────────────────────────────────────── */

assert.equal(nextSortDir("asc"), "desc");
assert.equal(nextSortDir("desc"), "asc");

/* ── comparator directly ────────────────────────────────────── */

assert.ok(compareSortValues(1, 2) < 0);
assert.ok(compareSortValues(2, 1) < 0 === false);
assert.equal(compareSortValues(null, null), 0);
assert.ok(compareSortValues(null, 1) > 0, "null sorts after a value");
assert.ok(compareSortValues(null, 1, "desc") > 0, "…in descending order too");

console.log("  ok");
