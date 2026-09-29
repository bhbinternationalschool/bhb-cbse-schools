/**
 * What a class teacher may change on their own class's records, and the
 * checks each value must pass. Pure — the server route and the phone form
 * use the same rules. Self-tested in sisClassTeacher.selftest.ts.
 *
 * Director, 2026-09-29: the class teacher updates the family's WhatsApp
 * number, the child's record and photo from the phone. Office-owned fields
 * (class, section, status, admission no., fee group, Aadhaar, PEN, APAAR,
 * SRN, documents) are NOT here and cannot be sent.
 */

import { BLOOD_GROUPS, STUDENT_CATEGORIES } from "@/lib/sis";

/** Student fields → sis_students column. */
export const CLASS_TEACHER_STUDENT_FIELDS = {
  fullName: "full_name",
  gender: "gender",
  dob: "dob",
  bloodGroup: "blood_group",
  religion: "religion",
  category: "category",
  motherTongue: "mother_tongue",
  placeOfBirth: "place_of_birth",
  rollNo: "roll_no",
  fatherName: "father_name",
  motherName: "mother_name",
  fatherMobile: "father_mobile",
  motherMobile: "mother_mobile",
  emergencyName: "emergency_name",
  emergencyMobile: "emergency_mobile",
} as const;

export type ClassTeacherStudentField = keyof typeof CLASS_TEACHER_STUDENT_FIELDS;

/** Household fields → sis_households column. `whatsappMobile` changes that
 * number and nothing else (see setHouseholdWhatsApp in lib/sis.ts). */
export const CLASS_TEACHER_HOUSEHOLD_FIELDS = {
  whatsappMobile: "whatsapp_mobile",
  mobile: "mobile",
  altMobile: "alt_mobile",
  guardianName: "guardian_name",
  address: "address",
  locality: "locality",
  city: "city",
  pincode: "pincode",
} as const;

export type ClassTeacherHouseholdField = keyof typeof CLASS_TEACHER_HOUSEHOLD_FIELDS;

const MOBILE_FIELDS = new Set<string>([
  "fatherMobile",
  "motherMobile",
  "emergencyMobile",
  "whatsappMobile",
  "mobile",
  "altMobile",
]);

/** A 10-digit Indian mobile from whatever was typed, or null if it is not one. */
export function mobile10(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  const ten =
    d.length === 12 && d.startsWith("91")
      ? d.slice(2)
      : d.length === 11 && d.startsWith("0")
        ? d.slice(1)
        : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const LABEL: Record<string, string> = {
  fullName: "Name",
  gender: "Gender",
  dob: "Date of birth",
  bloodGroup: "Blood group",
  category: "Category",
  rollNo: "Roll no.",
  pincode: "PIN code",
};

/**
 * Check and clean a patch. Unknown keys are refused, not ignored — a form
 * that sends `classId` is a bug to hear about, not a field to drop quietly.
 * Returns the cleaned values, or the first problem in words.
 */
export function cleanClassTeacherPatch(
  kind: "student" | "household",
  patch: Record<string, unknown>,
  today: string,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const allowed: Record<string, string> =
    kind === "student" ? CLASS_TEACHER_STUDENT_FIELDS : CLASS_TEACHER_HOUSEHOLD_FIELDS;
  const values: Record<string, string> = {};
  for (const [k, raw] of Object.entries(patch)) {
    if (!(k in allowed)) {
      return { ok: false, error: `"${k}" can only be changed by the office` };
    }
    if (raw !== null && typeof raw !== "string") {
      return { ok: false, error: `${LABEL[k] || k}: expected text` };
    }
    let v = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 200);

    if (MOBILE_FIELDS.has(k)) {
      if (v === "") {
        if (k === "whatsappMobile" || k === "mobile") {
          return { ok: false, error: "A family needs a mobile / WhatsApp number — correct it rather than clear it" };
        }
      } else {
        const m = mobile10(v);
        if (!m) return { ok: false, error: `${LABEL[k] || k}: enter a 10-digit mobile number` };
        v = m;
      }
    } else if (k === "fullName" || k === "guardianName") {
      if (!v) return { ok: false, error: `${LABEL[k] || "Name"} cannot be empty` };
    } else if (k === "gender") {
      if (!["M", "F", "O", ""].includes(v)) return { ok: false, error: "Gender: M, F or O" };
    } else if (k === "dob") {
      // YYYY-MM-DD only, a real date, a school-age child. The DOB parser
      // once swapped day and month on 42% of records — no guessing here.
      if (v) {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const d = m ? new Date(`${v}T00:00:00Z`) : null;
        if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
          return { ok: false, error: "Date of birth: pick a real date" };
        }
        const age = (Date.parse(`${today}T00:00:00Z`) - d.getTime()) / (365.25 * 86_400_000);
        if (age < 2 || age > 25) return { ok: false, error: "Date of birth: the child's age must be 2–25" };
      }
    } else if (k === "bloodGroup") {
      if (v && !(BLOOD_GROUPS as readonly string[]).includes(v)) {
        return { ok: false, error: `Blood group: one of ${BLOOD_GROUPS.join(", ")}` };
      }
    } else if (k === "category") {
      if (v && !STUDENT_CATEGORIES.some((c) => c.value === v)) {
        return { ok: false, error: "Category: pick from the list" };
      }
    } else if (k === "rollNo") {
      if (v && !/^[A-Za-z0-9-]{1,8}$/.test(v)) return { ok: false, error: "Roll no.: up to 8 letters/digits" };
    } else if (k === "pincode") {
      if (v && !/^\d{6}$/.test(v)) return { ok: false, error: "PIN code: 6 digits" };
    }
    values[k] = v;
  }
  if (Object.keys(values).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, values };
}
