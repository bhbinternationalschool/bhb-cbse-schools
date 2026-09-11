/**
 * Replies to a fee reminder that are not commands: "need time" and
 * "already paid", in Hindi, Hinglish and English — with the exact messages
 * parents sent on 11 Sep 2026.
 * Run: npx tsx src/lib/sisParentBotFeeReplies.selftest.ts
 */
import assert from "node:assert/strict";
import {
  composeSisClaimsPaidReply,
  composeSisNeedTimeAsk,
  composeSisPromiseRecorded,
  detectSisBotIntent,
  detectSisFeeReplyIntent,
  parseSisPromiseToPay,
  promiseSummaryForOffice,
} from "./sisParentBotEngine";

console.log("sisParentBotFeeReplies.selftest.ts");

/* ── what parents actually wrote ── */
assert.equal(detectSisFeeReplyIntent("थोड़ा समय चाहिए"), "need_time");
assert.equal(detectSisFeeReplyIntent("thoda samay chahiye"), "need_time");
assert.equal(detectSisFeeReplyIntent("Thoda time do sir"), "need_time");
assert.equal(detectSisFeeReplyIntent("salary aane par de denge"), "need_time");
assert.equal(detectSisFeeReplyIntent("agle hafte jama kar denge"), "need_time");
assert.equal(detectSisFeeReplyIntent("अगले महीने दे देंगे"), "need_time");
assert.equal(detectSisFeeReplyIntent("भुगतान हो गया"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("jama kar diye hai"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("Jama kar diya hai sir"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("fees de di hai"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("Already paid on 5th"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("payment done"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("जमा कर दिया है"), "claims_paid");
/* "jama kar denge" is a promise, not a claim — the tense decides */
assert.equal(detectSisFeeReplyIntent("kal jama kar denge"), "need_time");
/* not fee replies */
assert.equal(detectSisFeeReplyIntent("DUES"), null);
assert.equal(detectSisFeeReplyIntent("Only setambar mahine ka baki h"), null);
assert.equal(detectSisFeeReplyIntent("Security deposit kya hai"), null);
assert.equal(detectSisFeeReplyIntent("hi"), null);
assert.equal(detectSisFeeReplyIntent("2"), null);
/* the keyword matcher alone would have filed these wrongly */
assert.equal(detectSisBotIntent("Already paid on 5th"), "receipts", "control: the old path read 'paid' as RECEIPTS");

/* ── how much and by when ── */
const T = "2026-09-11"; // a Friday
let p = parseSisPromiseToPay("2000 15 tarikh tak", T);
assert.equal(p.amountPaise, 200000);
assert.equal(p.byDate, "2026-09-15");
p = parseSisPromiseToPay("₹1,500 kal", T);
assert.equal(p.amountPaise, 150000);
assert.equal(p.byDate, "2026-09-12");
p = parseSisPromiseToPay("पूरा अगले सोमवार", T);
assert.equal(p.full, true);
assert.equal(p.amountPaise, null);
assert.equal(p.byDate, "2026-09-14", "next Monday from a Friday");
p = parseSisPromiseToPay("3000 by Monday", T);
assert.equal(p.byDate, "2026-09-14");
p = parseSisPromiseToPay("5 din me 2500", T);
assert.equal(p.byDate, "2026-09-16");
assert.equal(p.amountPaise, 250000);
p = parseSisPromiseToPay("agle hafte", T);
assert.equal(p.byDate, "2026-09-18");
assert.equal(p.amountPaise, null);
p = parseSisPromiseToPay("10 tarikh ko pura", T);
assert.equal(p.byDate, "2026-10-10", "the 10th has passed this month → next month");
p = parseSisPromiseToPay("2 hazar 20 sep", T);
assert.equal(p.amountPaise, 200000);
assert.equal(p.byDate, "2026-09-20");
p = parseSisPromiseToPay("salary aane par", T);
assert.equal(p.byDate, null, "no date given → none invented");
assert.equal(p.amountPaise, null);
/* a two-digit day is not an amount */
p = parseSisPromiseToPay("15 tarikh", T);
assert.equal(p.amountPaise, null);
assert.equal(p.byDate, "2026-09-15");

/* ── the words ── */
assert.match(composeSisNeedTimeAsk(true), /कितनी राशि/);
assert.match(composeSisNeedTimeAsk(true), /कब तक/);
assert.match(composeSisNeedTimeAsk(false), /how much/);
assert.match(composeSisClaimsPaidReply(true), /क्षमा करें/);
assert.match(composeSisClaimsPaidReply(true), /दोबारा जाँच/);
assert.match(composeSisClaimsPaidReply(false), /Sorry/);
assert.match(composeSisClaimsPaidReply(false), /re-check our records/);
const rec = composeSisPromiseRecorded(parseSisPromiseToPay("2000 15 tarikh tak", T), true);
assert.match(rec, /₹2,000/);
assert.match(rec, /15 सितंबर/);
assert.match(composeSisPromiseRecorded(parseSisPromiseToPay("salary aane par", T), false), /get in touch/);
assert.match(promiseSummaryForOffice(parseSisPromiseToPay("2000 15 tarikh tak", T)), /₹2,000, by 2026-09-15/);
/* never a menu in any of these */
for (const s of [composeSisNeedTimeAsk(true), composeSisClaimsPaidReply(true), rec]) assert.doesNotMatch(s, /KIDS|DUES|MENU/);

console.log("ok");
