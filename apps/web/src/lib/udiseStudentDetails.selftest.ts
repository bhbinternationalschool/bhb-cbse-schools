/**
 * Reading the two shapes UDISE+ exports students in.
 *
 * "Students Details" is 23 columns and carries PEN but no date of birth.
 * "List of Active Students" is 66 columns, carries the whole profile — birth
 * date, address, mother tongue, admission date — but no PEN, and masks
 * Aadhaar, mobile and APAAR to their last four digits.
 *
 * Two things here are guards against real defects rather than hypotheticals:
 * the long export puts a row of column numbers "(1) (2) (3) …" between the
 * header and the first pupil, which read as a student called "(4)" and
 * inflated every count on the panel; and its birth dates are dd/mm/yyyy, which
 * is exactly the shape that the student import used to mangle.
 */
import {
  parseUdiseStudentDetailsMatrix,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`  FAIL ${label}\n       got  ${g}\n       want ${w}`);
  }
}

// ---- the short "Students Details" export -------------------------------
const shortExport: unknown[][] = [
  ["List of All Students"],
  [],
  ["Class", "Section", "Name", "Gender", "Initialised at SDMS", "Student PEN",
   "Student State Code", "Father Name", "Mother Name", "Social Category"],
  ["Nursery/KG/PP3", "A", "AADVIK SINGH", "Male", "2026-27", "23263951182",
   "NA", "RITESH KUMAR SINGH", "JUHI SINGH", "1-GENERAL"],
];
const shortRows = parseUdiseStudentDetailsMatrix(shortExport);
check("short export: one pupil", shortRows.length, 1);
check("short export: name", shortRows[0]?.fullName, "AADVIK SINGH");
check("short export: PEN", shortRows[0]?.pen, "23263951182");
check("short export: no dob column", shortRows[0]?.dob, "");

// ---- the long "List of Active Students" export --------------------------
const longHeader = [
  "Class", "Section", "DOB", "Name", "Gender", "Mother Name", "Father Name",
  "Guardian Name", "AADHAAR No.", "Name As per AADHAAR", "Address", "Pincode",
  "Mobile No.", "Alternate Mobile No.", "Contact Email Id", "Mother Tongue",
  "Social Category", "Minority Group", "BPL Beneficiary",
  "Antyodaya Anna Yojana (AAY) beneficiary", " EWS / Disadvantaged Group",
  "CWSN", "Type of Impairments", "Disability Certificate",
  "Disability Percentage (in %)", "Student is Indian National",
  "Mention The Nationality of Foreign Student", "Blood Group",
  "Admission No.", "Admission Date", "Height(in CMs)", "Weight(in KGs)",
  "Whether Admitted under Section 12C of the RTE Act", "Is Repeater",
  "AADHAAR Validation Status", "APAAR ID", "APAAR Status",
];
const longRow = [
  "Nursery/KG", "A", "21/01/2023", "AADVIK SINGH", "Male", "JUHI SINGH",
  "RITESH KUMAR SINGH", "RITESH KUMAR SINGH", "********1188", "AADVIK SINGH",
  "VILLAGE- PUARI KALAN", "221202", "94******11", "81******47", "NA",
  "42 - HINDI - Hindi", "GENERAL", "7 - NA", "NO", "NO", "NO", "NO", "NA",
  "NO", "0.0", "YES", "NA", "B+", "NA", "24/03/2026", "NA", "NA", "NA", "NO",
  "Verified From UIDAI", "********5445", "Generated",
];
const longExport: unknown[][] = [
  ["List_of_Active_Students"],
  ["BHB INTERNATIONAL SCHOOL"],
  ["Generated Date(DD-MM-YYYY)"],
  longHeader,
  // The column-number row. A pupil called "(4)" is the bug this guards.
  longHeader.map((_, i) => `(${i + 1})`),
  longRow,
];
const longRows = parseUdiseStudentDetailsMatrix(longExport);
check("long export: the (n) row is not a pupil", longRows.length, 1);
check("long export: name", longRows[0]?.fullName, "AADVIK SINGH");
check("long export: dob is read", longRows[0]?.dob, "21/01/2023");
check("long export: no PEN column", longRows[0]?.pen, "");

// Fields only the long export carries.
const r = longRows[0] as UdiseStudentRow;
check("guardian", r.guardianName, "RITESH KUMAR SINGH");
check("address", r.address, "VILLAGE- PUARI KALAN");
check("pincode", r.pincode, "221202");
check("mother tongue raw", r.motherTongue, "42 - HINDI - Hindi");
check("blood group", r.bloodGroup, "B+");
check("admission date", r.admissionDate, "24/03/2026");
check("indian national", r.isIndianNational, "YES");
check("masked aadhaar still read", r.aadhaarRaw, "********1188");
check("masked apaar still read", r.apaarId, "********5445");
check("mobile", r.mobile, "94******11");
check("alt mobile", r.altMobile, "81******47");
check("repeater", r.isRepeater, "NO");

// The father column must not be captured from "Mother Name", which precedes it.
check("father not taken from mother column", r.fatherName, "RITESH KUMAR SINGH");
check("mother", r.motherName, "JUHI SINGH");

// A header with neither PEN nor Father is not a student list.
check("unrelated table is refused",
  parseUdiseStudentDetailsMatrix([["Item", "Qty"], ["Chalk", "20"]]).length, 0);

if (failures) {
  console.error(`udiseStudentDetails selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("udiseStudentDetails selftest: ok");
