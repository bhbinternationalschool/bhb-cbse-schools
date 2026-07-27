/**
 * Run: npx tsx src/lib/admissionsSisReconcile.selftest.ts
 */
import assert from "node:assert/strict";
import {
  closeSuspectedLeadNotMatch,
  keepSuspectedLeadOpen,
  reconcileLeadsWithSis,
  verifySuspectedLeadWithSis,
} from "./admissionsSisReconcile";
import {
  admissionYearForEnquiryDate,
  defaultAdmissionsState,
  importLeads,
} from "./admissions";
import type { SisState } from "./sis";

// --- Admission-year rule: Oct (Y-1) … Sep Y → year Y ---
assert.equal(admissionYearForEnquiryDate("2024-10-15"), "2025-26");
assert.equal(admissionYearForEnquiryDate("2025-01-05"), "2025-26");
assert.equal(admissionYearForEnquiryDate("2025-07-31"), "2025-26");
assert.equal(admissionYearForEnquiryDate("2025-09-30"), "2025-26");
assert.equal(admissionYearForEnquiryDate("2025-10-01"), "2026-27");
assert.equal(admissionYearForEnquiryDate("2026-03-25"), "2026-27");

const base = defaultAdmissionsState();
base.leads = [];
base.households = [];

const imported = importLeads(
  base,
  [
    // Match by family mobile + child name (student is ACTIVE) → Admitted
    {
      childName: "Krishna Yadav",
      guardianName: "Shivjatan Yadav",
      mobile: "9454872154",
      leadDate: "2024-11-19",
    },
    // Same family mobile, different child → Suspected (sibling), stays open
    {
      childName: "New Baby Yadav",
      guardianName: "Shivjatan Yadav",
      mobile: "9454872154",
      leadDate: "2024-11-19",
    },
    // Match an INACTIVE student by mobile + name → still Admitted, status inactive
    {
      childName: "Ravi Gupta",
      guardianName: "Mohan Gupta",
      mobile: "9888877665",
      leadDate: "2026-03-25",
    },
    // Same child name only (different mobile, guardian unknown) → Suspected
    {
      childName: "Sunita Maurya",
      guardianName: "Someone Else",
      mobile: "9111111111",
      leadDate: "2026-03-25",
    },
    // No SIS presence → untouched
    {
      childName: "Unknown Child",
      guardianName: "Stranger Singh",
      mobile: "9000000001",
      leadDate: "2026-03-25",
    },
  ],
  {
    source: "field_survey",
    stage: "enquiry",
    academicYearCode: "2025-26",
  },
  "selftest",
  () => undefined,
);

// Import derives admission year from the enquiry date
assert.equal(
  imported.state.leads.find((l) => l.childName === "Krishna Yadav")!
    .academicYearCode,
  "2025-26",
);
assert.equal(
  imported.state.leads.find((l) => l.childName === "Unknown Child")!
    .academicYearCode,
  "2026-27",
);

const sis = {
  households: [
    {
      id: "hh1",
      code: "HH-0001",
      guardianName: "Shivjatan Yadav",
      mobile: "9454872154",
      whatsappMobile: "9454872154",
      altMobile: "",
    },
  ],
  students: [
    {
      id: "stu1",
      admissionNo: "ADM-0101",
      fullName: "Krishna Yadav",
      status: "active",
      classId: "cls_1",
      academicYearCode: "2024-25",
      householdId: "hh1",
      fatherName: "Shivjatan Yadav",
      motherName: "",
      fatherMobile: "9454872154",
      motherMobile: "",
      emergencyMobile: "",
      joinedOn: "2024-04-01",
    },
    {
      id: "stu2",
      admissionNo: "ADM-0055",
      fullName: "Ravi Gupta",
      status: "inactive",
      classId: "cls_2",
      academicYearCode: "2023-24",
      householdId: "",
      fatherName: "Mohan Gupta",
      motherName: "",
      fatherMobile: "9888877665",
      motherMobile: "",
      emergencyMobile: "",
      joinedOn: "2023-04-01",
    },
    {
      id: "stu3",
      admissionNo: "ADM-0201",
      fullName: "Sunita Maurya",
      status: "active",
      classId: "cls_3",
      academicYearCode: "2025-26",
      householdId: "",
      fatherName: "Rajesh Maurya",
      motherName: "",
      fatherMobile: "9222222222",
      motherMobile: "",
      emergencyMobile: "",
      joinedOn: "2025-04-01",
    },
  ],
} as unknown as SisState;

const r = reconcileLeadsWithSis(imported.state, sis);

assert.equal(r.checked, 5);
assert.equal(r.admitted.length, 2);
assert.equal(r.suspected.length, 2);

