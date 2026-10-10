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
  documentRouteFor,
  officeDocNoticeTitle,
  DOC_TYPE_LABEL,
  renderUnreadableAck,
  renderUnrecognisedAck,
  udiseDocAuditDescriptor,
  resolveTargetChildren,
  type UdiseDocExtract,
} from "./udiseDocIntakeAi";
import { childrenOfHousehold, type SisState, type SisStudent } from "./sis";

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
assert.match(renderParentAck({ plan: same, childName: "Aarav Sharma", language: "en" }), /already matches/);

// A different child's card: NOTHING is applied, the office decides.
const wrongChild = planUdiseCorrections({ extract: { ...p1, nameOnDoc: "Riya Sharma" }, student, household });
assert.equal(wrongChild.changes.filter((c) => c.apply).length, 0, "no field from a stranger's card");
assert.equal(wrongChild.changes.find((c) => c.field === "fullName")?.apply, false);
assert.ok(wrongChild.flags.some((f) => /does not match/.test(f)));

// Gender disagreement is never overwritten silently.
// Gender: the child's own Aadhaar card wins; any other document only asks.
const g = planUdiseCorrections({ extract: p1, student: { ...student, gender: "F" }, household });
assert.equal(by.call(null, "x"), undefined);
assert.equal(g.changes.find((c) => c.field === "gender")?.apply, true, "the Aadhaar card is what UDISE+ validates against");
const gb = planUdiseCorrections({ extract: { ...p1, docType: "birth_certificate" }, student: { ...student, gender: "F" }, household });
assert.equal(gb.changes.find((c) => c.field === "gender")?.apply, false, "a birth certificate never silently flips gender");

// The name exactly as on the card (21 Sep 2026: RUDRANS vs Rudransh; and a
// dropped middle name UDISE+ would reject).
const rud = planUdiseCorrections({ extract: { ...p1, nameOnDoc: "Rudransh Singh" }, student: { ...student, fullName: "RUDRANS SINGH" }, household });
assert.deepEqual([rud.changes.find((c) => c.field === "fullName")?.after, rud.changes.find((c) => c.field === "fullName")?.apply], ["RUDRANSH SINGH", true]);
const mid = planUdiseCorrections({ extract: { ...p1, nameOnDoc: "Priyanshu Kumar Yadav" }, student: { ...student, fullName: "PRIYANSHU YADAV" }, household });
assert.equal(mid.changes.find((c) => c.field === "fullName")?.after, "PRIYANSHU KUMAR YADAV");
assert.equal(mid.changes.find((c) => c.field === "fullName")?.apply, true);

// Only last-4 on record and the card agrees: "completed", still applied.
const l4 = planUdiseCorrections({ extract: p1, student: { ...student, aadhaarLast4: "0124" }, household });
assert.match(l4.changes.find((c) => c.field === "aadhaarNumber")!.reason, /completed/);

