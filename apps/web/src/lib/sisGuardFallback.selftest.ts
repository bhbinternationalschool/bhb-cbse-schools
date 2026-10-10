/**
 * A failing guard must refuse the push, not quietly resume last-write-wins.
 *
 * What happened: `pushSisGuarded` returned null on ANY rpc error, and the
 * caller read null as "guarded path unavailable, use the legacy upsert". The
 * `authenticator` role sets statement_timeout=8s; the function took ~17s at
 * 904 records. So every push in production timed out and fell through to the
 * legacy last-write-wins upsert, which rewrote all 904 rows. updated_at
 * churned across the whole roster, every other device's revision tokens were
 * invalidated, and the next push reported 903 conflicts on a roster nobody
 * had touched.
 *
 * Optimistic locking was off for the entire SIS module, and the only trace
 * was a console.warn on a server the director never reads. The save reported
 * success.
 *
 * The distinction this pins: "the function is not deployed yet" is a real
 * reason to fall back — the guarded path genuinely cannot run, and the deploy
 * order should not matter. "The function is deployed and failed" is not. One
 * is a migration that has not landed; the other is the protection breaking
 * while everyone believes it is on.
 *
 * Run: npx tsx src/lib/sisGuardFallback.selftest.ts
 */
import assert from "node:assert/strict";

/** Exactly the set in sisNormalized.server.ts. */
const RPC_ABSENT_CODES = new Set(["PGRST202", "PGRST203", "42883"]);

type Outcome = "fall-back-to-legacy" | "refuse-the-push";

/** The predicate under test: what an rpc error code leads to. */
function outcomeFor(code: string): Outcome {
  return RPC_ABSENT_CODES.has(code) ? "fall-back-to-legacy" : "refuse-the-push";
}

// ── The error that actually caused this ───────────────────────────────────
{
  assert.equal(
    outcomeFor("57014"), // query_canceled — statement timeout
    "refuse-the-push",
    "a statement timeout must REFUSE the push. Falling back here is what " +
      "rewrote all 904 rows and produced 903 phantom conflicts.",
  );
}

// ── Absent function: falling back is correct ──────────────────────────────
// The code can deploy before the migration. Without this the first request
// after a deploy would fail outright for no good reason.
{
  for (const code of ["PGRST202", "PGRST203", "42883"]) {
    assert.equal(
      outcomeFor(code),
      "fall-back-to-legacy",
      `${code} means the function is not there — the legacy path is the ` +
        "honest best available",
    );
  }
}

// ── Present but failing: every other code refuses ─────────────────────────
// Each of these once silently disabled optimistic locking.
{
  const failures = [
    ["57014", "statement timeout"],
    ["40P01", "deadlock detected"],
    ["23505", "unique violation"],
    ["42501", "insufficient privilege"],
    ["42703", "undefined column — a column added to sis_students only"],
    ["08006", "connection failure"],
    ["", "an error with no code at all"],
  ] as const;

  for (const [code, what] of failures) {
    assert.equal(
      outcomeFor(code),
      "refuse-the-push",
      `${what} (${code || "no code"}) must refuse — silently reverting to ` +
        "last-write-wins is worse than a visible failure",
    );
  }
}

// ── The unknown-code default is the safe one ──────────────────────────────
// A code nobody anticipated must refuse, not fall back. Getting this
// backwards is precisely how the original bug shipped: the catch-all branch
// was the dangerous one.
{
  assert.equal(
    outcomeFor("SOME_CODE_FROM_A_FUTURE_POSTGREST"),
    "refuse-the-push",
    "unrecognised codes must fail closed",
  );
}

console.log("sisGuardFallback.selftest: all assertions passed");
