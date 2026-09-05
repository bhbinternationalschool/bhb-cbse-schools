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
  previewUdiseStudentDetailsSync,
  udiseAadhaarVerified,
  udiseAadhaarVerifiedAgainstDob,
  udiseEmptyRow,
  udiseIsBlank,
  udiseNamesCompatible,
  udiseRowsToMatrix,
  isConfidentUdiseMatch,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";
import { normalizeStudent, type SisState, type SisStudent } from "@/lib/sis";
import type { MastersState } from "@/lib/masters";

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

// ---- the Aadhaar validation phrases ------------------------------------
//
// The portal never writes the bare word "Verified", so an equality test finds
// nothing — which is what the code used to do, silently declining to mark any
// pupil verified from the long export. Only the "against ... DOB" phrasing may
// overwrite a birth date the office typed.
const V_DOB = "Verified From UIDAI against Name, Gender & DOB";
check("verified: against-DOB phrasing", udiseAadhaarVerified(V_DOB), true);
check("verified: plain phrasing", udiseAadhaarVerified("Verified From UIDAI"), true);
check("verified: failure is not a pass",
  udiseAadhaarVerified("Verification Failed From UIDAI"), false);
check("verified: not defined", udiseAadhaarVerified("Not Defined"), false);
check("verified: blank", udiseAadhaarVerified(""), false);

check("dob-verified: against-DOB phrasing", udiseAadhaarVerifiedAgainstDob(V_DOB), true);
check("dob-verified: plain Aadhaar match is not a DOB match",
  udiseAadhaarVerifiedAgainstDob("Verified From UIDAI"), false);
check("dob-verified: failure",
  udiseAadhaarVerifiedAgainstDob("Verification Failed From UIDAI"), false);
check("dob-verified: not defined", udiseAadhaarVerifiedAgainstDob("Not Defined"), false);

// ---- which matches are firm enough to overwrite a birth date -------------
//
// A fuzzy name match once paired PRATIK YADAV with PRATEEK YADAV — two boys,
// two fathers. That pairing must never be allowed to rewrite a date.
for (const m of ["pen", "apaar", "aadhaar", "name_father_class", "name_father",
                 "name_class_section", "name_parents", "name_dob"] as const) {
  check(`confident: ${m}`, isConfidentUdiseMatch(m), true);
}
for (const m of ["name_unique", "fuzzy_name_father", "ambiguous", "unmatched"] as const) {
  check(`not confident: ${m}`, isConfidentUdiseMatch(m), false);
}

// ---- blanks the portal spells in words -----------------------------------
for (const v of ["", "NA", "N/A", "-", "—", "NOT AVAILABLE", "Not Applicable", "nil"]) {
  check(`blank: "${v}"`, udiseIsBlank(v), true);
}
check("a PEN is not blank", udiseIsBlank("23220880281"), false);

// ---- names that differ by a surname --------------------------------------
check("surname added", udiseNamesCompatible("VEER PRATAP", "VEER PRATAP MISHRA"), true);
check("middle name added", udiseNamesCompatible("RITESH SINGH", "RITESH KUMAR SINGH"), true);
check("honorific ignored", udiseNamesCompatible("SMT PRIYA SINGH", "PRIYA SINGH"), true);
check("same tokens, other order", udiseNamesCompatible("RAM KUMAR", "KUMAR RAM"), false);
check("different first name", udiseNamesCompatible("VEER PRATAP", "DHEER PRATAP"), false);
check("spelling change is not a surname", udiseNamesCompatible("PRATIK YADAV", "PRATEEK YADAV"), false);

// ---- matching the two exports to the SIS ---------------------------------
//
// The rule set on 2026-09-05: a name with a surname on one side only is the
// same child when the parents, or the birth date, agree; class is never
// changed; DOB from a confirmed row replaces ours; once PEN and APAAR are in
// the SIS the row is done and stops appearing.
const masters = {
  classes: [
    { id: "c-nur", name: "Nursery", isActive: true },
    { id: "c-1", name: "I", isActive: true },
  ],
  sections: [{ id: "s-a", name: "A", classId: "c-nur", isActive: true }],
  feeGroups: [],
} as unknown as MastersState;

