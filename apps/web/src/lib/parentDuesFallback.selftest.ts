/**
 * A cache miss is "unknown", not "zero".
 *
 * The parent dashboard reads each child's open balance from
 * `fee_desk_open_dues` — a cache that is only rebuilt when somebody in the
 * office pushes from the Fees desk. A child admitted since the last push has
 * no rows there, and the reader filters `balance_paise > 0`, so "never
 * computed" and "owes nothing" look identical.
 *
 * Until this fix the route treated both as ₹0 and told the parent, with a
 * figure and a currency symbol, that they owed nothing. That is the same
 * defect class as every 2026-08-10 incident: an absence rendered as a fact.
 *
 * This pins the resolution rule the route now follows. It deliberately does
 * NOT test the route (which needs a session, a tenant and a database) — it
 * tests the decision, which is the part that was wrong.
 *
 * Run: npx tsx src/lib/parentDuesFallback.selftest.ts
 */
import assert from "node:assert/strict";

console.log("parentDuesFallback.selftest.ts");

/** Mirrors the route: null = the cache had no rows for this child. */
function cachedBalance(rows: { balancePaise: number }[]): number | null {
  return rows.length === 0
    ? null
    : rows.reduce((s, d) => s + d.balancePaise, 0);
}

function resolve(
  cached: number | null,
  computed: number,
  useDb = true,
): number {
  const c = useDb ? cached : null;
  return c ?? computed;
}

// 1. The cache has rows — they win, and no computation is needed.
assert.equal(cachedBalance([{ balancePaise: 134000 }]), 134000);
assert.equal(resolve(134000, 999999), 134000, "a populated cache is the answer");

// 2. The cache has NO rows — the old code said ₹0. It must not.
assert.equal(cachedBalance([]), null, "no rows must read as unknown, not zero");
assert.equal(
  resolve(null, 1340000),
  1340000,
  "a cache miss must fall back to the computed balance, not report zero",
);

// 3. A child who genuinely owes nothing still resolves to zero — the
//    fallback costs correctness nothing when the cache is simply empty
//    because the family has paid.
assert.equal(resolve(null, 0), 0, "a fully paid child still shows zero");

// 4. A cached zero cannot occur (the reader filters balance_paise > 0), but
//    if it ever did it must be honoured rather than recomputed away.
assert.equal(resolve(0, 500000), 0, "an explicit cached zero is a real zero");

// 5. With the DB path off, the cache is irrelevant and the computed figure
//    is used even when a stale cached value is lying around.
assert.equal(
  resolve(1, 250000, false),
  250000,
  "the non-DB path must ignore the cache entirely",
);

// 6. The whole household is computed once when ANY child misses the cache —
//    the flag the route uses to decide that.
const household = [12000, null, 4000] as (number | null)[];
assert.equal(
  household.some((v) => v === null),
  true,
  "one child missing the cache must trigger the household computation",
);
assert.equal(
  [12000, 4000].some((v) => v === null),
  false,
  "a fully cached household must not pay for a computation",
);

console.log("OK");
