import assert from "node:assert/strict";
import { concessionGrantStatus } from "./rbac";

console.log("concessionAuthority.selftest.ts");

/**
 * Who may make a concession EFFECTIVE.
 *
 * A concession is money the school agrees not to collect, so recording one
 * and letting it stand are separate acts. Approval used to depend on the
 * AMOUNT alone: an assigned user granting ₹500 under a ₹5,000 auto-approve
 * ceiling approved it themselves, which is the hole this closes.
 *
 * The amount test survives — it can still hold a large grant back from
 * someone who could otherwise approve it — but it can never approve one for
 * a person without the authority.
 */

// ── Someone who cannot approve never gets an approved grant ─────────────
{
  assert.equal(
    concessionGrantStatus(false, true),
    "pending",
    "an assigned user's grant stays pending even when the amount is small",
  );
  assert.equal(concessionGrantStatus(false, false), "pending");
}

// ── An approver still answers to the ceiling ────────────────────────────
{
  assert.equal(
    concessionGrantStatus(true, true),
    "approved",
    "within the ceiling, an approver's grant takes effect at once",
  );
  assert.equal(
    concessionGrantStatus(true, false),
    "pending",
    "over the ceiling it waits, however senior the person is",
  );
}

// ── The authority check is the one that cannot be talked round ──────────
{
  // Stated as a property rather than four cases: there is NO combination in
  // which someone unable to approve ends up with an approved grant.
  for (const amountAllowsAuto of [true, false]) {
    assert.equal(
      concessionGrantStatus(false, amountAllowsAuto),
      "pending",
      `canApprove=false must be pending (amountAllowsAuto=${amountAllowsAuto})`,
    );
  }
  // And approval is only ever reachable with BOTH.
  const approvedCombos = [true, false].flatMap((a) =>
    [true, false]
      .filter((b) => concessionGrantStatus(a, b) === "approved")
      .map((b) => [a, b]),
  );
  assert.deepEqual(
    approvedCombos,
    [[true, true]],
    "approved must require the authority AND the amount",
  );
}

console.log("concessionAuthority.selftest: all assertions passed");
