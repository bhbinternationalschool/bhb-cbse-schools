/**
 * Parent / staff self-service document verification.
 * Submit → pending → class teacher / office / principal approve or reject.
 */

import {
  STAFF_DOC_LABELS,
  type StaffDocFile,
  type StaffDocKey,
  type StaffRecord,
} from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";
import { getSessionActor } from "@/lib/sessionActor";
import { hasPermission } from "@/lib/rbac";
import { assertSessionWritable } from "@/lib/sessionWriteGuard";
import {
  DOC_LABELS,
  docHasFile,
  loadSis,
  type Household,
  type StudentDocFile,
  type StudentDocKey,
  type SisStudent,
  writeSisLocalRaw,
} from "@/lib/sis";
import { trackServerWork } from "@/lib/serverWork";

export type DocVerifySubject = "student" | "staff";

export type PendingDocItem = {
  subject: DocVerifySubject;
  subjectId: string;
  subjectName: string;
  classLabel: string;
  docKey: string;
  docLabel: string;
  file: StudentDocFile | StaffDocFile;
  householdId?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function persistSisForParent(state: ReturnType<typeof loadSis>) {
  writeSisLocalRaw(state);
  void trackServerWork(import("@/lib/sisPersistence").then(({ scheduleSisSync }) => {
    scheduleSisSync(state);
  }));
}

/** Limited household fields parents may update themselves. */
export function updateParentHouseholdProfile(input: {
  householdId: string;
  guardianName?: string;
  altMobile?: string;
  email?: string;
  address?: string;
  locality?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  guardianPhotoUrl?: string;
}): { ok: true; household: Household } | { ok: false; error: string } {
  const sis = loadSis();
  const i = sis.households.findIndex((h) => h.id === input.householdId);
  if (i < 0) return { ok: false, error: "Household not found" };
  const prev = sis.households[i]!;
  const next: Household = {
    ...prev,
    guardianName: input.guardianName?.trim() || prev.guardianName,
    altMobile: input.altMobile !== undefined ? input.altMobile.trim() : prev.altMobile,
    email: input.email !== undefined ? input.email.trim() : prev.email,
    address: input.address !== undefined ? input.address.trim() : prev.address,
    locality: input.locality !== undefined ? input.locality.trim() : prev.locality,
    landmark: input.landmark !== undefined ? input.landmark.trim() : prev.landmark,
    city: input.city !== undefined ? input.city.trim() : prev.city,
    state: input.state !== undefined ? input.state.trim() : prev.state,
    pincode: input.pincode !== undefined ? input.pincode.trim() : prev.pincode,
    guardianPhotoUrl:
      input.guardianPhotoUrl !== undefined
        ? input.guardianPhotoUrl
        : prev.guardianPhotoUrl,
  };
  const households = [...sis.households];
  households[i] = next;
  persistSisForParent({ ...sis, households });
  return { ok: true, household: next };
}

export function submitStudentDocForVerification(input: {
  householdId: string;
  studentId: string;
  docKey: StudentDocKey;
  file: StudentDocFile;
  submittedBy: string;
}): { ok: true; student: SisStudent } | { ok: false; error: string } {
  if (!docHasFile(input.file)) {
    return { ok: false, error: "Upload a file before submitting" };
  }
  const sis = loadSis();
  const si = sis.students.findIndex((s) => s.id === input.studentId);
  if (si < 0) return { ok: false, error: "Student not found" };
  const student = sis.students[si]!;
  if (student.householdId !== input.householdId) {
    return { ok: false, error: "Student is not in your household" };
  }
  const nextFile: StudentDocFile = {
    ...input.file,
    status: "pending",
    submittedBy: input.submittedBy.trim() || "Parent",
    submittedAt: nowIso(),
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
  };
  const students = [...sis.students];
  students[si] = {
    ...student,
    docs: { ...student.docs, [input.docKey]: nextFile },
    ...(input.docKey === "photo" && nextFile.fileUrl
      ? { photoUrl: nextFile.fileUrl }
      : {}),
  };
  persistSisForParent({ ...sis, students });
  return { ok: true, student: students[si]! };
}

function canDecideStudentDocs(): boolean {
  if (!assertSessionWritable("decideStudentDoc")) return false;
  const session = getSessionActor();
  if (!session) return true;
  const masters = loadMasters();
  return (
    hasPermission(session, masters, "students", "approve") ||
    hasPermission(session, masters, "students", "edit")
  );
}

function canDecideStaffDocs(): boolean {
  if (!assertSessionWritable("decideStaffDoc")) return false;
  const session = getSessionActor();
  if (!session) return true;
  const masters = loadMasters();
  return (
    hasPermission(session, masters, "staff", "approve") ||
    hasPermission(session, masters, "staff", "edit")
  );
}

export function decideStudentDocVerification(input: {
  studentId: string;
  docKey: StudentDocKey;
  approve: boolean;
  by: string;
  note?: string;
}): { ok: true; student: SisStudent } | { ok: false; error: string } {
  if (!canDecideStudentDocs()) {
    return { ok: false, error: "Not allowed to verify documents" };
  }
  const sis = loadSis();
  const si = sis.students.findIndex((s) => s.id === input.studentId);
  if (si < 0) return { ok: false, error: "Student not found" };
  const student = sis.students[si]!;
  const prev = student.docs[input.docKey];
  if (!docHasFile(prev)) {
    return { ok: false, error: "No file to verify" };
  }
  if (prev.status !== "pending" && prev.status !== "received") {
    return { ok: false, error: "Document is not awaiting verification" };
  }
  const nextFile: StudentDocFile = {
    ...prev,
    status: input.approve ? "verified" : "rejected",
    reviewedBy: input.by.trim() || "Office",
    reviewedAt: nowIso(),
    reviewNote: (input.note || "").trim(),
  };
  const students = [...sis.students];
  students[si] = {
    ...student,
    docs: { ...student.docs, [input.docKey]: nextFile },
  };
  persistSisForParent({ ...sis, students });
  return { ok: true, student: students[si]! };
}

/**
 * A member of staff submits one of their OWN documents (already uploaded) for
 * the office's check — through POST /api/v1/staff/me/docs (data-layer 2.2d),
 * which writes only that document on the caller's own record. It went
 * through the whole-book Masters save before, which a member without Masters
 * edit never sent while the screen said "Submitted". Resolves only after the
 * server answered.
 */
export async function submitStaffDocForVerification(input: {
  staffId: string;
  docKey: StaffDocKey;
  file: StaffDocFile;
  submittedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.file.fileUrl) {
    return { ok: false, error: "Upload a file before submitting" };
  }
  let res: Response;
  try {
    res = await fetch("/api/v1/staff/me/docs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docKey: input.docKey, file: input.file }),
    });
  } catch (e) {
    return { ok: false, error: `Not submitted — the network failed (${e instanceof Error ? e.message : String(e)})` };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.error?.message || `Not submitted — the server answered ${res.status}` };
  }
  // The roster this tab holds (your record, with its documents) follows the server.
  const { bridgeStaffAfterWrite } = await import("@/lib/data/client/staffBridge");
  await bridgeStaffAfterWrite();
  return { ok: true };
}

