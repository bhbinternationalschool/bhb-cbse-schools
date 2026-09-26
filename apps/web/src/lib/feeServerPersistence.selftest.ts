/**
 * Self-test: money collected by the SERVER reaches the database.
 * Run: npx tsx apps/web/src/lib/feeServerPersistence.selftest.ts
 *
 * THE FAILURE THIS EXISTS FOR. On 26 September 2026 AADVIK SINGH's father
 * paid ₹2,500 through a Cashfree pay-link at 09:32 IST. Cashfree took the
 * money. `collectPayment` allocated receipt RCV-00648 and returned ok, and
 * the settlement recorded `fee_link.settled` carrying that number. No voucher
 * was ever written: the highest row in `fee_desk_vouchers` was still
 * RCV-00647. So there was no receipt, the WhatsApp receipt had nothing to
 * send, and the family still read as owing the ₹2,500 they had just paid.
 *
 * The cause was four lines. `saveFees` on the server wrote the in-memory
 * mirror slice and returned; `scheduleFeesSync` on the server returned at
 * once. A browser pushed its edits to the database and the server did not —
 * and a payment gateway webhook has no browser.
 *
 * These are source-level assertions rather than a live collection, because
 * the thing that broke was not arithmetic. It was a missing write, and a
 * test that stubs the database would have passed on the broken code.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("feeServerPersistence.selftest.ts");

const LIB = join(process.cwd(), process.cwd().endsWith("apps/web") ? "src/lib" : "apps/web/src/lib");
const read = (f: string) => readFileSync(join(LIB, f), "utf8");

/**
 * A declaration and everything up to the next top-level `export`.
 *
 * Deliberately not "to the first `\n}`": a function whose parameters are an
 * inline object type closes that type at column 0 (`}): Promise<`), so that
 * rule returns the parameter list and nothing else — which is exactly how the
 * first version of this test passed while asserting nothing.
 */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `could not find ${decl}`);
  const next = src.indexOf("\nexport ", at + decl.length);
  const body = next === -1 ? src.slice(at) : src.slice(at, next);
  assert.ok(body.length > decl.length, `empty body for ${decl}`);
  return body;
}

/* ── the settlement path pushes the voucher it just wrote ────────────── */
{
  const settle = read("paymentSettlement.server.ts");

  assert.match(
    settle,
    /pushFeesRemoteServer/,
    "settlePaymentLinkWithWhatsApp must push the fee desk — collectPayment's voucher " +
      "reaches only the in-memory mirror on the server, and a gateway webhook has no browser",
  );

  const body = bodyOf(settle, "export async function settlePaymentLinkWithWhatsApp(");
  const applyAt = body.indexOf("applyPaymentLink(");
  const pushAt = body.indexOf("pushFeesRemoteServer(");
  const waAt = body.indexOf("sendSisFeeReceiptOnWhatsApp(");

  assert.ok(applyAt >= 0 && pushAt >= 0 && waAt >= 0, "all three steps are present");
  assert.ok(applyAt < pushAt, "the money is collected before it is pushed");
  assert.ok(
    pushAt < waAt,
    "and pushed BEFORE the WhatsApp receipt — the parent must not be sent a receipt " +
      "for a voucher the database does not have",
  );

  // Fired and forgotten, this would race the reply: Cloud Run stops giving the
  // instance CPU once the webhook answers.
  assert.match(
    body,
    /await pushFeesRemoteServer\(/,
    "the push is awaited, not left to a background task the instance may never run",
  );

  // A failed push must not be reported as a settlement failure: the gateway
  // would retry and the money would be collected twice.
  assert.doesNotMatch(
    body.slice(pushAt, waAt),
    /return \{ ok: false/,
    "a failed push is logged, not returned as an error that would make the gateway retry",
  );
}

/* ── the counter route already did this; it is the precedent ─────────── */
{
  const counter = read("../app/api/v1/staff/fees/collect/route.ts");
  assert.match(
    counter,
    /pushFeesRemoteServer\(loadFees\(\)\)/,
    "the staff counter route pushes by hand after collecting — which is why counter " +
      "receipts survived and gateway ones did not. If this ever goes, both paths break.",
  );
}

/* ── one settlement per order, claimed before the money is collected ─── */
{
  const src = read("cashfreeCheckouts.server.ts");

  assert.match(src, /claimCheckoutForSettlement/, "the claim exists");
  assert.match(src, /releaseCheckoutClaim/, "and is given back when fulfilment fails");

  const claim = bodyOf(src, "async function claimCheckoutForSettlement(");
  // The claim IS the conditional update. Without `neq` both duplicate
  // webhooks would win it, which is what happened on 26 Sep: two handlers,
  // 52ms apart, both allocating receipt RCV-00648.
  assert.match(claim, /\.neq\("status", "paid"\)/, "the flip to paid is conditional");
  assert.match(claim, /\.select\(/, "and reports whether THIS caller won it");

  // The claim must be taken BEFORE the switch that collects the money.
  const claimAt = src.indexOf("const claimed = await claimCheckoutForSettlement");
  const switchAt = src.indexOf("switch (row.kind) {");
  assert.notEqual(claimAt, -1, "the claim is taken in settleCashfreeCheckout");
  assert.ok(
    claimAt < switchAt,
    "the claim must be taken BEFORE fulfilment — marking the order paid afterwards, " +
      "as it used to, cannot stop a duplicate webhook that is already collecting",
  );

  // And the old after-the-fact marker must be gone, not merely bypassed.
  assert.doesNotMatch(src, /markCheckoutPaid/, "the post-hoc marker is removed");
}

console.log("  ok");