/* ── An Aadhaar made somewhere else: permanent, not present (21 Sep 2026) ── */
{
  // The real case: a family living at Semari sends cards made at their
  // native village in Jaunpur. The present address must stay.
  const jaunpur: UdiseDocExtract = { ...p1, address: "C/O: Sujeet Singh, Devarai, Bhainsa, PO: Bhaisa, DIST: Jaunpur, Uttar Pradesh - 222129", pincode: "222129" };
  const oldErp = { ...student, permanentAddress: "Semari, Puari Khurd", permanentPincode: "" };
  const jp = planUdiseCorrections({ extract: jaunpur, student: oldErp, household: { address: "SEMARI, PUARI KHURD", pincode: "" } });
  assert.equal(jp.changes.find((c) => c.field === "address"), undefined, "the present address is never replaced by a native-village card");
  assert.equal(jp.changes.find((c) => c.field === "pincode"), undefined);
  const pa = jp.changes.find((c) => c.field === "permanentAddress")!;
  assert.equal(pa.target, "student");
  assert.equal(pa.apply, true, "a permanent address that only copied the present one is filled");
  assert.match(pa.after, /JAUNPUR/);
  assert.equal(jp.changes.find((c) => c.field === "permanentPincode")?.after, "222129");
  const office = renderOfficeAlert({ plan: jp, childName: "VIDHI SINGH", classLabel: "VII-A", guardianName: "SUJEET SINGH", fileUrl: null });
  assert.deepEqual(office.portalChanges.filter((p) => /Address|Pin Code/.test(p)), [], "the office is never told to move UDISE+ to the native village");
  assert.match(office.text, /Permanent address/);

  // The second child's pass has no household but still knows where they live.
  const second = planUdiseCorrections({ extract: jaunpur, student: oldErp, household: null, presentAddress: "SEMARI, PUARI KHURD" });
  assert.equal(second.changes.find((c) => c.field === "permanentAddress")?.apply, true);

  // A different permanent address already on record: the office decides.
  const other = planUdiseCorrections({ extract: jaunpur, student: { ...student, permanentAddress: "Gram Kothari, Ghazipur" }, household: { address: "SEMARI, PUARI KHURD", pincode: "" } });
  assert.equal(other.changes.find((c) => c.field === "permanentAddress")?.apply, false);

  // The same place, spelled out more fully: the present address is updated as before.
  const here = planUdiseCorrections({ extract: { ...p1, address: "Semari, Puari Khurd, Varanasi", pincode: "221202" }, student, household: { address: "SEMARI, PUARI KHURD", pincode: "" } });
  assert.equal(here.changes.find((c) => c.field === "address")?.apply, true);
  assert.equal(here.changes.find((c) => c.field === "permanentAddress"), undefined);
  // No present address at all: the card fills it (unchanged behaviour).
  assert.equal(plan.changes.find((c) => c.field === "address")?.target, "household");
}

