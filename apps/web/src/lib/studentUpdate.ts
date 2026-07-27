/**
 * Update Students — details, biometric/RFID, login password, bulk photos.
 */

import {
  loadSis,
  normalizeStudent,
  normalizeHousehold,
  saveSis,
  syncPhotoDoc,
  householdOf,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

function findStudentByAdmission(
  sis: SisState,
  admissionNo: string,
): SisStudent | undefined {
  const key = admissionNo.trim().toLowerCase();
  if (!key) return undefined;
  return sis.students.find((s) => s.admissionNo.trim().toLowerCase() === key);
}

/** Strip extension and path noise from a bulk-upload filename. */
export function parseBulkImageName(fileName: string): {
  admissionNo: string;
  kind: "student" | "father" | "mother" | "parent" | "guardian";
} {
  const base = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .trim();
  const lower = base.toLowerCase();
  let kind: "student" | "father" | "mother" | "parent" | "guardian" = "student";
  let admissionNo = base;

  const suffixMatch = lower.match(
    /^(.+?)[_\-\s]+(father|dad|mother|mom|parent|guardian|student|photo|img)$/i,
  );
  if (suffixMatch) {
    admissionNo = suffixMatch[1]!;
    const tag = suffixMatch[2]!.toLowerCase();
    if (tag === "father" || tag === "dad") kind = "father";
    else if (tag === "mother" || tag === "mom") kind = "mother";
    else if (tag === "parent") kind = "parent";
    else if (tag === "guardian") kind = "guardian";
    else kind = "student";
  } else {
    const prefixMatch = lower.match(
      /^(father|dad|mother|mom|parent|guardian)[_\-\s]+(.+)$/i,
    );
    if (prefixMatch) {
      const tag = prefixMatch[1]!.toLowerCase();
      admissionNo = prefixMatch[2]!;
      if (tag === "father" || tag === "dad") kind = "father";
      else if (tag === "mother" || tag === "mom") kind = "mother";
      else if (tag === "parent") kind = "parent";
      else kind = "guardian";
    }
  }

  return { admissionNo: admissionNo.trim(), kind };
}

export type UpdateStudentDetailsInput = {
  studentId: string;
  fullName?: string;
  rollNo?: string;
  gender?: SisStudent["gender"];
  dob?: string;
  fatherName?: string;
  motherName?: string;
  fatherMobile?: string;
  motherMobile?: string;
  notes?: string;
  bloodGroup?: string;
  category?: SisStudent["category"];
  religion?: string;
};

export function updateStudentDetails(
  input: UpdateStudentDetailsInput,
): { ok: true; state: SisState; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const prev = sis.students[idx]!;
  const updated = normalizeStudent({
    ...prev,
    fullName: input.fullName !== undefined ? input.fullName.trim() : prev.fullName,
    rollNo: input.rollNo !== undefined ? input.rollNo.trim() : prev.rollNo,
    gender: input.gender !== undefined ? input.gender : prev.gender,
    dob: input.dob !== undefined ? input.dob : prev.dob,
    fatherName:
      input.fatherName !== undefined ? input.fatherName.trim() : prev.fatherName,
    motherName:
      input.motherName !== undefined ? input.motherName.trim() : prev.motherName,
    fatherMobile:
      input.fatherMobile !== undefined
        ? input.fatherMobile
        : prev.fatherMobile,
    motherMobile:
      input.motherMobile !== undefined
        ? input.motherMobile
        : prev.motherMobile,
    notes: input.notes !== undefined ? input.notes.trim() : prev.notes,
    bloodGroup:
      input.bloodGroup !== undefined ? input.bloodGroup : prev.bloodGroup,
    category: input.category !== undefined ? input.category : prev.category,
    religion:
      input.religion !== undefined ? input.religion.trim() : prev.religion,
  });
  if (!updated.fullName) return { ok: false, error: "Name is required" };
  const students = [...sis.students];
  students[idx] = updated;
  const state = { ...sis, students };
  saveSis(state);
  return { ok: true, state, student: updated };
}

export function updateStudentBiometric(input: {
  studentId: string;
  rfidNo?: string;
  biometricId?: string;
}): { ok: true; state: SisState; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const prev = sis.students[idx]!;
  const rfidNo =
    input.rfidNo !== undefined ? input.rfidNo.trim() : prev.rfidNo;
  const biometricId =
    input.biometricId !== undefined
      ? input.biometricId.trim()
      : prev.biometricId;

  if (rfidNo) {
    const clash = sis.students.find(
      (s) =>
        s.id !== prev.id &&
        s.rfidNo &&
        s.rfidNo.toLowerCase() === rfidNo.toLowerCase(),
    );
    if (clash) {
      return {
        ok: false,
        error: `RFID already used by ${clash.fullName} (${clash.admissionNo})`,
      };
    }
  }
  if (biometricId) {
    const clash = sis.students.find(
      (s) =>
        s.id !== prev.id &&
        s.biometricId &&
        s.biometricId.toLowerCase() === biometricId.toLowerCase(),
    );
    if (clash) {
      return {
        ok: false,
        error: `Biometric ID already used by ${clash.fullName} (${clash.admissionNo})`,
      };
    }
  }

  const updated = normalizeStudent({ ...prev, rfidNo, biometricId });
  const students = [...sis.students];
  students[idx] = updated;
  const state = { ...sis, students };
  saveSis(state);
  return { ok: true, state, student: updated };
}

export function updateStudentLoginPassword(input: {
  studentId: string;
  loginUsername?: string;
  loginPassword: string;
  confirmPassword?: string;
}): { ok: true; state: SisState; student: SisStudent } | { ok: false; error: string } {
  const password = input.loginPassword.trim();
  if (password.length < 4) {
    return { ok: false, error: "Password must be at least 4 characters" };
  }
  if (
    input.confirmPassword !== undefined &&
    input.confirmPassword !== input.loginPassword
  ) {
    return { ok: false, error: "Passwords do not match" };
  }
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const prev = sis.students[idx]!;
  const loginUsername =
    (input.loginUsername ?? prev.loginUsername ?? prev.admissionNo).trim() ||
    prev.admissionNo;

  if (loginUsername) {
    const clash = sis.students.find(
      (s) =>
        s.id !== prev.id &&
        (s.loginUsername || s.admissionNo).toLowerCase() ===
          loginUsername.toLowerCase(),
    );
    if (clash) {
      return {
        ok: false,
        error: `Username already used by ${clash.fullName}`,
      };
    }
  }

  const updated = normalizeStudent({
    ...prev,
    loginUsername,
    loginPassword: password,
  });
  const students = [...sis.students];
  students[idx] = updated;
  const state = { ...sis, students };
  saveSis(state);
  return { ok: true, state, student: updated };
}

export type BulkImageResult = {
  applied: number;
  skipped: number;
  errors: string[];
  state: SisState;
};

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Not an image"));
      return;
    }
    if (file.size > 1_200_000) {
      reject(new Error("Image over 1.2 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Read failed"));
    };
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Bulk student photos — filename = admission no
 * (e.g. BHB-2025-101.jpg or BHB-2025-101_student.jpg)
 */
