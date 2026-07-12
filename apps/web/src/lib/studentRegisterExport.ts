/**
 * Full SIS register export — columns aligned to Student form tabs.
 */

import type { MastersState } from "@/lib/masters";
import {
  PEN_STATUSES,
  countDocsWithFiles,
  householdOf,
  studentTypeShort,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import type { ReportColumn } from "@/lib/reportExport";

export const STUDENT_REGISTER_EXPORT_COLUMNS: ReportColumn[] = [
  { key: "admissionNo", header: "Admission no", width: 1.1 },
  { key: "fullName", header: "Student name", width: 1.5 },
  { key: "gender", header: "Gender", width: 0.6 },
  { key: "dob", header: "DOB", width: 0.9 },
  { key: "status", header: "Status", width: 0.7 },
  { key: "campus", header: "Campus", width: 1 },
  { key: "className", header: "Class", width: 0.7 },
  { key: "section", header: "Section", width: 0.6 },
  { key: "rollNo", header: "Roll", width: 0.5 },
  { key: "academicYear", header: "Session", width: 0.8 },
  { key: "studentType", header: "Student type", width: 1.1 },
  { key: "feeGroup", header: "Fee group", width: 1.1 },
  { key: "joinedOn", header: "Joined on", width: 0.9 },
  { key: "fatherName", header: "Father", width: 1.2 },
  { key: "motherName", header: "Mother", width: 1.2 },
  { key: "fatherMobile", header: "Father mobile", width: 1 },
  { key: "motherMobile", header: "Mother mobile", width: 1 },
  { key: "fatherAadhaarLast4", header: "Father Aadhaar****", width: 0.9 },
  { key: "motherAadhaarLast4", header: "Mother Aadhaar****", width: 0.9 },
  { key: "fatherPan", header: "Father PAN", width: 0.9 },
  { key: "motherPan", header: "Mother PAN", width: 0.9 },
  { key: "guardianName", header: "Guardian", width: 1.2 },
  { key: "guardianRelation", header: "Relation", width: 0.8 },
  { key: "guardianMobile", header: "Guardian mobile", width: 1 },
  { key: "whatsapp", header: "WhatsApp", width: 1 },
  { key: "altMobile", header: "Alt mobile", width: 1 },
  { key: "email", header: "Email", width: 1.3 },
  { key: "address", header: "Address", width: 1.5 },
  { key: "locality", header: "Locality", width: 1 },
  { key: "landmark", header: "Landmark", width: 1 },
  { key: "city", header: "City", width: 0.9 },
  { key: "state", header: "State", width: 1 },
  { key: "pincode", header: "PIN", width: 0.7 },
  { key: "bloodGroup", header: "Blood", width: 0.6 },
  { key: "religion", header: "Religion", width: 0.8 },
  { key: "category", header: "Category", width: 0.7 },
  { key: "nationality", header: "Nationality", width: 0.9 },
  { key: "motherTongue", header: "Mother tongue", width: 0.9 },
  { key: "placeOfBirth", header: "Place of birth", width: 1 },
  { key: "aadhaarLast4", header: "Aadhaar****", width: 0.8 },
  { key: "pen", header: "PEN", width: 1 },
  { key: "penStatus", header: "PEN status", width: 1 },
  { key: "apaarId", header: "APAAR", width: 1 },
  { key: "srn", header: "SRN", width: 0.9 },
  { key: "previousSchool", header: "Previous school", width: 1.3 },
  { key: "previousTcNo", header: "Prev TC no", width: 0.9 },
  { key: "previousUdise", header: "Prev UDISE", width: 0.9 },
  { key: "emergencyName", header: "Emergency name", width: 1.1 },
  { key: "emergencyMobile", header: "Emergency mobile", width: 1 },
  { key: "docsUploaded", header: "Docs uploaded", width: 0.8 },
  { key: "hasPhoto", header: "Photo", width: 0.6 },
  { key: "notes", header: "Notes", width: 1.4 },
];

function genderLabel(g: SisStudent["gender"]): string {
  if (g === "M") return "Male";
  if (g === "F") return "Female";
  if (g === "O") return "Other";
  return "";
}

function penStatusLabel(code: string): string {
  return PEN_STATUSES.find((p) => p.value === code)?.label ?? code;
}

export function studentToRegisterExportRow(
  s: SisStudent,
  state: SisState,
  masters: MastersState,
): Record<string, string | number> {
  const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "";
  const sec = masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
  const campus = masters.campuses.find((c) => c.id === s.campusId)?.name ?? "";
  const feeGroup =
    masters.feeGroups.find((g) => g.id === s.feeGroupId)?.name ??
    masters.feeGroups.find((g) => g.id === s.feeGroupId)?.code ??
    "";
  const hh = householdOf(state, s.householdId);
  const docsN = countDocsWithFiles(s.docs);

  return {
    admissionNo: s.admissionNo,
    fullName: s.fullName,
    gender: genderLabel(s.gender),
    dob: s.dob,
    status: s.status,
    campus,
    className: cls,
    section: sec,
    rollNo: s.rollNo,
    academicYear: s.academicYearCode,
    studentType: studentTypeShort(s.studentType).label,
    feeGroup,
    joinedOn: s.joinedOn,
    fatherName: s.fatherName,
    motherName: s.motherName,
    fatherMobile: s.fatherMobile,
    motherMobile: s.motherMobile,
    fatherAadhaarLast4: s.fatherAadhaarLast4,
    motherAadhaarLast4: s.motherAadhaarLast4,
    fatherPan: s.fatherPan,
    motherPan: s.motherPan,
    guardianName: hh?.guardianName ?? "",
    guardianRelation: s.guardianRelation,
    guardianMobile: hh?.mobile ?? "",
    whatsapp: hh?.whatsappMobile ?? "",
    altMobile: hh?.altMobile ?? "",
    email: hh?.email ?? "",
    address: hh?.address ?? "",
    locality: hh?.locality ?? "",
    landmark: hh?.landmark ?? "",
    city: hh?.city ?? "",
    state: hh?.state ?? "",
    pincode: hh?.pincode ?? "",
    bloodGroup: s.bloodGroup,
    religion: s.religion,
    category: s.category,
    nationality: s.nationality,
    motherTongue: s.motherTongue,
    placeOfBirth: s.placeOfBirth,
    aadhaarLast4: s.aadhaarLast4,
    pen: s.pen,
    penStatus: penStatusLabel(s.penStatus),
    apaarId: s.apaarId,
    srn: s.srn,
    previousSchool: s.previousSchool,
    previousTcNo: s.previousTcNo,
    previousUdise: s.previousUdise,
    emergencyName: s.emergencyName,
    emergencyMobile: s.emergencyMobile,
    docsUploaded: docsN,
    hasPhoto: s.photoUrl || s.docs.photo.fileUrl ? "Yes" : "No",
    notes: s.notes,
  };
}
