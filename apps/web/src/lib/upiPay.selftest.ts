/**
 * Run: npx tsx src/lib/upiPay.selftest.ts
 *
 * Director, 7 Oct 2026: pay by UPI from the ERP and fill the UTR from the
 * app's success screenshot. The texts below are shaped like what Google
 * Vision reads off each app's success screen.
 */
import assert from "node:assert/strict";
import { asMobile, buildUpiPayLink, checkUpiProof, isVpa, parseUpiProofText, payeeNamesAgree, UPI_NO_UTR_HELP } from "./upiPay";

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

/* ── 15 Oct 2026: the director's GPay "Paid" screen, exactly as Vision read it ──
 * "₹" came back as "*". It used to give amount 0, so the ERP upload said "No
 * amount could be read" and the WhatsApp reader dropped the photo. */
const DIRECTOR_PAID = `*11,500
Paid to
Randhir Sungh
15 October 2026, 12:28am
POWERED BY
UPI
UNIFIED PAYMENTS INTERFACE`;
{
  const p = parseUpiProofText(DIRECTOR_PAID);
  assert.equal(p.amountPaise, 1150000, "*11,500 is ₹11,500");
  assert.equal(p.payeeName, "Randhir Sungh");
  assert.equal(p.utr, "", "a success screen has no UTR — not guessed");
  assert.equal(p.paidOn, "2026-10-15");
  const c = checkUpiProof(p, { amountPaise: 1150000, payeeName: "RANDHIR SINGH", today: "2026-10-15" });
  assert.ok(!c.ok, "no UTR, so not recordable");
  assert.ok(c.problems.some((x) => x.startsWith(UPI_NO_UTR_HELP)), "says to send the details screen");
  assert.ok(!c.problems.some((x) => /amount/i.test(x)), "the amount was read");
  assert.ok(!c.problems.some((x) => /payment to/i.test(x)), "Sungh is an OCR slip for Singh, not someone else");
}

/* ── ₹ misread as other symbols, and dropped altogether ── */
for (const sign of ["₹", "*", "%", "?", "¥", "Z", "z", "₨"]) {
  const p = parseUpiProofText(`${sign}11,500\nPaid to\nRandhir Sungh`);
  assert.equal(p.amountPaise, 1150000, `"${sign}11,500"`);
}
for (const pre of ["Rs.", "Rs. ", "Rs ", "Rs", "INR ", "INR", "INR."]) {
  assert.equal(parseUpiProofText(`Paid to Raju\n${pre}2,500.50`).amountPaise, 250050, `"${pre}2,500.50"`);
}
assert.equal(parseUpiProofText("Paid *11,500 to Randhir\nUPI").amountPaise, 1150000, "mid-line, grouped");
assert.equal(parseUpiProofText("211,500\nPaid to\nRandhir").amountPaise, 0, "a ₹ read as 2 cannot be told from a real 2 — not guessed");

/* GPay details screen, headline ₹ dropped by OCR */
{
  const p = parseUpiProofText(`11,500
Completed
15 Oct 2026, 12:28 am
To RANDHIR SINGH
randhir@okicici
From: ASHISH SINGH (Union Bank of India)
5371
UPI transaction ID
628802353231
Google transaction ID
CICAgKDx9oS0Ag`);
  assert.equal(p.amountPaise, 1150000, "the headline, not the account suffix 5371");
  assert.equal(p.utr, "628802353231");
  assert.equal(p.payeeName, "RANDHIR SINGH");
  assert.equal(p.app, "gpay");
  assert.ok(checkUpiProof(p, { amountPaise: 1150000, payeeName: "Randhir Singh", today: "2026-10-15" }).ok);
}

/* PhonePe details, ₹ read as "%" */
{
  const p = parseUpiProofText(`Transaction Successful
12:28 am on 15 Oct 2026
Paid to
RANDHIR SINGH
9876543210@ybl
%11,500
Transfer Details
Transaction ID
T2610150028123456789012
Debited from
XXXXXX5371
UTR: 628802353231`);
  assert.equal(p.amountPaise, 1150000);
  assert.equal(p.utr, "628802353231");
  assert.equal(p.app, "phonepe");
}

/* Paytm, ₹ read as "*" with a space */
{
  const p = parseUpiProofText(`Paid Successfully to
Randhir Singh
* 11,500
UPI Ref No: 628802353231
15 Oct 2026, 12:28 AM
paytm`);
  assert.equal(p.amountPaise, 1150000);
  assert.equal(p.utr, "628802353231");
}

/* BHIM, amount with paise and no sign at all */
{
  const p = parseUpiProofText(`BHIM
Transaction Successful
Amount
11,500.00
Paid to
RANDHIR SINGH
UPI Ref ID 628802353231
15/10/2026 00:28`);
  assert.equal(p.amountPaise, 1150000);
  assert.equal(p.utr, "628802353231");
  assert.equal(p.paidOn, "2026-10-15");
  assert.equal(p.app, "bhim");
}

/* Negatives: a UTR, a mobile, a date, a time, a year are never the amount */
assert.equal(parseUpiProofText("Paid to\nRandhir\n628802353231").amountPaise, 0, "a 12-digit UTR alone");
assert.equal(parseUpiProofText("UPI transaction ID\n628802353231").amountPaise, 0);
assert.equal(parseUpiProofText("Paid to\n9919101755\nUPI").amountPaise, 0, "a 10-digit mobile");
assert.equal(parseUpiProofText("Paid to Raju\n15\nOctober 2026\nUPI").amountPaise, 0, "a day split from its month");
assert.equal(parseUpiProofText("Paid to Raju\nOctober\n2026\n15 October 2026\nUPI").amountPaise, 0, "a year");
assert.equal(parseUpiProofText("Paid to Raju\n12:28\n15 Oct 2026").amountPaise, 0, "a time");
assert.equal(parseUpiProofText("Paid to Raju\nBank account\n5371").amountPaise, 0, "an account suffix");
assert.equal(parseUpiProofText("Paid\n1,500\nTotal\n2,000").amountPaise, 0, "two equally likely amounts — not guessed");

/* Who was paid: OCR slips forgiven, other people not */
assert.ok(payeeNamesAgree("Randhir Sungh", "RANDHIR SINGH"));
assert.ok(payeeNamesAgree("Randhlr Sungh", "RANDHIR SINGH"), "a slip in every word, whole name lines up");
assert.ok(payeeNamesAgree("RANDHIR SINGH", "Randhir Singh"));
assert.ok(!payeeNamesAgree("Rakesh", "Rajesh"), "one near word alone never matches");
assert.ok(!payeeNamesAgree("Rakesh Yadav", "Rajesh Patel"));
assert.ok(!payeeNamesAgree("Suraj Kumar", "Randhir Singh"));
assert.ok(!payeeNamesAgree("Ram Lal", "Raj Pal"), "short words get no slack");
assert.ok(!payeeNamesAgree("", "Randhir Singh"));

console.log("  ✓ UPI pay link + success-screenshot reading — GPay, PhonePe, Paytm; refusals");
console.log("  ✓ OCR'd rupee signs, sign-less headline amounts, UTR/mobile/date never the amount, tolerant payee names");