/* ── The parent is told what was wrong and what is fixed (21 Sep 2026) ── */
{
  // Vidhi's real card: DOB wrong in our record, card made at the Jaunpur village.
  const vidhi: UdiseDocExtract = { ...p1, nameOnDoc: "Vidhi Singh", dob: "2014-10-02", gender: "F", address: "C/O: Sujeet Singh, Devarai, Bhainsa, Jaunpur, Uttar Pradesh - 222129", pincode: "222129" };
  const rec = { ...student, fullName: "VIDHI SINGH", dob: "2010-04-09", gender: "F", aadhaarNumber: GOOD, aadhaarLast4: GOOD.slice(-4), permanentAddress: "Semari, Puari Khurd" };
  const plan = planUdiseCorrections({ extract: { ...vidhi, aadhaarNumber: GOOD }, student: rec, household: { address: "SEMARI, PUARI KHURD", pincode: "" } });
  const hi = renderParentAck({ plan, childName: "VIDHI SINGH", language: "hi", portalValidationFailed: true });
  assert.match(hi, /मिल गया। बहुत धन्यवाद/, "received and thank you");
  assert.match(hi, /सत्यापन \*विफल\* था/, "why the school asked: UDISE+ rejected it");
  assert.match(hi, /जन्म तिथि: 09\/04\/2010 → \*02\/10\/2014\*/, "what was wrong → what it is now, in dd/mm/yyyy");
  assert.match(hi, /स्थायी पते/, "the village address is explained, not listed as an error");
  assert.match(hi, /दोबारा सत्यापन/, "what happens next");
  assert.ok(!/कार्यालय जाँच करेगा/.test(hi), "nothing held, so no office check");
  const en = renderParentAck({ plan, childName: "VIDHI SINGH", language: "en", portalValidationFailed: true });
  assert.match(en, /What was wrong, and is now corrected:/);
  assert.match(en, /Date of birth: 09\/04\/2010 → \*02\/10\/2014\*/);

  // A correction that could not be saved is never announced as done.
  const failed = { ...plan, changes: plan.changes.map((c) => ({ ...c, apply: false })) };
  const f = renderParentAck({ plan: failed, childName: "VIDHI SINGH", language: "en" });
  assert.ok(!/now corrected/.test(f));
  assert.match(f, /The office will check:/);

  // Aadhaar numbers stay masked in a WhatsApp message.
  const newNo = renderParentAck({ plan: planUdiseCorrections({ extract: p1, student, household }), childName: "Aarav Sharma", language: "en" });
  assert.ok(!newNo.includes(GOOD), "never the full Aadhaar number");
  assert.match(newNo, /Added to the record:/);

  // APAAR asked in the same reply — by buttons, never a form to print.
  const ap = renderParentAck({ plan, childName: "VIDHI SINGH", language: "hi", portalValidationFailed: true, apaarPending: { childNames: ["VIDHI SINGH", "RUDRANSH SINGH"], askFollows: true } });
  assert.match(ap, /APAAR ID अभी नहीं बनी है/);
  assert.match(ap, /VIDHI SINGH, RUDRANSH SINGH/);
  assert.match(ap, /नीचे के संदेश में/);
  assert.match(ap, /प्रिंट या हस्ताक्षर करने की ज़रूरत नहीं/);
  assert.ok(!/अनिवार्य|compulsory|mandatory/i.test(ap), "APAAR is voluntary");
  assert.ok(!/कुछ और नहीं करना है/.test(ap), "not 'nothing more needed' while APAAR is asked");
  const apEn = renderParentAck({ plan, childName: "VIDHI SINGH", language: "en", apaarPending: { childNames: ["VIDHI SINGH"], askFollows: false } });
  assert.match(apEn, /VIDHI SINGH does not have an APAAR ID yet/);
  assert.match(apEn, /Send \*APAAR\*/, "asked this week already: how to get the buttons again");
  assert.ok(!/APAAR/.test(renderParentAck({ plan, childName: "VIDHI SINGH", language: "en" })), "no pending child, no ask");

  // Consent already given: the card that just arrived makes the ID possible.
  const ready = renderParentAck({ plan, childName: "VIDHI SINGH", language: "hi", apaarConsented: { ready: ["VIDHI SINGH"], stillNeeded: [] } });
  assert.match(ready, /सहमति और ज़रूरी दस्तावेज़ दोनों मिल गए/);
  const waiting = renderParentAck({ plan, childName: "VIDHI SINGH", language: "en", apaarConsented: { ready: [], stillNeeded: [{ name: "AARAV", waitingFor: ["parent_aadhaar"] }] } });
  assert.match(waiting, /For the APAAR ID we still need/);
  assert.match(waiting, /parent's own Aadhaar card.*AARAV's APAAR ID/);
}

