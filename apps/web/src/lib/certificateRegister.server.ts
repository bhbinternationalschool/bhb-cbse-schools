import "server-only";

/**
 * Put a certificate prepared off the Certificates screen (a parent's
 * WhatsApp request) on the same numbered register, so every Aadhaar
 * certificate the school signs is on one list whichever way it was asked
 * for. Saves union by id (certificatesMerge.ts), so an office PC with an
 * older copy cannot erase it.
 */

import { fetchDeskSliceFromDb, pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";
import { classLabel } from "@/lib/homework";
import { loadMasters } from "@/lib/masters";
import type { CertificateIssue } from "@/lib/certificates";
import { nextCertNoFor } from "@/lib/certificatesMerge";
import type { SisStudent } from "@/lib/sis";

export async function recordAadhaarCertificateIssue(input: {
  student: SisStudent;
  issuedOn: string;
  requestedBy: string;
}): Promise<{ ok: true; certNo: string; id: string } | { ok: false; error: string }> {
  const read = await fetchDeskSliceFromDb("certificates");
  // Unreadable is not "no certificates yet": numbering from an empty list
  // would reuse a number already printed.
  if (!read.ok) return { ok: false, error: read.error || "register unreadable" };
  const issues = (Array.isArray(read.bundle.issues) ? read.bundle.issues : []) as CertificateIssue[];
  const s = input.student;
  const ay = s.academicYearCode || "";
  const certNo = nextCertNoFor("aadhaar_uidai", ay, issues);
  const id = `cert_wa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const issue: CertificateIssue = {
    id,
    kind: "aadhaar_uidai",
    certNo,
    studentId: s.id,
    householdId: s.householdId || "",
    academicYearCode: ay,
    studentName: s.fullName,
    admissionNo: s.admissionNo || "",
    fatherName: s.fatherName || "",
    motherName: s.motherName || "",
    dob: s.dob || "",
    gender: s.gender || "",
    classLabel: classLabel(loadMasters(), s.classId, s.sectionId).replace(" · ", " "),
    rollNo: s.rollNo || "",
    pen: s.pen || "",
    apaarId: s.apaarId || "",
    admissionDate: "",
    leavingDate: "",
    reasonForLeaving: "",
    lastClassStudied: "",
    promotedTo: "",
    conduct: "",
    remarks: `Requested on WhatsApp by ${input.requestedBy}; form sent to the office to sign`,
    openBalancePaise: 0,
    duesCleared: false,
    overrideDues: false,
    issuedOn: input.issuedOn,
    issuedBy: "WhatsApp request",
    classTeacherName: "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
    inactivatedStudent: false,
    tc: null,
    feesPaid: null,
    customTitle: "",
    customBody: "",
    aiGenerated: false,
  };
  const pushed = await pushDeskSliceToDb("certificates", { version: 1, ...read.bundle, issues: [issue, ...issues] });
  if (!pushed.ok) return { ok: false, error: pushed.error || "register not saved" };
  return { ok: true, certNo, id };
}
