/**
 * UDISE+ documents over WhatsApp — what may be written from a photo.
 * Run: npx tsx src/lib/udiseDocIntake.selftest.ts
 */
import assert from "node:assert/strict";
import { aadhaarChecksumValid, aadhaarDigits, maskAadhaar } from "./aadhaar";
import {
  compareNames,
  docSlotFor,
  missingDocsFor,
  normalizeName,
  parseUdiseDocExtract,
  planUdiseCorrections,
  renderOfficeAlert,
  renderParentAck,
  matchPaymentToReceipts,
  renderPaymentProofAck,
  renderPaymentProofOfficeAlert,
  type UdiseDocExtract,
} from "./udiseDocIntakeAi";

console.log("udiseDocIntake.selftest.ts");

/* ── Verhoeff ─────────────────────────────────────────────────────── */
// 2345 6789 0124 and 4991 1866 5246 are the published worked examples;
// flipping any one digit must fail.
const GOOD = "234567890124";
const GOOD2 = "499118665246";
assert.equal(aadhaarChecksumValid(GOOD), true);
assert.equal(aadhaarChecksumValid(GOOD2), true);
assert.equal(aadhaarChecksumValid("2345 6789 0124"), true, "spaces allowed");
assert.equal(aadhaarChecksumValid("234567890128"), false, "last digit wrong");
assert.equal(aadhaarChecksumValid("224567890124"), false, "second digit wrong");
assert.equal(aadhaarChecksumValid("23456789012"), false, "eleven digits");
assert.equal(aadhaarChecksumValid("034567890124"), false, "never starts with 0");
assert.equal(aadhaarChecksumValid("134567890124"), false, "never starts with 1");
let flips = 0;
for (let i = 0; i < 12; i += 1) {
  const alt = GOOD.slice(0, i) + String((Number(GOOD[i]) + 1) % 10) + GOOD.slice(i + 1);
  if (!aadhaarChecksumValid(alt)) flips += 1;
}
assert.equal(flips, 12, "every single-digit error is caught");
assert.equal(aadhaarDigits("2345-6789-0124"), GOOD);
assert.equal(aadhaarDigits("2345 6789"), "");
assert.equal(maskAadhaar(GOOD), "XXXX XXXX 0124");

/* ── Parser: unknown must not become fact ─────────────────────────── */
const base = { docType: "aadhaar", person: "child", nameOnDoc: "Aarav Sharma", dob: "2019-05-12", aadhaarNumber: GOOD, gender: "M", fatherName: "", motherName: "", address: "Vill Ayar, Varanasi", pincode: "221007", missing: [], notes: "" };
const p1 = parseUdiseDocExtract(JSON.stringify(base))!;
assert.equal(p1.aadhaarNumber, GOOD);
assert.equal(p1.dob, "2019-05-12");
assert.equal(p1.pincode, "221007");

const bad = parseUdiseDocExtract(JSON.stringify({ ...base, aadhaarNumber: "234567890128", dob: "2019", pincode: "22100" }))!;
assert.equal(bad.aadhaarNumber, "", "a number that fails the checksum is dropped");
assert.equal(bad.dob, "", "a bare year is not a date of birth");
assert.equal(bad.pincode, "", "five digits is not a PIN");
assert.ok(bad.missing.includes("aadhaarNumber") && bad.missing.includes("dob") && bad.missing.includes("pincode"));

assert.equal(parseUdiseDocExtract("not json"), null);
assert.equal(parseUdiseDocExtract("```json\n" + JSON.stringify(base) + "\n```")!.docType, "aadhaar", "fenced JSON accepted");
assert.equal(parseUdiseDocExtract(JSON.stringify({ ...base, docType: "passport" }))!.docType, "other");
assert.equal(parseUdiseDocExtract(JSON.stringify({ ...base, person: "uncle" }))!.person, "unknown");
assert.equal(parseUdiseDocExtract(JSON.stringify({ ...base, gender: "Female" }))!.gender, "F");

/* ── Names ────────────────────────────────────────────────────────── */
assert.equal(normalizeName("Master Aarav Kumar Sharma"), "aarav sharma");
assert.equal(compareNames("Aarav Sharma", "AARAV SHARMA"), "same");
assert.equal(compareNames("Aarav Sharma", "Arav Sarma"), "spelling");
assert.equal(compareNames("Priyanshu Yadav", "Priyanshu Kumar Yadav"), "same", "suffix dropped");
assert.equal(compareNames("Aarav Sharma", "Riya Sharma"), "different");
assert.equal(compareNames("Ramesh Singh", "Suresh Singh"), "different", "one syllable is a different person");
assert.equal(compareNames("Aarav", "Aarav Sharma"), "spelling", "surname added");
assert.equal(compareNames("", "Aarav"), "different");