/* ── Plan: the father's Aadhaar ───────────────────────────────────── */
const fatherDoc: UdiseDocExtract = { ...p1, person: "father", nameOnDoc: "Rakesh Kumar Sharma", dob: "1988-01-01", aadhaarNumber: GOOD2, gender: "M" };
const fp = planUdiseCorrections({ extract: fatherDoc, student, household });
assert.equal(fp.changes.find((c) => c.field === "fatherAadhaarNumber")?.after, GOOD2, "a number is not a name — untouched");
assert.equal(fp.changes.find((c) => c.field === "dob"), undefined, "a parent's DOB never touches the child");
assert.equal(fp.changes.find((c) => c.field === "aadhaarNumber"), undefined);
assert.equal(fp.changes.find((c) => c.field === "fullName"), undefined, "the parent's name never overwrites the child's");
assert.equal(fp.changes.find((c) => c.field === "fatherName")?.after, "RAKESH KUMAR SHARMA", "the same man — his name as on his own Aadhaar card");
assert.equal(fp.changes.find((c) => c.field === "fatherName")?.apply, true);
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
// A complete child (PEN + APAAR, so no gaps) is never chased for paperwork
// our own record lacks — five families would have been, on 21 Sep 2026.
assert.equal(missingDocsFor({ gaps: [], hasDob: false, hasAddress: false, language: "en" }), "", "nothing to ask for a complete child");
assert.equal(missingDocsFor({ gaps: ["apaar"], hasDob: false, hasAddress: true, language: "en" }), "birth certificate", "an open child still gets the record's own gaps");

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
assert.equal(parseUdiseDocExtract(payJson({ reference: "1369" }))!.payment?.receiptNo, "1369", "a short number on a receipt is the receipt's own number");
assert.equal(parseUdiseDocExtract(payJson({ reference: "", receiptNo: "RCV-00430" }))!.payment?.receiptNo, "RCV-00430");
assert.equal(parseUdiseDocExtract(payJson({ dateIso: "2031-01-01" }))!.payment?.dateIso, "", "a future date is not a payment date");
assert.equal(parseUdiseDocExtract(payJson({ dateIso: "10/09/2026" }))!.payment?.dateIso, "");
/* A non-payment document carries no payment block at all. */
assert.equal(p1.payment, null);

/* ── Matching against the fee book ── */
const receipts = [
  { receiptNo: "RCV-00501", collectionDate: "2026-09-10", totalPaise: 250000, refs: ["4288 1234 5678"] },
  { receiptNo: "RCV-00502", collectionDate: "2026-09-02", totalPaise: 180000, refs: ["AXIS9911"] },
];
{
  const m = matchPaymentToReceipts({ amountPaise: 250000, dateIso: "2026-09-10", reference: "428812345678", receipts });
  assert.equal(m.kind, "by_reference", "a UTR match ignores spacing and case");
  assert.equal(m.kind === "by_reference" && m.receiptNo, "RCV-00501");
  const l = matchPaymentToReceipts({ amountPaise: 180000, dateIso: "2026-09-03", reference: "", receipts });
  assert.equal(l.kind === "by_amount_and_date" && l.receiptNo, "RCV-00502", "same amount within three days is a likely match");
}
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
const already = renderPaymentProofAck({ payment: pay.payment!, match: { kind: "by_reference", on: "utr", receiptNo: "RCV-00501", receipts: [receipts[0]!], recordPaise: 250000 }, childName: "Aarav", language: "en" });
assert.match(already, /matches our record/);
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
const po2 = renderPaymentProofOfficeAlert({ payment: pay.payment!, match: { kind: "by_amount_and_date", receiptNo: "RCV-00502", receipts: [receipts[1]!], recordPaise: 180000 }, childName: "A", classLabel: "I", guardianName: "R", openDuesPaise: 0, fileUrl: null });
assert.match(po2.text, /CONFIRM/, "a likely match must be labelled as likely");

