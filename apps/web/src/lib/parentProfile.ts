/**
 * The shape of a child's profile as the parent app shows it — and the
 * document checklist the school asks every family for.
 *
 * Pure. The routes call these; the self-test pins the masking and the
 * checklist, which are the two things that must not drift: an Aadhaar
 * number must never leave the server unmasked, and "required" is what the
 * app nags about.
 */
import {
  DOC_LABELS,
  docHasFile,
  docStatusLabel,
  type Household,
  type SisStudent,
  type StudentDocKey,
} from "@/lib/sis";
import { documentProxyUrl } from "@/lib/documentsRouting";

/** What admission needs from every family; the rest only when it applies. */
export const REQUIRED_STUDENT_DOCS: readonly StudentDocKey[] = [
  "birthCert",
  "photo",
  "aadhaar",
  "addressProof",
];

export const DOC_ACCEPT_BY_KEY: Record<StudentDocKey, string> = {
  birthCert: "image/jpeg,image/png,image/webp,application/pdf",
  photo: "image/jpeg,image/png,image/webp",
  aadhaar: "image/jpeg,image/png,image/webp,application/pdf",
  addressProof: "image/jpeg,image/png,image/webp,application/pdf",
  tc: "image/jpeg,image/png,image/webp,application/pdf",
  casteCert: "image/jpeg,image/png,image/webp,application/pdf",
  incomeCert: "image/jpeg,image/png,image/webp,application/pdf",
};

export const DOC_HINT_BY_KEY: Record<StudentDocKey, string> = {
  birthCert: "Municipal or hospital birth certificate showing the child's name and date of birth.",
  photo: "A recent passport-size photo of the child, plain background, face clearly visible.",
  aadhaar: "The child's Aadhaar card. A masked copy (last 4 digits visible) is fine.",
  addressProof: "Any one: Aadhaar of a parent, electricity bill, ration card or rent agreement with the current address.",
  tc: "Transfer certificate from the previous school, if the child studied elsewhere.",
  casteCert: "Caste or category certificate, only if the child is under OBC / SC / ST.",
  incomeCert: "Income certificate, only for EWS or RTE admission.",
};

export function documentChecklist() {
  return DOC_LABELS.map((d) => ({
    key: d.key,
    label: d.label,
    required: REQUIRED_STUDENT_DOCS.includes(d.key),
    accept: DOC_ACCEPT_BY_KEY[d.key],
    hint: DOC_HINT_BY_KEY[d.key],
  }));
}

/** "XXXX XXXX 1234" — the last four only, or blank when there is none. */
export function maskAadhaar(student: Pick<SisStudent, "aadhaarNumber" | "aadhaarLast4">): string {
  const digits = (student.aadhaarNumber || "").replace(/\D/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : (student.aadhaarLast4 || "").slice(-4);
  return last4 ? `XXXX XXXX ${last4}` : "";
}

export function studentDocsForParent(student: SisStudent) {
  return DOC_LABELS.map(({ key, label }) => {
    const f = student.docs[key];
    const hasFile = docHasFile(f);
    return {
      key,
      label,
      required: REQUIRED_STUDENT_DOCS.includes(key),
      status: f.status,
      statusLabel: docStatusLabel(f.status),
      fileName: hasFile ? f.fileName : "",
      mimeType: hasFile ? f.mimeType : "",
      uploadedAt: hasFile ? f.uploadedAt : "",
      submittedAt: f.submittedAt || "",
      reviewedAt: f.reviewedAt || "",
      reviewNote: f.reviewNote || "",
      // Only a Drive-backed file can be served; a legacy data: URL cannot.
      previewUrl: hasFile && f.driveFileId ? documentProxyUrl("student", student.id, key) : null,
    };
  });
}

export function studentProfileForParent(
  student: SisStudent,
  classLabel: string,
) {
  return {
    id: student.id,
    fullName: student.fullName,
    admissionNo: student.admissionNo,
    classLabel,
    rollNo: student.rollNo,
    gender: student.gender,
    dob: student.dob,
    joinedOn: student.joinedOn,
    academicYearCode: student.academicYearCode,
    bloodGroup: student.bloodGroup,
    category: student.category,
    religion: student.religion,
    nationality: student.nationality,
    motherTongue: student.motherTongue,
    placeOfBirth: student.placeOfBirth,
    fatherName: student.fatherName,
    motherName: student.motherName,
    fatherMobile: student.fatherMobile,
    motherMobile: student.motherMobile,
    guardianRelation: student.guardianRelation,
    emergencyName: student.emergencyName,
    emergencyMobile: student.emergencyMobile,
    aadhaarMasked: maskAadhaar(student),
    pen: student.pen,
    apaarId: student.apaarId,
    previousSchool: student.previousSchool,
    photoUrl: student.photoUrl || "",
    docs: studentDocsForParent(student),
  };
}

export function householdForParent(h: Household) {
  return {
    id: h.id,
    code: h.code,
    guardianName: h.guardianName,
    mobile: h.mobile,
    whatsappMobile: h.whatsappMobile,
    altMobile: h.altMobile,
    email: h.email,
    address: h.address,
    locality: h.locality,
    landmark: h.landmark,
    city: h.city,
    state: h.state,
    pincode: h.pincode,
  };
}
