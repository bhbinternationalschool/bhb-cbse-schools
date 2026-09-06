/**
 * PEN + APAAR is the whole of UDISE+ compliance.
 *
 * Reported from the office on 2026-09-06: "when PEN and APAAR both are
 * present on the student record it still shows open gaps 237, callable 237,
 * incomplete call list 237". The database said 100 of those 237 active
 * students held both ids.
 *
 * `isUdiseFullyCompliant` demanded four more things. Two of them —
 * `aadhaarVerification === "verified_udise"` and `udiseInboundTransferPending`
 * — had no column in sis_students until the `profile` migration of that same
 * day, so every hydrate read them back unset and NO student could ever be
 * compliant. The other two, a student Aadhaar and a parent Aadhaar, are what
 * the portal needs in order to ISSUE an APAAR; once the APAAR exists the
 * portal has already checked them.
 *
 * This file pins the rule so the counters, the call list, the exports and the
 * badge in front of the student can never disagree again.
 *
 * Run: npx tsx src/lib/udiseCompliance.selftest.ts
 */
import assert from "node:assert/strict";
import {
  computeStudentUdiseGaps,
  isUdiseFullyCompliant,
  udiseEntryStatusLabel,
  udisePenApaarStatus,
  type UdiseComplianceSettings,
} from "@/lib/udiseCompliance";
import { normalizeStudent } from "@/lib/sis";
import type { SisStudent } from "@/lib/sis";

/** The default the office runs with: parent Aadhaar demanded for APAAR. */
const CFG: UdiseComplianceSettings = {
  reminderIntervalDays: 7,
  schoolAreaHint: "Harhua, Varanasi, Uttar Pradesh",
  customNote: "",
  parentAadhaarRequiredForApaar: true,
};

function student(patch: Partial<SisStudent>): SisStudent {
  return normalizeStudent({
    id: "stu_t",
    admissionNo: "T-1",
    fullName: "TEST CHILD",
    classId: "c",
    sectionId: "s",
    academicYearCode: "2026-27",
    status: "active",
    ...patch,
  } as never);
}

/* ── Both ids: compliant, no gaps, badge says so ─────────────────────────── */
{
  // Deliberately the worst-documented case: no Aadhaar anywhere, nothing
  // verified, an inbound transfer still flagged. The portal issued both ids,
  // so there is nothing for the office to chase.
  const s = student({
    pen: "11223344556",
    apaarId: "123456789012",
    aadhaarNumber: "",
    aadhaarLast4: "",
    aadhaarVerification: "missing",
    udiseInboundTransferPending: true,
  });
  assert.equal(isUdiseFullyCompliant(s, CFG), true, "PEN + APAAR is compliant");
  assert.deepEqual(computeStudentUdiseGaps(s, CFG), [], "no gaps once both ids exist");
  assert.equal(udisePenApaarStatus(s).code, "ok");
  assert.equal(udisePenApaarStatus(s).label, "UDISE OK");
  assert.equal(udiseEntryStatusLabel(s), "Entered · UDISE OK");
}

/* ── PEN only: still a gap, and the badge names it ───────────────────────── */
{
  const s = student({ pen: "11223344556", apaarId: "" });
  assert.equal(isUdiseFullyCompliant(s, CFG), false);
  const gaps = computeStudentUdiseGaps(s, CFG);
  assert.ok(gaps.includes("apaar"), "APAAR is missing");
  assert.ok(!gaps.includes("pen"), "PEN is not missing");
  assert.ok(
    gaps.includes("parent_aadhaar"),
    "parent Aadhaar is still needed — it is what generates the APAAR",
  );
  assert.equal(udisePenApaarStatus(s).code, "pen_only");
  assert.equal(udisePenApaarStatus(s).label, "PEN ok · APAAR missing");
  assert.equal(udiseEntryStatusLabel(s), "Entered · APAAR missing");
}

/* ── Neither id: gaps, and NO badge (the office asked for nothing shown) ─── */
{
  const s = student({ pen: "", apaarId: "" });
  assert.equal(isUdiseFullyCompliant(s, CFG), false);
  const gaps = computeStudentUdiseGaps(s, CFG);
  assert.ok(gaps.includes("pen") && gaps.includes("apaar"));
  assert.equal(udisePenApaarStatus(s).code, "none");
  assert.equal(udisePenApaarStatus(s).label, "", "no badge when neither id exists");
}

/* ── APAAR without PEN: unusual, still named rather than shown as OK ─────── */
{
  const s = student({ pen: "", apaarId: "123456789012" });
  assert.equal(isUdiseFullyCompliant(s, CFG), false);
  assert.equal(udisePenApaarStatus(s).code, "apaar_only");
  assert.ok(computeStudentUdiseGaps(s, CFG).includes("pen"));
}

/* ── Placeholder ids are not ids ─────────────────────────────────────────── */
for (const junk of ["NA", "na", "0", "000", "***", "  "]) {
  const s = student({ pen: junk, apaarId: junk });
  assert.equal(
    isUdiseFullyCompliant(s, CFG),
    false,
    `"${junk}" must not count as a PEN/APAAR`,
  );
  assert.equal(udisePenApaarStatus(s).code, "none");
}

/* ── A verified Aadhaar alone never clears the worklist ──────────────────── */
{
  const s = student({
    pen: "",
    apaarId: "",
    aadhaarNumber: "123456789012",
    aadhaarVerification: "verified_udise",
    fatherAadhaarLast4: "1234",
  });
  assert.equal(isUdiseFullyCompliant(s, CFG), false, "no ids, not compliant");
  const gaps = computeStudentUdiseGaps(s, CFG);
  assert.ok(gaps.includes("pen") && gaps.includes("apaar"));
  assert.ok(
    !gaps.includes("student_aadhaar") && !gaps.includes("student_aadhaar_unverified"),
    "a verified Aadhaar on file is not itself a gap",
  );
}

/* ── The reported population: 100 of 237 drop off the worklist ───────────── */
{
  const roster = [
    ...Array.from({ length: 100 }, (_, i) =>
      student({ id: `ok_${i}`, pen: `PEN${i}`, apaarId: `APAAR${i}` }),
    ),
    ...Array.from({ length: 104 }, (_, i) =>
      student({ id: `pen_${i}`, pen: `PEN${i}`, apaarId: "" }),
    ),
    ...Array.from({ length: 33 }, (_, i) =>
      student({ id: `none_${i}`, pen: "", apaarId: "" }),
    ),
  ];
  const open = roster.filter((s) => !isUdiseFullyCompliant(s, CFG));
  assert.equal(roster.length, 237);
  assert.equal(open.length, 137, "237 minus the 100 that hold both ids");
}

console.log("udiseCompliance: PEN + APAAR is compliance — ok");
