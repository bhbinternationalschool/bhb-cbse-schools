/**
 * Run: npx tsx src/lib/upiPay.selftest.ts
 *
 * Director, 7 Oct 2026: pay by UPI from the ERP and fill the UTR from the
 * app's success screenshot. The texts below are shaped like what Google
 * Vision reads off each app's success screen.
 */
import assert from "node:assert/strict";
import { asMobile, buildUpiPayLink, checkUpiProof, isVpa, parseUpiProofText } from "./upiPay";

console.log("upiPay.selftest.ts");

/* ── The link ── */
assert.ok(isVpa("rajesh.patel@okaxis"));
assert.ok(isVpa("9876543210@ybl"));
assert.ok(!isVpa("9876543210"), "a bare mobile is not a UPI ID");
assert.ok(!isVpa("rajesh@"));
assert.equal(asMobile("+91 98765 43210"), "9876543210");
assert.equal(asMobile("12345"), "");
{
  const link = buildUpiPayLink({ payeeVpa: "rajesh@okaxis", payeeName: "Rajesh Patel", amountPaise: 1425000, note: "Salary 2026-09 · STF-014" });
  assert.ok(link.startsWith("upi://pay?"));
  const q = new URLSearchParams(link.slice("upi://pay?".length));
  assert.equal(q.get("pa"), "rajesh@okaxis");
  assert.equal(q.get("pn"), "Rajesh Patel");
  assert.equal(q.get("am"), "14250.00");
  assert.equal(q.get("cu"), "INR");
  assert.equal(q.get("tn"), "Salary 2026-09 · STF-014");
  assert.ok(!link.includes("+"), "spaces as %20, never +");
  assert.ok(!q.has("mc") && !q.has("tr"), "no merchant fields on a person-to-person payment");
  assert.throws(() => buildUpiPayLink({ payeeVpa: "9876543210", payeeName: "x", amountPaise: 100, note: "" }), /UPI ID/);
  assert.throws(() => buildUpiPayLink({ payeeVpa: "ab@okaxis", payeeName: "x", amountPaise: 0, note: "" }), /more than zero/);
  const long = buildUpiPayLink({ payeeVpa: "ab@okaxis", payeeName: "x", amountPaise: 100, note: "n".repeat(80) });
  assert.equal(new URLSearchParams(long.slice(10)).get("tn")!.length, 50);
}

/* ── Google Pay ── */
const GPAY = `₹14,250
Completed
7 Oct 2026, 1:42 pm
To RAJESH PATEL
rajesh@okaxis
From: ASHISH SINGH (Union Bank of India) ••••5371
ashishsingh@okhdfcbank
UPI transaction ID
628012345678
Google transaction ID
CICAgKDx9oS0Ag
Powered by UPI`;
{
  const p = parseUpiProofText(GPAY);
  assert.equal(p.utr, "628012345678");
  assert.equal(p.amountPaise, 1425000);
  assert.equal(p.paidOn, "2026-10-07");
  assert.equal(p.payeeName, "RAJESH PATEL");
  assert.equal(p.payeeVpa, "rajesh@okaxis", "the payee, not the From account");
  assert.equal(p.status, "success");
  assert.equal(p.app, "gpay");
  const c = checkUpiProof(p, { amountPaise: 1425000, payeeVpa: "Rajesh@OKAXIS", today: "2026-10-07" });
  assert.ok(c.ok, c.problems.join(" | "));
}

/* ── PhonePe ── */
const PHONEPE = `Transaction Successful
08:14 pm on 06 Oct 2026
Paid to
RAJESH PATEL
9876543210@ybl
₹2,000
Transfer Details
Transaction ID
T2510062014123456789012
UTR: 627912345601
Debited from XXXXXX5371`;
{
  const p = parseUpiProofText(PHONEPE);
  assert.equal(p.utr, "627912345601", "the UTR, not the PhonePe transaction id");
  assert.equal(p.amountPaise, 200000);
  assert.equal(p.paidOn, "2026-10-06");
  assert.equal(p.payeeName, "RAJESH PATEL");
  assert.equal(p.payeeVpa, "9876543210@ybl");
  assert.equal(p.app, "phonepe");
}

/* ── Paytm ── */
{
  const p = parseUpiProofText(`Paid Successfully\nRs. 1,500\nTo: Sharma Stationers\nUPI Ref No: 627800001111\nOct 5, 2026, 10:02 AM\npaytm`);
  assert.equal(p.utr, "627800001111");
  assert.equal(p.amountPaise, 150000);
  assert.equal(p.paidOn, "2026-10-05");
  assert.equal(p.payeeName, "Sharma Stationers");
  assert.equal(p.app, "paytm");
}

/* ── Refusals: failed, wrong amount, wrong person, no UTR, ambiguous numbers ── */
{
  const failed = parseUpiProofText(GPAY.replace("Completed", "Payment failed"));
  assert.equal(failed.status, "failed");
  assert.ok(!checkUpiProof(failed, { amountPaise: 1425000, today: "2026-10-07" }).ok);

  const p = parseUpiProofText(GPAY);
  const wrongAmt = checkUpiProof(p, { amountPaise: 1525000, today: "2026-10-07" });
  assert.ok(!wrongAmt.ok && /₹14,250/.test(wrongAmt.problems.join(" ")));
  const wrongVpa = checkUpiProof(p, { amountPaise: 1425000, payeeVpa: "suraj@okaxis", today: "2026-10-07" });
  assert.ok(!wrongVpa.ok && /suraj@okaxis/.test(wrongVpa.problems.join(" ")));
  const wrongName = checkUpiProof({ ...p, payeeVpa: "" }, { amountPaise: 1425000, payeeName: "Suraj Kumar", today: "2026-10-07" });
  assert.ok(!wrongName.ok);
  const rightName = checkUpiProof({ ...p, payeeVpa: "" }, { amountPaise: 1425000, payeeName: "Rajesh Patel", today: "2026-10-07" });
  assert.ok(rightName.ok);
  const future = checkUpiProof(p, { amountPaise: 1425000, today: "2026-10-06" });
  assert.ok(!future.ok, "dated after today");

  const noLabelTwo = parseUpiProofText("₹500\nCompleted\n123456789012\n210987654321");
  assert.equal(noLabelTwo.utr, "", "two unlabelled 12-digit numbers — not guessed");
  const noLabelOne = parseUpiProofText("₹500\nCompleted\nRef 123456789012\nCall 9876543210");
  assert.equal(noLabelOne.utr, "123456789012", "one unlabelled 12-digit number, the mobile is 10 digits");
  assert.ok(!checkUpiProof(parseUpiProofText("₹500 Completed"), { amountPaise: 50000, today: "2026-10-07" }).ok, "no UTR");
}

console.log("  ✓ UPI pay link + success-screenshot reading — GPay, PhonePe, Paytm; refusals");