let n = 0;
function pupil(o: Partial<SisStudent>): SisStudent {
  n += 1;
  return normalizeStudent({
    id: `st-${n}`,
    admissionNo: `A${n}`,
    status: "active",
    academicYearCode: "2026-27",
    classId: "c-nur",
    sectionId: "s-a",
    fullName: "",
    fatherName: "",
    motherName: "",
    dob: "",
    pen: "",
    apaarId: "",
    ...o,
  } as SisStudent);
}
const sis = {
  students: [
    pupil({ fullName: "VEER PRATAP MISHRA", fatherName: "RAJESH MISHRA", motherName: "SUNITA MISHRA", dob: "2019-05-12" }),
    pupil({ fullName: "VEER PRATAP SINGH", fatherName: "AJAY SINGH", motherName: "PRIYANKA SINGH", dob: "2019-01-01" }),
    pupil({ fullName: "AARVI SINGH", fatherName: "DHARM PRAKASH SINGH", motherName: "PRIYA SINGH", dob: "2023-01-21", pen: "23220880281", apaarId: "123456786927" }),
    pupil({ fullName: "AADVIK", fatherName: "", motherName: "", dob: "2021-07-04" }),
    pupil({ fullName: "AADVIK", fatherName: "", motherName: "", dob: "2020-03-03", classId: "c-1" }),
  ],
  households: [],
} as unknown as SisState;

const rowOf = (o: Partial<UdiseStudentRow>): UdiseStudentRow => ({ ...udiseEmptyRow(), ...o });
const previewOf = (rows: UdiseStudentRow[]) =>
  previewUdiseStudentDetailsSync(udiseRowsToMatrix(rows), sis, masters, undefined, "2026-27").preview;

// Surname on the SIS side only, both parents agree → matched, DOB replaced.
const [veer] = previewOf([
  rowOf({ fullName: "VEER PRATAP", fatherName: "RAJESH KUMAR MISHRA", motherName: "SUNITA", dob: "12/06/2019", pen: "P-VEER", classHint: "I" }),
]);
check("veer: method", veer?.method, "name_parents");
check("veer: matched the Mishra boy", veer?.matchedName, "VEER PRATAP MISHRA");
check("veer: PEN will be written", veer?.willUpdate.pen, "P-VEER");
check("veer: DOB replaced from a confirmed row, ISO", veer?.willUpdate.dob, "2019-06-12");
check("veer: class flagged, never patched", [veer?.classMismatch, "classId" in (veer?.willUpdate ?? {})], [true, false]);

// Same short name, parents disagree with both → not guessed.
const [stranger] = previewOf([
  rowOf({ fullName: "VEER PRATAP", fatherName: "MOHAN LAL", motherName: "GEETA" }),
]);
check("stranger: not matched to either Veer", stranger?.studentId, null);
check("stranger: left for the operator", stranger?.method, "ambiguous");

// Two AADVIKs with no parents anywhere: the birth date decides.
const [aadvik] = previewOf([rowOf({ fullName: "AADVIK SINGH", dob: "04/07/2021" })]);
check("aadvik: method", aadvik?.method, "name_dob");
check("aadvik: the right twin", aadvik?.udise.dob === "04/07/2021" && aadvik?.matchedName === "AADVIK", true);

// A settled child: PEN and APAAR already in the SIS, nothing to fill → ok,
// even before Aadhaar is marked verified.
const [settled] = previewOf([
  rowOf({ fullName: "AARVI SINGH", pen: "23220880281", apaarId: "********6927", fatherName: "DHARM PRAKASH SINGH", motherName: "PRIYA SINGH", dob: "21/01/2023" }),
]);
check("settled: matched by PEN", settled?.method, "pen");
check("settled: a masked APAAR does not replace the full one", settled?.willUpdate.apaarId, undefined);
check("settled: nothing to fill", settled?.fillLabels, []);
check("settled: leaves the to-do list", settled?.tone, "ok");

// The same child with the portal's MBU flag: it is recorded once, and the row
// is done after that rather than parked under "MBU pending" for ever.
const [mbu] = previewOf([
  rowOf({ fullName: "AARVI SINGH", pen: "23220880281", mbuStatus: "MBU Pending" }),
]);
check("mbu: recorded as a fill, not a permanent flag", mbu?.tone, "fill");

if (failures) {
  console.error(`udiseStudentDetails selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("udiseStudentDetails selftest: ok");
