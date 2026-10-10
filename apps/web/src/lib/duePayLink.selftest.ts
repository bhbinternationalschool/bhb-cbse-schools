/**
 * Self-test: the direct fee payment link — signed, tamper-proof, expiring —
 * and the messages that carry it instead of "GPay, then tap Confirm paid".
 * Run: npx tsx src/lib/duePayLink.selftest.ts
 */

import assert from "node:assert/strict";

import { duePayUrl, signDuePayToken, verifyDuePayToken } from "./duePayToken.server";
import { composeSisDirectPayReply, composeSisDuesReply, composeSisInfoReply, composeSisReceiptsReply, sisBotWelcomeText } from "./sisParentBotEngine";

console.log("duePayLink.selftest.ts");

/* ── the token ─────────────────────────────────────────────── */

const t = signDuePayToken({ householdId: "hh_abc", studentId: "stu_1", scope: "overdue" })!;
assert.ok(t);
const p = verifyDuePayToken(t)!;
assert.equal(p.h, "hh_abc");
assert.equal(p.s, "stu_1");
assert.equal(p.sc, "overdue");

// Editing the family in the token breaks the signature.
const [body, sig] = [t.slice(0, t.lastIndexOf(".")), t.slice(t.lastIndexOf(".") + 1)];
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), h: "hh_other" })).toString("base64url");
assert.equal(verifyDuePayToken(`${forged}.${sig}`), null, "another family's id cannot be swapped in");
assert.equal(verifyDuePayToken(`${body}.AAAAAAAAAAAAAAAAAAAAAA`), null);
assert.equal(verifyDuePayToken("garbage"), null);
assert.equal(verifyDuePayToken(""), null);

// Expired links open nothing.
const old = signDuePayToken({ householdId: "hh_abc", scope: "open", ttlDays: -1 })!;
assert.equal(verifyDuePayToken(old), null);

const url = duePayUrl("https://bhbinternational.school/", { householdId: "hh_abc", scope: "open" });
assert.match(url, /^https:\/\/bhbinternational\.school\/pay\/due\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.ok(url.length < 160, "short enough to read on a phone");

/* ── the messages ──────────────────────────────────────────── */

const lines = [
  { studentName: "MANYA", label: "Tuition Fee · September", amountPaise: 150000, dueOn: "2026-09-10" },
  { studentName: "MANYA", label: "Examination Fee · September", amountPaise: 50000, dueOn: "2026-09-10" },
];
const pay = composeSisDirectPayReply({ hindi: true, url, who: "MANYA (UKG-A)", lines, totalPaise: 200000 });
assert.ok(pay.includes(url), "the link itself");
assert.match(pay, /Tuition Fee · September — ₹1,500/, "what it pays for");
assert.match(pay, /कुल: ₹2,000/);
assert.doesNotMatch(pay, /Confirm paid/);

const dues = composeSisDuesReply({ guardianName: "X", dueLines: [{ studentName: "MANYA", label: "Tuition Fee · September", amountLabel: "₹1,500", dueOn: "2026-09-10" }], totalPaise: 150000, runningMonthOnly: true, hindi: true, payUrl: url });
assert.ok(dues.includes(url), "the dues list carries the link to pay it");
const duesEn = composeSisDuesReply({ guardianName: "X", dueLines: [{ studentName: "MANYA", label: "Tuition Fee · September", amountLabel: "₹1,500", dueOn: "2026-09-10" }], totalPaise: 150000, runningMonthOnly: true, hindi: false, payUrl: url });
assert.ok(duesEn.includes(url));

// Nowhere does a parent get told to pay in GPay and come back to confirm.
for (const text of [
  pay,
  dues,
  duesEn,
  composeSisDuesReply({ guardianName: "X", dueLines: [{ studentName: "A", label: "L", amountLabel: "₹1", dueOn: "2026-09-10" }], totalPaise: 100, hindi: true }),
  composeSisDuesReply({ guardianName: "X", dueLines: [{ studentName: "A", label: "L", amountLabel: "₹1", dueOn: "2026-09-10" }], totalPaise: 100, hindi: false }),
  composeSisInfoReply(true),
  composeSisInfoReply(false),
  composeSisReceiptsReply([{ receiptNo: "R1", date: "2026-09-01", amountLabel: "₹1" }], true),
  composeSisReceiptsReply([{ receiptNo: "R1", date: "2026-09-01", amountLabel: "₹1" }], false),
  sisBotWelcomeText(true, false, true),
  sisBotWelcomeText(false, false, false),
]) {
  assert.doesNotMatch(text, /Confirm paid/, text.slice(0, 60));
  assert.doesNotMatch(text, /GPay \/ UPI (से|pay|link|→)|→ GPay/, text.slice(0, 60));
}

console.log("  ok");
