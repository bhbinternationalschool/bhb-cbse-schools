/**
 * Self-test: the school's UIDAI "Certificate for Aadhaar Enrolment/ Update".
 * Run: npx tsx src/lib/aadhaarCertificate.selftest.ts   (from apps/web)
 *
 * What must hold:
 *  - UIDAI's rules: block capitals, one letter a box, one empty box between
 *    words, nothing written as NA — an unknown field is left empty;
 *  - what does not fit is reported, never silently cut;
 *  - a child with no Aadhaar is a New Enrolment, one with a number an Update;
 *  - the school ticks itself as "Head of recognised educational institution";
 *  - a parent asking for a birth certificate, TC or bonafide never gets this.
 */

import assert from "node:assert/strict";

import {
  blockLetters,
  certificateLayout,
  composeCertificateRequestAck,
  fitToRows,
  isAadhaarCertificateRequest,
  splitSchoolAddress,
  TICKS,
  type CertificateInput,
} from "./aadhaarCertificate";
import { renderAadhaarCertificatePdf } from "./aadhaarCertificatePdf";

console.log("aadhaarCertificate.selftest.ts");

/* ── Block letters and boxes ─────────────────────────────────────── */
{
  assert.equal(blockLetters("  Manas  chaudhari, "), "MANAS CHAUDHARI");
  assert.equal(blockLetters("A-415, Block-A"), "A-415 BLOCK-A", "no commas — each costs a box");
  assert.deepEqual(fitToRows("MANAS CHAUDHARI", [23, 23]), { rows: ["MANAS CHAUDHARI", ""], overflow: "" });
  // Words are not split across rows.
  assert.deepEqual(fitToRows("BHB INTERNATIONAL SCHOOL AYAR VARANASI", [23, 23]), {
    rows: ["BHB INTERNATIONAL", "SCHOOL AYAR VARANASI"],
    overflow: "",
  });
  // What does not fit is handed back.
  assert.deepEqual(fitToRows("UTTAR PRADESH", [5]), { rows: ["UTTAR"], overflow: "PRADESH" });
  // A word longer than a row is split rather than lost.
  assert.deepEqual(fitToRows("ABCDEFGHIJ", [6, 6]), { rows: ["ABCDEF", "GHIJ"], overflow: "" });
}

/* ── The layout ──────────────────────────────────────────────────── */
{
  const base: CertificateInput = {
    issueDateIso: "2026-09-21",
    childName: "Manas Chaudhari",
    aadhaarNumber: "",
    address: { house: "", street: "", landmark: "", area: "SHAMBHUPUR", village: "PALLIA", postOffice: "PUARI KALA", district: "VARANASI", state: "UTTAR PRADESH", pin: "221202" },
    certifier: { name: "", designation: "PRINCIPAL", officeAddress: "BHB INTERNATIONAL SCHOOL AYAR VARANASI", contact: "" },
  };
  const l = certificateLayout(base);
  assert.deepEqual(l.ticks, [TICKS.resident, TICKS.newEnrolment, TICKS.headOfInstitution], "no Aadhaar: New Enrolment; the school as head of institution");
  assert.equal(l.text.filter((p) => /\d/.test(p.text) && p.y < 160).map((p) => p.text).join(""), "21092026", "date of issue DDMMYYYY");
  // "MANAS CHAUDHARI" = 14 letters, the empty box between words is empty.
  const nameRow = l.text.filter((p) => Math.abs(p.y - 246.3) < 0.1);
  assert.equal(nameRow.length, 14);
  assert.ok(nameRow[5]!.x - nameRow[4]!.x > 30, "one empty box between the words");
  assert.deepEqual(l.blank, ["House No.", "Street", "Landmark", "Name of the Certifier", "Contact Number"], "unknowns left empty, never NA");
  assert.deepEqual(l.overflow, []);
  assert.ok(!l.text.some((p) => /N\/?A/.test(p.text)));

  const update = certificateLayout({ ...base, aadhaarNumber: "2341 2341 2346" });
  assert.deepEqual(update.ticks, [TICKS.resident, TICKS.updateRequest, TICKS.headOfInstitution], "a number on file: Update Request");
  assert.equal(update.text.filter((p) => Math.abs(p.y - 225.2) < 0.1).map((p) => p.text).join(""), "234123412346");

  const long = certificateLayout({ ...base, childName: "VEDIKA ABHISHEK RAMASHANKAR SINGH CHAUHAN SURYAVANSHI" });
  assert.deepEqual(long.overflow, [{ field: "Full name", rest: "CHAUHAN SURYAVANSHI" }], "too long for two rows: reported, not cut silently");

  // A real render: a one-page PDF over UIDAI's own form.
  const r = renderAadhaarCertificatePdf(base);
  assert.equal(r.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(r.pdf.length > 100_000, "the form image is embedded");
}

/* ── The school's free-text addresses (real ones, 21 Sep 2026) ─────── */
{
  assert.deepEqual(splitSchoolAddress("VIILAGE- PALLIA, SHAMBHUPUR, POST- PUARI KALA"), { village: "PALLIA", postOffice: "PUARI KALA", area: "SHAMBHUPUR" });
  assert.deepEqual(splitSchoolAddress("VILLAGE- MAHADEPUR ,PO. -PUARIKALAN").village, "MAHADEPUR");
  assert.equal(splitSchoolAddress("VILLAGE- MAHADEPUR ,PO. -PUARIKALAN").postOffice, "PUARIKALAN");
  assert.equal(splitSchoolAddress("MAHADEYPUR ,PUARIKALAN VARANASI").village, "MAHADEYPUR", "the first place is where they live");
  assert.equal(splitSchoolAddress("CHAUKA BHUSAULA").village, "CHAUKA BHUSAULA");
  assert.deepEqual(splitSchoolAddress(""), { village: "", postOffice: "", area: "" });
}

/* ── A parent asking for it ──────────────────────────────────────── */
{
  for (const t of ["aadhaar certificate", "आधार सर्टिफिकेट", "आधार के लिए प्रमाण पत्र चाहिए", "school certificate aadhar banwane ke liye", "Aadhar ke liye praman patra"]) {
    assert.ok(isAadhaarCertificateRequest(t), t);
  }
  for (const t of ["birth certificate", "जन्म प्रमाण पत्र", "bonafide certificate for aadhaar", "aadhar card", "certificate", "TC chahiye", "आधार कार्ड भेज दिया", "fee certificate for aadhaar linked account"]) {
    assert.ok(!isAadhaarCertificateRequest(t), `not this certificate: ${t}`);
  }
  const hi = composeCertificateRequestAck({ childNames: ["MANAS CHAUDHARI"], hindi: true, alreadyRequested: false });
  assert.match(hi, /UIDAI के निर्धारित प्रारूप/);
  assert.match(hi, /मूल \(original\) प्रमाणपत्र/, "the Aadhaar centre needs the original");
  assert.match(hi, /पासपोर्ट साइज़ फ़ोटो/, "the photo the form carries");
  assert.match(hi, /3 महीने/, "valid three months");
  assert.match(composeCertificateRequestAck({ childNames: ["X"], hindi: false, alreadyRequested: true }), /already with the office/);
}

console.log("  ok");
