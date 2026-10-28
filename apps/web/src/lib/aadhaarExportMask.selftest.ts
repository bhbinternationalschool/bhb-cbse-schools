/**
 * Run: npx tsx src/lib/aadhaarExportMask.selftest.ts
 *
 * Downloaded files carry the last four Aadhaar digits only (director,
 * 14 Oct 2026). The UDISE+ PEN / APAAR / Aadhaar register exported the full
 * 12 digits for the child, the father and the mother; so did the
 * not-on-UDISE CSV and the UDISE+ list downloads. Screens are unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aadhaarForExport, displayAadhaar, emptySisState, maskAadhaarText, type SisStudent } from "./sis";
import { udiseComplianceRowsForTests } from "./sisReportCatalog";
import { emptyMastersShell } from "./masters";

// The helper.
assert.equal(aadhaarForExport({ number: "234567890123" }), "XXXX XXXX 0123");
assert.equal(aadhaarForExport({ number: "2345 6789 0123" }), "XXXX XXXX 0123");
assert.equal(aadhaarForExport({ last4: "6649" }), "XXXX XXXX 6649");
assert.equal(aadhaarForExport({}), "—");
assert.equal(maskAadhaarText("2345 6789 0123"), "XXXX XXXX 0123");
assert.equal(maskAadhaarText("********6649"), "XXXX XXXX 6649");
assert.equal(maskAadhaarText("Verified"), "Verified", "a status is not a number");
assert.equal(maskAadhaarText("9876543210"), "9876543210", "a 10-digit mobile is left alone");
assert.equal(maskAadhaarText("—"), "—");
// Screens keep the full number for staff.
assert.equal(displayAadhaar({ number: "234567890123" }), "2345 6789 0123");

// The UDISE register: no full number for child, father or mother.
const kid = {
  id: "k",
  fullName: "Kunal",
  admissionNo: "1",
  classId: "c",
  sectionId: "s",
  status: "active",
  academicYearCode: "2026-27",
  aadhaarNumber: "234567890123",
  fatherAadhaarNumber: "345678901234",
  motherAadhaarNumber: "456789012345",
} as unknown as SisStudent;
const built = udiseComplianceRowsForTests([kid], { ...emptySisState(), students: [kid] }, emptyMastersShell());
const row = built.rows[0]!;
assert.equal(row.studentAadhaar, "XXXX XXXX 0123");
assert.equal(row.fatherAadhaar, "XXXX XXXX 1234");
assert.equal(row.motherAadhaar, "XXXX XXXX 2345");
for (const v of Object.values(row)) {
  assert.ok(!/\d{4}\s?\d{4}\s?\d{4}/.test(String(v)), `no 12-digit number in the row: ${v}`);
}

// Wiring: the other two download paths.
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const ws = src("components/students/UdiseComplianceWorkspace.tsx");
const csv = ws.slice(ws.indexOf("function exportUnregisteredCsv()"), ws.indexOf("function exportCallListCsv()"));
assert.ok(/aadhaarForExport\(/.test(csv) && !/displayAadhaar\(/.test(csv), "not-on-UDISE CSV: last four only");
const modal = src("components/students/UdiseStudentListModal.tsx");
assert.match(modal, /\/aadhaar\/i\.test\(k\) \? maskAadhaarText\(v\)/, "list downloads mask Aadhaar columns");

console.log("aadhaarExportMask.selftest.ts: ok");