/* ── The director's rule (21 Sep 2026): match field by field, show the split ── */
{
  // The real shapes in the fee book: two UTRs in one field, paper-book
  // numbers "1373,1374", and one receipt covering two siblings.
  const book = [
    {
      receiptNo: "RCV-00319", collectionDate: "2026-07-23", totalPaise: 1000000,
      refs: ["620451393208, 620451387319"], schoolReceiptNos: ["1513"], modes: ["upi"],
      lines: [
        { studentName: "ARADHYA UPADHYAY", label: "Tuition Fee (July)", amountPaise: 280000 },
        { studentName: "ARADHYA UPADHYAY", label: "Transport (July)", amountPaise: 120000 },
        { studentName: "ANSH UPADHYAY", label: "Tuition Fee (June, July)", amountPaise: 600000, concessionPaise: 50000 },
      ],
    },
    { receiptNo: "RCV-00112", collectionDate: "2026-04-30", totalPaise: 879500, refs: ["2026-04-29"], schoolReceiptNos: ["1373", "1374"], modes: ["cash"], lines: [{ studentName: "ANSH UPADHYAY", label: "Admission", amountPaise: 879500 }] },
    { receiptNo: "RCV-00601", collectionDate: "2026-09-18", totalPaise: 180000, refs: ["0"], modes: ["cash"], lines: [{ studentName: "RUDRANSH SINGH", label: "Tuition Fee (August)", amountPaise: 180000 }] },
    { receiptNo: "RCV-00602", collectionDate: "2026-09-18", totalPaise: 200000, refs: ["0"], modes: ["cash"], lines: [{ studentName: "VIDHI SINGH", label: "Tuition Fee (August)", amountPaise: 200000 }] },
  ];
  // The second UTR of a two-UTR field matches.
  const u = matchPaymentToReceipts({ amountPaise: 1000000, dateIso: "2026-07-23", reference: "620451387319", receipts: book });
  assert.equal(u.kind === "by_reference" && u.on, "utr");
  // An old paper receipt number, one of two on our receipt.
  const r = matchPaymentToReceipts({ amountPaise: 879500, dateIso: "", reference: "", receiptNo: "1374", receipts: book });
  assert.equal(r.kind === "by_reference" && r.receiptNo, "RCV-00112");
  // Our own number, printed differently.
  assert.equal(matchPaymentToReceipts({ amountPaise: 0, dateIso: "", reference: "", receiptNo: "rcv 319", receipts: book }).kind, "by_reference");
  // A "0" reference is no reference: it never matches every cash receipt.
  assert.equal(matchPaymentToReceipts({ amountPaise: 5, dateIso: "", reference: "000000", receipts: book }).kind, "none");
  // One cash payment, a receipt per child the same day — added up.
  const two = matchPaymentToReceipts({ amountPaise: 380000, dateIso: "2026-09-18", reference: "", receipts: book });
  assert.equal(two.kind === "by_amount_and_date" && two.receiptNo, "RCV-00601, RCV-00602");

  const hiAck = renderPaymentProofAck({ payment: { amountPaise: 1000000, dateIso: "2026-07-23", reference: "620451387319", method: "Google Pay", payeeName: "" }, match: u, childName: "ARADHYA", language: "hi" });
  assert.match(hiAck, /मेल खाता है/);
  assert.match(hiAck, /फीस रसीद \*RCV-00319\* \(रसीद नं\. 1513\) · 23\/07\/2026 · ₹10,000 · UPI/);
  assert.match(hiAck, /UTR\/संदर्भ …387319 — ✅ वही है/);
  assert.match(hiAck, /राशि ₹10,000 — ✅ वही है/);
  assert.match(hiAck, /बच्चों में ऐसे बँटी/, "two children: the split is shown");
  assert.match(hiAck, /\*ARADHYA UPADHYAY\* — ₹4,000/);
  assert.match(hiAck, /Transport \(July\) ₹1,200/);
  assert.match(hiAck, /\*ANSH UPADHYAY\* — ₹6,000/);
  assert.match(hiAck, /छूट: ₹500/);
  const diff = renderPaymentProofAck({ payment: { amountPaise: 1050000, dateIso: "", reference: "620451393208", method: "", payeeName: "" }, match: u, childName: "A", language: "en" });
  assert.match(diff, /difference of ₹500/, "an amount that does not agree is said, not glossed");
  assert.match(diff, /the amount is different/, "and the opening line does not say it matches");
  assert.doesNotMatch(diff, /matches our record/);
  // 21 Sep 2026, the real case: one UPI payment of ₹10,285 = fee RCV-00430
  // ₹7,000 + store SL/2026-27/0179 ₹3,285, both carrying UTR …515620.
  const both = [
    { kind: "fee" as const, receiptNo: "RCV-00430", collectionDate: "2026-06-29", totalPaise: 700000, refs: ["618034515620"], modes: ["upi"], lines: [{ studentName: "ARADHYA UPADHYAY", label: "Tuition Fee · July", amountPaise: 150000 }] },
    { kind: "store" as const, receiptNo: "SL/2026-27/0179", collectionDate: "2026-06-29", totalPaise: 328500, refs: ["618034515620"], schoolReceiptNos: ["2151"], modes: ["upi"], lines: [{ studentName: "ARADHYA UPADHYAY", label: "Notebook × 6 (store)", amountPaise: 30000 }] },
  ];
  const fs = matchPaymentToReceipts({ amountPaise: 1028500, dateIso: "2026-06-29", reference: "618034515620", receipts: both });
  assert.equal(fs.kind === "by_reference" && fs.recordPaise, 1028500, "the fee receipt and the store bill together make the payment");
  const fsAck = renderPaymentProofAck({ payment: { amountPaise: 1028500, dateIso: "2026-06-29", reference: "618034515620", method: "Google Pay", payeeName: "" }, match: fs, childName: "ARADHYA", language: "hi" });
  assert.match(fsAck, /मेल खाता है/);
  assert.match(fsAck, /🧾 फीस रसीद \*RCV-00430\*/);
  assert.match(fsAck, /🛍️ स्टोर बिल \*SL\/2026-27\/0179\* \(रसीद नं\. 2151\)/);
  assert.match(fsAck, /कुल: \*₹10,285\*/);
  assert.match(fsAck, /राशि ₹10,285 — ✅ वही है/);
  assert.doesNotMatch(fsAck, /अंतर/, "no false 'difference' when the store bill is counted");
  // A store bill number printed on the paper matches too.
  assert.equal(matchPaymentToReceipts({ amountPaise: 0, dateIso: "", reference: "", receiptNo: "2151", receipts: both }).kind, "by_reference");

  const likely = renderPaymentProofAck({ payment: { amountPaise: 380000, dateIso: "2026-09-18", reference: "", method: "cash", payeeName: "" }, match: two, childName: "VIDHI", language: "en" });
  assert.match(likely, /probably/, "an amount-and-date match is never called certain");
  assert.match(likely, /RUDRANSH SINGH[\s\S]*VIDHI SINGH/);
}

