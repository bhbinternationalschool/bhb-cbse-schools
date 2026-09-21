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
import { CERTIFICATE_KINDS, isUidaiFormKind, seriesCodeForCertificateKind, uidaiFormUrl } from "./certificates";
import { holdCodeForCertificate } from "./holds";
import { mergeCertificateIssues, nextCertNoFor } from "./certificatesMerge";

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

/* ── In the ERP's certificate register ───────────────────────────── */
{
  assert.ok(CERTIFICATE_KINDS.some((k) => k.kind === "aadhaar_uidai" && k.label === "Aadhaar certificate (UIDAI format)"));
  assert.ok(isUidaiFormKind("aadhaar_uidai"));
  assert.ok(!isUidaiFormKind("bonafide"), "the school's own certificates keep their sheet");
  assert.equal(seriesCodeForCertificateKind("aadhaar_uidai"), "CERT_AADHAAR", "its own number series");
  assert.equal(uidaiFormUrl("stu_1", "2026-09-21"), "/api/v1/udise/aadhaar-certificate?student=stu_1&date=2026-09-21", "a reprint keeps the issue date");
  assert.equal(uidaiFormUrl("stu_1"), "/api/v1/udise/aadhaar-certificate?student=stu_1");
  assert.equal(holdCodeForCertificate("aadhaar_uidai"), null, "a fee hold never blocks a child's Aadhaar");
  assert.equal(holdCodeForCertificate("bonafide"), "HOLD_CERT", "…while the others keep theirs");
}

/* ── One register, written from two places ───────────────────────── */
{
  const row = (id: string, createdAt: string, voidedAt: string | null = null) => ({ id, createdAt, voidedAt });
  // An office PC opened the Certificates screen this morning; a parent's
  // WhatsApp request added AAD-2026-0001 at noon; the PC saves a bonafide.
  const server = [row("wa_1", "2026-09-21T06:30:00Z"), row("bnf_old", "2026-08-11T09:40:00Z")];
  const stalePc = [row("bnf_new", "2026-09-21T09:00:00Z"), row("bnf_old", "2026-08-11T09:40:00Z")];
  assert.deepEqual(mergeCertificateIssues(server, stalePc).map((r) => r.id), ["bnf_new", "wa_1", "bnf_old"], "the WhatsApp certificate survives the stale save");
  // A void stands, whichever copy is older.
  const voided = [row("x", "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z")];
  const stale = [row("x", "2026-09-01T00:00:00Z", null)];
  assert.equal(mergeCertificateIssues(voided, stale)[0]!.voidedAt, "2026-09-10T00:00:00Z", "a stale copy does not un-void");
  assert.equal(mergeCertificateIssues(stale, voided)[0]!.voidedAt, "2026-09-10T00:00:00Z", "a void from the screen applies");
  assert.equal(mergeCertificateIssues(server, []).length, 2, "an empty save erases nothing");

  // Numbering: the screen's own fallback series, never a number in use.
  const issues = [
    { kind: "aadhaar_uidai" as const, academicYearCode: "2026-27", certNo: "AAD-2026-0001", voidedAt: null },
    { kind: "bonafide" as const, academicYearCode: "2026-27", certNo: "BNF-2026-0001", voidedAt: null },
  ];
  assert.equal(nextCertNoFor("aadhaar_uidai", "2026-27", []), "AAD-2026-0001");
  assert.equal(nextCertNoFor("aadhaar_uidai", "2026-27", issues), "AAD-2026-0002");
  // A voided certificate keeps its number: the next one skips it.
  assert.equal(
    nextCertNoFor("aadhaar_uidai", "2026-27", [{ ...issues[0]!, voidedAt: "2026-09-02" }]),
    "AAD-2026-0002",
    "a voided number is never reused",
  );
}

console.log("  ok");