/**
 * The office / principal verifies or rejects a member's document: one staff
 * record write through the kernel (sis.staff, data-layer 2.2d) — only that
 * document, laid on the record as stored now; refused (with the server's
 * reason) without Staff · edit. Resolves only after the server answered.
 */
export async function decideStaffDocVerification(input: {
  staffId: string;
  docKey: StaffDocKey;
  approve: boolean;
  by: string;
  note?: string;
}): Promise<{ ok: true; staff: StaffRecord } | { ok: false; error: string }> {
  if (!canDecideStaffDocs()) {
    return { ok: false, error: "Not allowed to verify staff documents" };
  }
  const masters = loadMasters();
  const si = masters.staff.findIndex((s) => s.id === input.staffId);
  if (si < 0) return { ok: false, error: "Staff not found" };
  const staff = masters.staff[si]!;
  const prev = staff.docs[input.docKey];
  if (!prev?.fileUrl) return { ok: false, error: "No file to verify" };
  if (prev.status !== "pending" && prev.status !== "received") {
    return { ok: false, error: "Document is not awaiting verification" };
  }
  const nextFile: StaffDocFile = {
    ...prev,
    status: input.approve ? "verified" : "rejected",
    reviewedBy: input.by.trim() || "HR / Office",
    reviewedAt: nowIso(),
    reviewNote: (input.note || "").trim(),
  };
  const nextStaff: StaffRecord = {
    ...staff,
    docs: { ...staff.docs, [input.docKey]: nextFile },
  };
  const { commitStaffBook } = await import("@/lib/data/client/staffBookWrites");
  const { bridgeStaffAfterWrite } = await import("@/lib/data/client/staffBridge");
  const r = await commitStaffBook(
    { staff: masters.staff },
    { staff: masters.staff.map((s) => (s.id === staff.id ? nextStaff : s)) },
  );
  await bridgeStaffAfterWrite();
  if (!r.ok) return { ok: false, error: r.message };
  return { ok: true, staff: nextStaff };
}

export function listPendingStudentDocs(opts?: {
  classId?: string;
  sectionId?: string;
}): PendingDocItem[] {
  const sis = loadSis();
  const masters = loadMasters();
  const out: PendingDocItem[] = [];
  for (const s of sis.students) {
    if (s.status !== "active") continue;
    if (opts?.classId && s.classId !== opts.classId) continue;
    if (opts?.sectionId && s.sectionId !== opts.sectionId) continue;
    const cls = masters.classes.find((c) => c.id === s.classId);
    const sec = masters.sections.find((x) => x.id === s.sectionId);
    const classLabel = [cls?.name, sec?.name].filter(Boolean).join("-") || "—";
    for (const { key, label } of DOC_LABELS) {
      const file = s.docs[key];
      if (file.status === "pending" || file.status === "received") {
        if (!docHasFile(file)) continue;
        out.push({
          subject: "student",
          subjectId: s.id,
          subjectName: s.fullName,
          classLabel,
          docKey: key,
          docLabel: label,
          file,
          householdId: s.householdId,
        });
      }
    }
  }
  return out.sort((a, b) =>
    (b.file.submittedAt || b.file.uploadedAt || "").localeCompare(
      a.file.submittedAt || a.file.uploadedAt || "",
    ),
  );
}

export function listPendingStaffDocs(): PendingDocItem[] {
  const masters = loadMasters();
  const out: PendingDocItem[] = [];
  for (const s of masters.staff) {
    if (s.status === "inactive") continue;
    for (const { key, label } of STAFF_DOC_LABELS) {
      const file = s.docs[key];
      if (
        (file.status === "pending" || file.status === "received") &&
        file.fileUrl
      ) {
        out.push({
          subject: "staff",
          subjectId: s.id,
          subjectName: s.fullName,
          classLabel: s.empCode || "Staff",
          docKey: key,
          docLabel: label,
          file,
        });
      }
    }
  }
  return out.sort((a, b) =>
    (b.file.submittedAt || b.file.uploadedAt || "").localeCompare(
      a.file.submittedAt || a.file.uploadedAt || "",
    ),
  );
}

export function studentDocLabel(key: StudentDocKey): string {
  return DOC_LABELS.find((d) => d.key === key)?.label ?? key;
}