/* ── Where a file goes, decided by what it IS ─────────────────────── */
//
// The defect this guards: a parent photographed a fee receipt from the
// school's old software and was answered "which child is this for?", with
// the family's children listed twice each. Only three document types belong
// to the UDISE+ path; money has its own; everything else goes to a person.
assert.equal(documentRouteFor("aadhaar"), "record");
assert.equal(documentRouteFor("birth_certificate"), "record");
assert.equal(documentRouteFor("address_proof"), "record");
assert.equal(documentRouteFor("payment_proof"), "payment");
assert.equal(documentRouteFor("other"), "unrecognised", "an unrecognised file never enters the UDISE+ path");

for (const lang of ["en", "hi"] as const) {
  for (const msg of [renderUnreadableAck(lang), renderUnrecognisedAck(lang)]) {
    assert.doesNotMatch(msg, /UDISE|यूडाइस/i, "nothing about UDISE+ is said about a file we cannot act on");
    assert.doesNotMatch(msg, /\?|किस बच्चे/, "the parent is asked nothing");
    assert.match(msg, /office|कार्यालय/, "a person is promised");
  }
}
// "Could not read it" is about us; "not recognised" would be a claim about
// the document. See renderUnreadableAck.
assert.match(renderUnreadableAck("en"), /could not read it/);
assert.doesNotMatch(renderUnreadableAck("en"), /not recognis|not a valid/i);

// The photograph never reaches the audit row.
const desc = udiseDocAuditDescriptor({ mimeType: "image/jpeg", byteLength: 512 * 1024, waMessageId: "wamid.X" });
assert.equal(desc, "[document image/jpeg 512KB wa=wamid.X]");