export async function bulkUploadStudentImages(
  files: FileList | File[],
): Promise<BulkImageResult> {
  const list = Array.from(files);
  let sis = loadSis();
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  const students = [...sis.students];

  for (const file of list) {
    const { admissionNo, kind } = parseBulkImageName(file.name);
    if (kind !== "student" && kind !== "parent") {
      // father/mother/guardian belong in parent bulk
      if (kind === "father" || kind === "mother" || kind === "guardian") {
        skipped += 1;
        errors.push(`${file.name}: use Parent images for ${kind}`);
        continue;
      }
    }
    const stu = findStudentByAdmission(sis, admissionNo);
    if (!stu) {
      skipped += 1;
      errors.push(`${file.name}: no student for “${admissionNo}”`);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const idx = students.findIndex((s) => s.id === stu.id);
      if (idx < 0) continue;
      const docs = syncPhotoDoc(students[idx]!.docs, dataUrl);
      students[idx] = normalizeStudent({
        ...students[idx]!,
        photoUrl: dataUrl,
        docs,
      });
      applied += 1;
    } catch (e) {
      skipped += 1;
      errors.push(
        `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`,
      );
    }
  }

  sis = { ...sis, students };
  saveSis(sis);
  return { applied, skipped, errors: errors.slice(0, 40), state: sis };
}