/* ── Plan: the child's Aadhaar card ───────────────────────────────── */
const student = { id: "s1", fullName: "Arav Sarma", dob: "2019-12-05", gender: "", aadhaarNumber: "", aadhaarLast4: "", fatherName: "Rakesh Sharma", motherName: "Sunita", fatherAadhaarNumber: "", motherAadhaarNumber: "" };
const household = { address: "", pincode: "" };
const plan = planUdiseCorrections({ extract: p1, student, household });
assert.equal(plan.docKey, "aadhaar");
const by = (f: string) => plan.changes.find((c) => c.field === f);
assert.equal(by("fullName")?.after, "AARAV SHARMA", "written in the roster's own convention, not the card's");
assert.equal(by("fullName")?.apply, true, "a spelling fix is applied");
assert.equal(by("dob")?.after, "2019-05-12");
assert.equal(by("dob")?.before, "2019-12-05", "the day/month swap the old parser caused gets corrected");
assert.equal(by("aadhaarNumber")?.apply, true);
assert.equal(by("gender")?.after, "M");
assert.equal(by("address")?.target, "household");
assert.equal(by("address")?.after, "VILL AYAR, VARANASI", "an address follows the same convention");
assert.equal(by("pincode")?.after, "221007");
assert.equal(plan.changes.filter((c) => !c.apply).length, 0);

// Same record already correct: nothing to do, and the parent is told so.
const same = planUdiseCorrections({ extract: p1, student: { ...student, fullName: "Aarav Sharma", dob: "2019-05-12", gender: "M", aadhaarNumber: GOOD, aadhaarLast4: "0124" }, household: { address: "Vill Ayar, Varanasi", pincode: "221007" } });
assert.equal(same.changes.length, 0);
assert.match(renderParentAck({ plan: same, childName: "Aarav Sharma", language: "en" }), /already matched/);

// A different child's card: NOTHING is applied, the office decides.
const wrongChild = planUdiseCorrections({ extract: { ...p1, nameOnDoc: "Riya Sharma" }, student, household });
assert.equal(wrongChild.changes.filter((c) => c.apply).length, 0, "no field from a stranger's card");
assert.equal(wrongChild.changes.find((c) => c.field === "fullName")?.apply, false);
assert.ok(wrongChild.flags.some((f) => /does not match/.test(f)));

// Gender disagreement is never overwritten silently.
const g = planUdiseCorrections({ extract: p1, student: { ...student, gender: "F" }, household });
assert.equal(by.call(null, "x"), undefined);
assert.equal(g.changes.find((c) => c.field === "gender")?.apply, false);

// Only last-4 on record and the card agrees: "completed", still applied.
const l4 = planUdiseCorrections({ extract: p1, student: { ...student, aadhaarLast4: "0124" }, household });
assert.match(l4.changes.find((c) => c.field === "aadhaarNumber")!.reason, /completed/);

/* ── Plan: the father's Aadhaar ───────────────────────────────────── */
const fatherDoc: UdiseDocExtract = { ...p1, person: "father", nameOnDoc: "Rakesh Kumar Sharma", dob: "1988-01-01", aadhaarNumber: GOOD2, gender: "M" };
const fp = planUdiseCorrections({ extract: fatherDoc, student, household });
assert.equal(fp.changes.find((c) => c.field === "fatherAadhaarNumber")?.after, GOOD2, "a number is not a name — untouched");
assert.equal(fp.changes.find((c) => c.field === "dob"), undefined, "a parent's DOB never touches the child");
assert.equal(fp.changes.find((c) => c.field === "aadhaarNumber"), undefined);
assert.equal(fp.changes.find((c) => c.field === "fullName"), undefined, "the parent's name never overwrites the child's");
assert.equal(fp.changes.find((c) => c.field === "fatherName"), undefined, "Rakesh Kumar Sharma == Rakesh Sharma");
assert.equal(fp.docKey, "aadhaar");

// Father's card but the name is somebody else: held.
const strangerDad = planUdiseCorrections({ extract: { ...fatherDoc, nameOnDoc: "Mohan Verma" }, student, household });
assert.equal(strangerDad.changes.filter((c) => c.apply).length, 0);

/* ── Plan: birth certificate ──────────────────────────────────────── */
const bc: UdiseDocExtract = { docType: "birth_certificate", person: "unknown", nameOnDoc: "Aarav Sharma", dob: "2019-05-12", aadhaarNumber: "", gender: "M", fatherName: "Rakesh Sharma", motherName: "Sunita Sharma", address: "", pincode: "", payment: null, missing: [], notes: "" };
const bp = planUdiseCorrections({ extract: bc, student, household });
assert.equal(bp.person, "child", "a birth certificate is the child's document");
assert.equal(bp.docKey, "birthCert");
assert.equal(bp.changes.find((c) => c.field === "motherName")?.after, "SUNITA SHARMA");
assert.equal(bp.changes.find((c) => c.field === "motherName")?.apply, true);
assert.equal(bp.changes.find((c) => c.field === "dob")?.apply, true);
assert.equal(bp.changes.find((c) => c.field === "address"), undefined, "a birth certificate carries no current address");