/* ── One row per child, or the family is asked a silly question ───── */
//
// SIS keeps a row per child per academic year and leaves them all active.
// HH-142 has two children and four active rows; the intake used to greet
// its parent with "(AAROHI / AAROHI / AARUSH / AARUSH)".
const kid = (id: string, fullName: string, admissionNo: string, academicYearCode: string): SisStudent =>
  ({ id, fullName, admissionNo, academicYearCode, householdId: "hh_1", status: "active", docs: {} } as unknown as SisStudent);
const hh142 = {
  students: [
    kid("s1", "AAROHI KUMARI", "BHB-2025-26-1071", "2025-26"),
    kid("s2", "AAROHI KUMARI", "BHB-2025-26-1071", "2026-27"),
    kid("s3", "AARUSH KUMAR", "BHB-2025-26-1075", "2025-26"),
    kid("s4", "AARUSH KUMAR", "BHB-2025-26-1075", "2026-27"),
  ],
} as unknown as SisState;
const thisSession = childrenOfHousehold(hh142, "hh_1", "2026-27");
assert.equal(thisSession.length, 2, "two children, not four rows");
assert.deepEqual(thisSession.map((c) => c.id).sort(), ["s2", "s4"], "this session's rows");

// And with one row each, a name on the document can finally decide.
const aadhaarFor = (name: string): UdiseDocExtract =>
  ({ ...base, nameOnDoc: name, docType: "aadhaar", person: "child" } as unknown as UdiseDocExtract);
assert.deepEqual(
  resolveTargetChildren({ children: thisSession, extract: aadhaarFor("Aarohi Kumari"), caption: "" }).map((c) => c.id),
  ["s2"],
  "the name on the card picks the child",
);
assert.equal(
  resolveTargetChildren({ children: hh142.students, extract: aadhaarFor("Aarohi Kumari"), caption: "" }).length,
  0,
  "with duplicate year rows the same name matches twice and decides nothing — the bug",
);
// A single-child family is never asked which child.
assert.equal(
  resolveTargetChildren({ children: [thisSession[0]!], extract: aadhaarFor("Someone Else"), caption: "" }).length,
  1,
);

/* ── the title the office reads ───────────────────────────────────── */
//
// 25 Sep 2026, 08:27 IST: MR. MANOJ KUMAR CHAUDHARI sent a payment
// screenshot for MANAS CHAUDHARI (LKG-A). The ERP inbox row said
// "UDISE+ document received" over a body that began "💸 *Payment proof* ·
// MANAS CHAUDHARI (LKG-A)". Every document type arrived under that one
// hardcoded title, while the WhatsApp message beside it used the right one.
assert.equal(officeDocNoticeTitle("Payment proof"), "Payment proof received");
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.payment_proof), "Payment proof received");
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.aadhaar), "Aadhaar card received");
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.birth_certificate), "Birth certificate received");
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.address_proof), "Address proof received");
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.other), "Document received");
// A missing label must never render "undefined received".
for (const empty of [undefined, null, "", "   "]) {
  assert.equal(officeDocNoticeTitle(empty), "Document received", String(empty));
}
// The title and the body agree, which is the whole point: the office alert
// for MANAS's screenshot leads with the same label the title now carries.
const manas = renderPaymentProofOfficeAlert({
  payment: pay.payment!,
  match: { kind: "none", reason: "no_receipt_matches" },
  childName: "MANAS CHAUDHARI",
  classLabel: "LKG-A",
  guardianName: "MR. MANOJ KUMAR CHAUDHARI",
  openDuesPaise: 0,
  fileUrl: null,
});
assert.ok(
  manas.text.startsWith(`💸 *${DOC_TYPE_LABEL.payment_proof}* · MANAS CHAUDHARI (LKG-A)`),
  "the body leads with the label the title now carries",
);
assert.equal(officeDocNoticeTitle(DOC_TYPE_LABEL.payment_proof), "Payment proof received");

console.log("ok");
