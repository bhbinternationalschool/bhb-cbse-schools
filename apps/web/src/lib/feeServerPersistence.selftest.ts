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

/* ── a stale mirror can never answer "no such pay-link" ─────────────── */
{
  const persistence = read("paymentsPersistence.ts");
  const normalized = read("paymentsNormalized.server.ts");
  const checkouts = read("cashfreeCheckouts.server.ts");
  const settle = read("paymentSettlement.server.ts");

  // THE SECOND FAILURE OF THE SAME ₹2,500. With the voucher push in place,
  // three settlement attempts still booked nothing: each recorded
  // `fee_link.settlement_failed / Pay-link not found` while
  // `payment_desk_links` held the link the whole time. The mirror the lookup
  // read is a cache behind a 45-second TTL and a desk-table fingerprint, and
  // its emptiness test only asks after master classes — so a slice with zero
  // pay-links reads as healthy, and the fingerprint only moves when the table
  // is written, which an already-created link does not do.
  const recover = bodyOf(persistence, "export async function ensurePaymentLinkHydrated(");

  const mirrorAt = recover.indexOf("inMirror()");
  const rehydrateAt = recover.indexOf("ensurePaymentsHydratedServer(");
  const directAt = recover.indexOf("fetchPaymentLinkFromDb");
  assert.ok(mirrorAt >= 0, "it looks in the mirror first — the cheap answer");
  assert.ok(
    mirrorAt < rehydrateAt,
    "then re-hydrates payments unconditionally, bypassing the TTL and fingerprint guards",
  );
  assert.ok(
    rehydrateAt < directAt,
    "and only then reads the single link straight from the desk table",
  );
  assert.match(
    recover,
    /setMirrorSlice\("payments"/,
    "a recovered link is spliced INTO the mirror: applyPaymentLink loads the mirror itself, " +
      "so handing the link back alone would not let it settle",
  );
  assert.match(
    recover,
    /\.filter\(\(l\) => l\.id !== one\.id\)/,
    "the splice replaces only this link and keeps every other one",
  );

  // Scoped to one tenant and one link, lines included: a link settled
  // without its lines books an amount attributable to no due.
  const single = bodyOf(normalized, "export async function fetchPaymentLinkFromDb(");
  assert.match(single, /\.eq\("tenant_id", tenantId\)/, "scoped to the tenant");
  assert.match(single, /payment_desk_link_lines/, "and reads the link's lines");

  // Both settlement entry points must go through it. A lookup that reads the
  // mirror directly is the bug.
  assert.match(
    checkouts,
    /const link = await ensurePaymentLinkHydrated\(row\.ref\)/,
    "settleCashfreeCheckout resolves the link through the recovery, not from the mirror",
  );
  assert.doesNotMatch(
    checkouts,
    /getPaymentLink\(row\.ref, loadPayments\(\)\)/,
    "the bare mirror lookup is gone, not merely wrapped",
  );

  const settleBody = bodyOf(settle, "export async function settlePaymentLinkWithWhatsApp(");
  const guardAt = settleBody.indexOf("ensurePaymentLinkHydrated(");
  const applyAt = settleBody.indexOf("applyPaymentLink(");
  assert.ok(guardAt >= 0, "the shared settle function guards too — the webhook path uses it");
  assert.ok(guardAt < applyAt, "and guards BEFORE it tries to collect");
}

console.log("  ok");