/* ── Address proof without a PIN: address unchanged ───────────────── */
const ap: UdiseDocExtract = { ...bc, docType: "address_proof", person: "father", nameOnDoc: "Rakesh Sharma", dob: "", fatherName: "", motherName: "", address: "Vill Ayar", pincode: "" };
const app = planUdiseCorrections({ extract: ap, student, household });
assert.equal(app.changes.find((c) => c.field === "address"), undefined);
assert.ok(app.flags.some((f) => /PIN/.test(f)));
assert.equal(docSlotFor("address_proof"), "addressProof");
assert.equal(docSlotFor("other"), null);

/* ── Unreadable ───────────────────────────────────────────────────── */
const other = planUdiseCorrections({ extract: { ...bc, docType: "other", nameOnDoc: "" }, student, household });
assert.equal(other.changes.length, 0);
assert.equal(other.docKey, null);

/* ── What people read ─────────────────────────────────────────────── */
const ackHi = renderParentAck({ plan, childName: "Aarav Sharma", language: "hi" });
assert.match(ackHi, /मिल गया/);
assert.match(ackHi, /XXXX XXXX 0124/, "Aadhaar is masked even to the parent");
assert.doesNotMatch(ackHi, new RegExp(GOOD), "never the full number in a chat");
const office = renderOfficeAlert({ plan, childName: "Aarav Sharma", classLabel: "Class 1-A", guardianName: "Rakesh Sharma", fileUrl: "/api/documents/student/s1/aadhaar" });
assert.match(office.text, /Aadhaar card received/);
assert.match(office.text, /Change in UDISE\+ portal/);
assert.ok(office.portalChanges.some((p) => p.startsWith("Date of Birth (dd/mm/yyyy) → 12/05/2019")), office.portalChanges.join(" | "));
assert.doesNotMatch(office.text, new RegExp(GOOD), "masked for the office too");
assert.match(office.text, /Arav Sarma → \*AARAV SHARMA\*/);
assert.match(office.oneLine, /6 fields updated/);
const heldOffice = renderOfficeAlert({ plan: wrongChild, childName: "Arav Sarma", classLabel: "Class 1-A", guardianName: "Rakesh", fileUrl: null });
assert.match(heldOffice.text, /Needs your decision/);
assert.match(heldOffice.text, /SIS unchanged/);

/* ── The request list ─────────────────────────────────────────────── */
assert.equal(missingDocsFor({ gaps: ["student_aadhaar", "pen"], hasDob: true, hasAddress: true, language: "en" }), "child's Aadhaar card");
assert.equal(missingDocsFor({ gaps: ["parent_aadhaar"], hasDob: false, hasAddress: false, language: "en" }), "father's or mother's Aadhaar card, birth certificate, address proof (ration card / electricity bill)");
assert.match(missingDocsFor({ gaps: ["student_aadhaar"], hasDob: true, hasAddress: true, language: "hi" }), /आधार/);
assert.equal(missingDocsFor({ gaps: ["pen", "apaar"], hasDob: true, hasAddress: true, language: "en" }), "", "a portal-side gap asks the parent for nothing");

/* ── A payment the parent is showing us ──────────────────────────────
 *
 * Four families answered yesterday's fee reminder with "भुगतान हो गया",
 * and the bot asks them for the receipt or a screenshot. Before this, a
 * screenshot came back as "could not be recognised as an Aadhaar card".
 */
const payJson = (over = {}) =>
  JSON.stringify({
    docType: "payment_proof", person: "unknown", nameOnDoc: "", dob: "", aadhaarNumber: "",
    gender: "", fatherName: "", motherName: "", address: "", pincode: "",
    payment: { amount: "2500", dateIso: "2026-09-10", reference: "428812345678", method: "UPI", payeeName: "BHB INTERNATIONAL SCHOOL", ...over },
    missing: [], notes: "",
  });

const pay = parseUdiseDocExtract(payJson())!;
assert.equal(pay.docType, "payment_proof");
assert.equal(pay.payment?.amountPaise, 250000, "₹2,500 → paise");
assert.equal(pay.payment?.dateIso, "2026-09-10");
assert.equal(pay.payment?.reference, "428812345678");
assert.equal(pay.payment?.method, "UPI");
/* A screenshot is never a vault document and never touches the record. */
assert.equal(docSlotFor("payment_proof"), null);
const payPlan = planUdiseCorrections({ extract: pay, student, household });
assert.equal(payPlan.changes.length, 0, "a payment proof changes no field of the student record");