/**
 * Bulk parent photos — filename = admissionNo_father / _mother / _parent / _guardian
 */
export async function bulkUploadParentImages(
  files: FileList | File[],
): Promise<BulkImageResult> {
  const list = Array.from(files);
  let sis = loadSis();
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  let students = [...sis.students];
  let households = [...sis.households];

  for (const file of list) {
    const parsed = parseBulkImageName(file.name);
    let { admissionNo, kind } = parsed;
    if (kind === "student") {
      // Bare admission no → treat as guardian/parent photo
      kind = "parent";
    }
    const stu = findStudentByAdmission(
      { ...sis, students, households },
      admissionNo,
    );
    if (!stu) {
      skipped += 1;
      errors.push(`${file.name}: no student for “${admissionNo}”`);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const sIdx = students.findIndex((s) => s.id === stu.id);
      if (sIdx < 0) continue;
      const cur = students[sIdx]!;

      if (kind === "father") {
        students[sIdx] = normalizeStudent({
          ...cur,
          fatherPhotoUrl: dataUrl,
        });
        applied += 1;
      } else if (kind === "mother") {
        students[sIdx] = normalizeStudent({
          ...cur,
          motherPhotoUrl: dataUrl,
        });
        applied += 1;
      } else {
        // parent / guardian → household + mirror to father if empty
        const hh = householdOf({ ...sis, students, households }, cur.householdId);
        if (hh) {
          const hIdx = households.findIndex((h) => h.id === hh.id);
          if (hIdx >= 0) {
            households[hIdx] = normalizeHousehold({
              ...households[hIdx]!,
              guardianPhotoUrl: dataUrl,
            });
          }
        }
        students[sIdx] = normalizeStudent({
          ...cur,
          fatherPhotoUrl: cur.fatherPhotoUrl || dataUrl,
        });
        applied += 1;
      }
    } catch (e) {
      skipped += 1;
      errors.push(
        `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`,
      );
    }
  }

  sis = { ...sis, students, households };
  saveSis(sis);
  return { applied, skipped, errors: errors.slice(0, 40), state: sis };
}

export function portalUsernameOf(student: SisStudent): string {
  return (student.loginUsername || student.admissionNo || "").trim();
}

export function hasPortalPassword(student: SisStudent): boolean {
  return !!(student.loginPassword && student.loginPassword.length > 0);
}

export function setStudentPhoto(
  studentId: string,
  photoUrl: string,
): { ok: true; state: SisState; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const prev = sis.students[idx]!;
  const docs = syncPhotoDoc(prev.docs, photoUrl);
  const updated = normalizeStudent({
    ...prev,
    photoUrl,
    docs,
  });
  const students = [...sis.students];
  students[idx] = updated;
  const state = { ...sis, students };
  saveSis(state);
  return { ok: true, state, student: updated };
}

export function setParentPhoto(
  studentId: string,
  which: "father" | "mother" | "guardian",
  photoUrl: string,
): { ok: true; state: SisState; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const prev = sis.students[idx]!;
  let students = [...sis.students];
  let households = [...sis.households];

  if (which === "father") {
    students[idx] = normalizeStudent({ ...prev, fatherPhotoUrl: photoUrl });
  } else if (which === "mother") {
    students[idx] = normalizeStudent({ ...prev, motherPhotoUrl: photoUrl });
  } else {
    const hh = householdOf(sis, prev.householdId);
    if (hh) {
      const hIdx = households.findIndex((h) => h.id === hh.id);
      if (hIdx >= 0) {
        households[hIdx] = normalizeHousehold({
          ...households[hIdx]!,
          guardianPhotoUrl: photoUrl,
        });
      }
    }
    students[idx] = normalizeStudent({
      ...prev,
      fatherPhotoUrl: prev.fatherPhotoUrl || photoUrl,
    });
  }

  const state = { ...sis, students, households };
  saveSis(state);
  return { ok: true, state, student: students[idx]! };
}