// Active student match
const admittedLead = r.state.leads.find(
  (l) => l.childName === "Krishna Yadav",
)!;
assert.equal(admittedLead.stage, "enrolled");
assert.equal(admittedLead.studentId, "stu1");
assert.equal(admittedLead.admissionNo, "ADM-0101");
assert.equal(admittedLead.sisMatch, "admitted");
assert.equal(admittedLead.sisStudentStatus, "active");
assert.equal(admittedLead.academicYearCode, "2024-25");
assert.ok(admittedLead.sisMatchKind);
assert.ok(admittedLead.sisMismatchNotes.length > 0);
assert.ok(admittedLead.note.includes("2024-25"));

// INACTIVE student is also matched and marked admitted with status shown
const inactiveLead = r.state.leads.find((l) => l.childName === "Ravi Gupta")!;
assert.equal(inactiveLead.stage, "enrolled");
assert.equal(inactiveLead.sisMatch, "admitted");
assert.equal(inactiveLead.sisStudentStatus, "inactive");
assert.equal(inactiveLead.studentId, "stu2");

// Sibling (family mobile only) → suspected, stays open
const siblingLead = r.state.leads.find(
  (l) => l.childName === "New Baby Yadav",
)!;
assert.equal(siblingLead.stage, "enquiry");
assert.equal(siblingLead.siblingInSchool, true);
assert.equal(siblingLead.sisMatch, "suspected");
assert.equal(siblingLead.sisMatchKind, "family_mobile_only");
assert.ok(
  siblingLead.sisMismatchNotes.some((n) => /Child name differs|Likely sibling/i.test(n)),
);
assert.ok(siblingLead.note.includes("Family in SIS"));

// Same name only → suspected, stays open
const nameLead = r.state.leads.find((l) => l.childName === "Sunita Maurya")!;
assert.equal(nameLead.stage, "enquiry");
assert.equal(nameLead.sisMatch, "suspected");
assert.equal(nameLead.sisStudentId, "stu3");
assert.equal(nameLead.sisMatchKind, "child_name_only");
assert.ok(
  nameLead.sisMismatchNotes.some((n) => /Mobile differs|Name collision/i.test(n)),
);
assert.ok(nameLead.note.includes("Suspected in SIS"));

// No match → untouched
const untouched = r.state.leads.find((l) => l.childName === "Unknown Child")!;
assert.equal(untouched.stage, "enquiry");
assert.equal(untouched.studentId, "");
assert.equal(untouched.sisMatch, "");

// Keep open clears suspect and won't re-tag same student
const kept = keepSuspectedLeadOpen(r.state, siblingLead.id);
assert.equal(kept.ok, true);
if (kept.ok) {
  const afterKeep = kept.state.leads.find((l) => l.id === siblingLead.id)!;
  assert.equal(afterKeep.sisMatch, "");
  assert.equal(afterKeep.stage, "enquiry");
  assert.equal(afterKeep.sisReviewStatus, "keep_open");
  const r3 = reconcileLeadsWithSis(kept.state, sis);
  assert.equal(
    r3.state.leads.find((l) => l.id === siblingLead.id)!.sisMatch,
    "",
  );
}

// Verify with SIS updates lead from student record
const toVerify = r.state.leads.find((l) => l.childName === "Sunita Maurya")!;
const verified = verifySuspectedLeadWithSis(r.state, toVerify.id, sis);
assert.equal(verified.ok, true);
if (verified.ok) {
  const vLead = verified.state.leads.find((l) => l.id === toVerify.id)!;
  assert.equal(vLead.stage, "enrolled");
  assert.equal(vLead.sisMatch, "admitted");
  assert.equal(vLead.sisReviewStatus, "verified");
  assert.equal(vLead.studentId, "stu3");
  assert.equal(vLead.admissionNo, "ADM-0201");
  assert.equal(vLead.childName, "Sunita Maurya");
  assert.equal(vLead.academicYearCode, "2025-26");
  assert.ok(vLead.note.includes("Verified with SIS"));
}

// Close not-match marks lost
const closed = closeSuspectedLeadNotMatch(r.state, siblingLead.id);
assert.equal(closed.ok, true);
if (closed.ok) {
  const cLead = closed.state.leads.find((l) => l.id === siblingLead.id)!;
  assert.equal(cLead.stage, "lost");
  assert.equal(cLead.sisReviewStatus, "closed_not_match");
  assert.equal(cLead.sisMatch, "");
}

// Idempotent: second run makes no further changes
const r2 = reconcileLeadsWithSis(r.state, sis);
assert.equal(r2.admitted.length, 0);
assert.equal(r2.yearFixed, 0);
assert.equal(
  r2.state.leads.find((l) => l.childName === "New Baby Yadav")!.note,
  siblingLead.note,
);
assert.equal(
  r2.state.leads.find((l) => l.childName === "Sunita Maurya")!.note,
  nameLead.note,
);

console.log("admissionsSisReconcile.selftest: ok");