/* Amounts and references that must NOT become facts. */
assert.equal(parseUdiseDocExtract(payJson({ amount: "0" }))!.payment?.amountPaise, 0);
assert.ok(parseUdiseDocExtract(payJson({ amount: "0" }))!.missing.includes("amount"));
assert.equal(parseUdiseDocExtract(payJson({ amount: "99999999" }))!.payment?.amountPaise, 0, "larger than any school fee — refused");
assert.equal(parseUdiseDocExtract(payJson({ reference: "12" }))!.payment?.reference, "", "a two-character scrap is not a reference");
assert.equal(parseUdiseDocExtract(payJson({ dateIso: "2031-01-01" }))!.payment?.dateIso, "", "a future date is not a payment date");
assert.equal(parseUdiseDocExtract(payJson({ dateIso: "10/09/2026" }))!.payment?.dateIso, "");
/* A non-payment document carries no payment block at all. */
assert.equal(p1.payment, null);

/* ── Matching against the fee book ── */
const receipts = [
  { receiptNo: "RCV-00501", collectionDate: "2026-09-10", totalPaise: 250000, refs: ["4288 1234 5678"] },
  { receiptNo: "RCV-00502", collectionDate: "2026-09-02", totalPaise: 180000, refs: ["AXIS9911"] },
];
assert.deepEqual(
  matchPaymentToReceipts({ amountPaise: 250000, dateIso: "2026-09-10", reference: "428812345678", receipts }),
  { kind: "by_reference", receiptNo: "RCV-00501" },
  "a UTR match ignores spacing and case",
);
assert.deepEqual(
  matchPaymentToReceipts({ amountPaise: 180000, dateIso: "2026-09-03", reference: "", receipts }),
  { kind: "by_amount_and_date", receiptNo: "RCV-00502" },
  "same amount within three days is a likely match",
);
assert.equal(
  matchPaymentToReceipts({ amountPaise: 180000, dateIso: "2026-08-01", reference: "", receipts }).kind,
  "none",
  "same amount five weeks earlier is NOT this payment",
);
assert.deepEqual(
  matchPaymentToReceipts({ amountPaise: 0, dateIso: "", reference: "", receipts }),
  { kind: "none", reason: "nothing_readable" },
);
assert.equal(matchPaymentToReceipts({ amountPaise: 999900, dateIso: "2026-09-10", reference: "ZZZZZZZZ", receipts }).kind, "none");
/* A short reference must never be matched loosely against the book. */
assert.equal(matchPaymentToReceipts({ amountPaise: 0, dateIso: "", reference: "AXIS", receipts }).kind, "none");

/* ── What the parent and the office read ── */
const already = renderPaymentProofAck({ payment: pay.payment!, match: { kind: "by_reference", receiptNo: "RCV-00501" }, childName: "Aarav", language: "en" });
assert.match(already, /already in our records/);
assert.match(already, /RCV-00501/);
const hiAck = renderPaymentProofAck({ payment: pay.payment!, match: { kind: "none", reason: "no_receipt_matches" }, childName: "Aarav", language: "hi" });
assert.match(hiAck, /₹2,500/);
assert.match(hiAck, /कार्यालय/);
assert.doesNotMatch(hiAck, /दर्ज हो गया|recorded/, "a photograph never confirms a payment");
const unread = renderPaymentProofAck({ payment: { amountPaise: 0, dateIso: "", reference: "", method: "", payeeName: "" }, match: { kind: "none", reason: "nothing_readable" }, childName: "Aarav", language: "en" });
assert.match(unread, /could not read/);
assert.match(unread, /UTR/);
const po = renderPaymentProofOfficeAlert({ payment: pay.payment!, match: { kind: "none", reason: "no_receipt_matches" }, childName: "Aarav Sharma", classLabel: "Class 1-A", guardianName: "Rakesh", openDuesPaise: 515000, fileUrl: null });
assert.match(po.text, /No receipt matches/);
assert.match(po.text, /Open dues on record: \*₹5,150\*/);
assert.match(po.text, /never books money/);
assert.match(po.oneLine, /₹2,500/);
const po2 = renderPaymentProofOfficeAlert({ payment: pay.payment!, match: { kind: "by_amount_and_date", receiptNo: "RCV-00502" }, childName: "A", classLabel: "I", guardianName: "R", openDuesPaise: 0, fileUrl: null });
assert.match(po2.text, /CONFIRM before replying/, "a likely match must be labelled as likely");

console.log("ok");
