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
import { voucherToRows } from "@/lib/feesNormalized.server";

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
  const waAt = body.indexOf("sendFeeReceiptWhatsApp(");

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
    /const link = await ensurePaymentLinkHydrated\(\s*row\.ref/,
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

/* ── one unparseable value cannot refuse the whole book ──────────────── */
{
  // BEHAVIOURAL, not source-shape: this is the one assertion in this file that
  // could have caught the 26 Sep failure by running. `jsonb_populate_recordset`
  // casts every header in ONE statement, so "" in a timestamp column aborts
  // the insert and takes all 648 receipts with it — including the one just
  // collected. Verified against Postgres directly: it answers
  //   invalid input syntax for type timestamp with time zone: ""
  const { header } = voucherToRows("tenant", {
    id: "rcv_probe",
    receiptNo: "RCV-PROBE",
    schoolReceiptNo: "",
    source: "payment_link",
    manualBookSeries: "",
    manualBookLeaf: "",
    householdId: "hh",
    academicYearCode: "2026-27",
    collectionDate: "",
    transactionDate: "null",
    transactionId: "",
    collectedAt: "",
    cashierName: "",
    lines: [],
    tenders: [],
    totalPaise: 0,
    note: "",
    voidedAt: "" as unknown as null,
    whatsappSentAt: "Invalid Date" as unknown as null,
  } as never);

  assert.equal(header.voided_at, null, 'an empty voided_at must be null, never ""');
  assert.equal(header.whatsapp_sent_at, null, "an unparseable whatsapp_sent_at must be null");
  assert.match(
    String(header.collection_date),
    /^\d{4}-\d{2}-\d{2}$/,
    "collection_date is always a real date — the column is NOT NULL",
  );
  assert.match(
    String(header.transaction_date),
    /^\d{4}-\d{2}-\d{2}$/,
    'transaction_date falls back to the collection date, never the string "null"',
  );
  assert.ok(
    !Number.isNaN(Date.parse(String(header.collected_at))),
    "collected_at is always parseable",
  );
}

/* ── a refused full push still writes the receipt just collected ─────── */
{
  const normalized = read("paymentsNormalized.server.ts");
  const fees = read("feesNormalized.server.ts");
  const settle = read("paymentSettlement.server.ts");
  void normalized;

  const push = bodyOf(fees, "export async function pushFeeVouchersToDb(");
  assert.match(
    push,
    /freshIds/,
    "a refused whole-book push retries with only the vouchers the server does not hold — " +
      "history it does not carry cannot refuse the new receipt",
  );
  const firstRpc = push.indexOf('rpc("replace_fee_desk_voucher_lines"');
  const retryRpc = push.indexOf('rpc("replace_fee_desk_voucher_lines"', firstRpc + 1);
  assert.ok(retryRpc > firstRpc, "the retry is a second call, after the first was refused");
  assert.match(
    push.slice(retryRpc),
    /narrowed push ALSO refused/,
    "and if the narrowed push fails too, that is reported rather than swallowed",
  );

  // The settlement must check the table, not the return value: on 26 Sep it
  // reported RCV-00648 settled three times while no voucher row existed.
  const body = bodyOf(settle, "export async function settlePaymentLinkWithWhatsApp(");
  assert.match(body, /feeVoucherExistsInDb\(/, "the voucher is read back from the desk table");
  assert.match(
    body,
    /fee_link\.voucher_push_failed/,
    "and a missing voucher is recorded in payment_desk_gateway_events — this service's " +
      "console output never reaches Cloud Logging, so a log line is not a record",
  );
  const readBackAt = body.indexOf("feeVoucherExistsInDb(");
  const waAt = body.indexOf("sendFeeReceiptWhatsApp(");
  assert.ok(readBackAt < waAt, "checked before the parent is sent a receipt for it");
  assert.doesNotMatch(
    body.slice(readBackAt, waAt),
    /return \{ ok: false/,
    "a missing voucher is still not returned as an error — that would make the gateway " +
      "retry and collect the money twice",
  );

  // "I could not look" must never be recorded as "the receipt is missing".
  const exists = bodyOf(fees, "export async function feeVoucherExistsInDb(");
  assert.match(exists, /return null/, "an unanswerable read-back returns null, not false");
}

/* ── a receipt for less than the parent paid is never booked ─────────── */
{
  const settle = read("paymentSettlement.server.ts");
  const checkouts = read("cashfreeCheckouts.server.ts");
  const body = bodyOf(settle, "export async function settlePaymentLinkWithWhatsApp(");

  // THE FOURTH DEFECT, and the only one that would have been WRONG rather
  // than missing. resolveOpenLinesForLink drops any line whose live due it
  // cannot see, and transport dues hydrate in their own module memory. At
  // 07:54 UTC on 26 Sep 2026 that resolved ₹2,000 of AADVIK SINGH's ₹2,500
  // and wrote 200000 onto payment_desk_links (updated_at 07:54:08.23, so the
  // settlement wrote it, not the link's creation). Booking that would have
  // left one head unpaid and the bank ₹500 out.
  assert.match(
    body,
    /ensureFeeDuesInputsHydrated\(\{ force: true \}\)/,
    "the dues inputs are forced fresh BEFORE anything is resolved — a stale " +
      "transport desk is how the ₹500 line disappeared",
  );

  const hydrateAt = body.indexOf("ensureFeeDuesInputsHydrated");
  const resolveAt = body.indexOf("resolveOpenLinesForLink(");
  const applyAt = body.indexOf("applyPaymentLink(");
  assert.ok(hydrateAt >= 0 && resolveAt > hydrateAt, "hydrate first, then resolve");
  assert.ok(
    resolveAt < applyAt,
    "and the total is checked BEFORE applyPaymentLink collects anything",
  );

  assert.match(
    body,
    /resolved\.amountPaise !== opts\.expectedAmountPaise/,
    "the receipt must come to exactly what the gateway took",
  );
  assert.match(
    body,
    /fee_link\.amount_mismatch/,
    "a short resolution is recorded in payment_desk_gateway_events, not only logged",
  );
  assert.match(
    body.slice(resolveAt, applyAt),
    /return \{\s*ok: false/,
    "and it books NOTHING — unlike a failed push, a wrong amount must stop the " +
      "collection, so the claim is released and a retry can still collect it",
  );

  // The caller has to actually supply the figure, or the check is dead code.
  assert.match(
    checkouts,
    /expectedAmountPaise: row\.amountPaise/,
    "settleCashfreeCheckout passes what Cashfree took",
  );
}

/* ── a cached "paid" can never make a real payment be skipped ────────── */
{
  const persistence = read("paymentsPersistence.ts");
  const checkouts = read("cashfreeCheckouts.server.ts");
  const settle = read("paymentSettlement.server.ts");

  // THE FIFTH CAUSE. On the fourth replay attempt the settlement recorded
  // fee_link.already_paid / ignored carrying RCV-00648, while
  // payment_desk_links plainly read status 'open'. The instance had cached the
  // link as paid minutes before the row was put back, and the recovery added
  // earlier only re-reads a link the mirror is MISSING — a stale copy it holds
  // is served forever, because nothing checks a hit for freshness.
  //
  // Settling money reads the desk table and makes that the mirror's copy.
  const recover = bodyOf(persistence, "export async function ensurePaymentLinkHydrated(");
  const authAt = recover.indexOf("opts?.authoritative");
  const mirrorAt = recover.indexOf("const already = inMirror()");
  assert.ok(authAt >= 0, "the recovery takes an authoritative mode");
  assert.ok(
    authAt < mirrorAt,
    "and in that mode the desk table is read BEFORE the mirror is consulted — " +
      "after would defeat the point entirely",
  );
  assert.match(
    recover.slice(authAt, mirrorAt),
    /spliceLinkFromDb\(/,
    "by reading the row and replacing the mirror's copy with it",
  );
  // A failed read must not lose the payment.
  assert.match(
    recover.slice(authAt, mirrorAt),
    /if \(fresh\) return fresh;/,
    "an unreadable row falls through to the mirror rather than refusing outright",
  );

  for (const [name, src] of [
    ["settleCashfreeCheckout", checkouts],
    ["settlePaymentLinkWithWhatsApp", settle],
  ] as const) {
    assert.match(
      src,
      /ensurePaymentLinkHydrated\([\s\S]{0,80}authoritative: true/,
      `${name} resolves the link authoritatively — money is never settled off a cache`,
    );
  }
}

/* ── a parent who pays online gets the approved template ─────────────── */
{
  const settle = read("paymentSettlement.server.ts");
  const body = bodyOf(settle, "export async function settlePaymentLinkWithWhatsApp(");

  // Meta delivers a free-form message only inside the 24-hour window that
  // opens when a parent writes to the school. Paying a link does not open
  // it, so the plain-text sender silently delivered nothing to any family
  // that had not messaged the school that day — and swallowed the failure,
  // the same shape as the lost voucher. feeReceiptAutoWa.server.ts was
  // written for exactly this reason and the counter has used it since; the
  // gateway path was left behind on the old sender.
  assert.match(
    body,
    /sendFeeReceiptWhatsApp\(/,
    "the pay-link receipt goes out through the approved-template sender",
  );
  assert.doesNotMatch(
    body,
    /sendSisFeeReceiptOnWhatsApp\(/,
    "and NOT through the plain-text sender, which Meta drops outside the 24-hour window",
  );
  assert.doesNotMatch(
    read("paymentSettlement.server.ts"),
    /import \{ sendSisFeeReceiptOnWhatsApp/,
    "the plain-text sender is not even imported here any more",
  );

  // The template needs the receipt itself, not just its id.
  assert.match(
    body,
    /loadFees\(\)\.vouchers\.find\(/,
    "the voucher just written is handed to the sender",
  );
  assert.match(
    body,
    /studentNames/,
    "with the children's names the template prints",
  );

  // A receipt that cannot be found must not read as a successful send.
  assert.match(
    body,
    /ok: false, error: "Receipt not found to send"/,
    "a missing receipt is reported, never silently treated as sent",
  );

  // Still never thrown back at the settlement: the money is collected.
  const waAt = body.indexOf("sendFeeReceiptWhatsApp(");
  assert.doesNotMatch(
    body.slice(waAt),
    /return \{ ok: false/,
    "a failed WhatsApp send never fails the settlement — the money is already collected",
  );
}

console.log("  ok");
