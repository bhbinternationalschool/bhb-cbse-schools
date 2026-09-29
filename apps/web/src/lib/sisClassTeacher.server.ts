/**
 * A class teacher's edits to one child / one family, written straight to
 * that row — never through the whole-roster push (see sisProfile.server.ts
 * for why). Each write is conditional on the row's revision the teacher
 * read (`updated_at`): if the office saved the row in between, the write is
 * refused as a conflict instead of overwriting their work.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, syncPhotoDoc, writeSisLocalRaw } from "@/lib/sis";
import {
  CLASS_TEACHER_HOUSEHOLD_FIELDS,
  CLASS_TEACHER_STUDENT_FIELDS,
} from "@/lib/sisClassTeacher";

type WriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; conflict?: boolean; error: string };

async function conditionalUpdate(
  table: "sis_students" | "sis_households",
  id: string,
  patch: Record<string, unknown>,
  revisionAt: string | undefined,
): Promise<WriteResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const now = new Date().toISOString();
  let data: { id: string }[] | null = null;
  try {
    let q = ctx.sb
      .from(table)
      .update({ ...patch, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id);
    if (revisionAt) q = q.eq("updated_at", revisionAt);
    const r = await q.select("id");
    if (r.error) return { ok: false, error: r.error.message };
    data = r.data as { id: string }[] | null;
  } catch (e) {
    console.error(`[class-teacher sis] ${table} update failed`, (e as Error)?.message);
    return { ok: false, error: "Not saved — the school records could not be updated. Please try again." };
  }
  if (!data || data.length === 0) {
    return revisionAt
      ? {
          ok: false,
          conflict: true,
          error: "Someone else changed this record just now — reload it and try again",
        }
      : { ok: false, error: "Record not found" };
  }
  return { ok: true, updatedAt: now };
}

export async function updateStudentByClassTeacher(
  studentId: string,
  values: Record<string, string>,
  revisionAt?: string,
): Promise<WriteResult> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const col = (CLASS_TEACHER_STUDENT_FIELDS as Record<string, string>)[k];
    if (col) patch[col] = k === "dob" && !v ? null : v;
  }
  const r = await conditionalUpdate("sis_students", studentId, patch, revisionAt);
  if (r.ok) {
    const sis = loadSis();
    const i = sis.students.findIndex((s) => s.id === studentId);
    if (i >= 0) {
      const students = [...sis.students];
      students[i] = { ...students[i]!, ...values, revisionAt: r.updatedAt } as typeof students[number];
      writeSisLocalRaw({ ...sis, students });
    }
  }
  return r;
}

export async function updateHouseholdByClassTeacher(
  householdId: string,
  values: Record<string, string>,
  revisionAt?: string,
): Promise<WriteResult> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const col = (CLASS_TEACHER_HOUSEHOLD_FIELDS as Record<string, string>)[k];
    if (col) patch[col] = v;
  }
  const r = await conditionalUpdate("sis_households", householdId, patch, revisionAt);
  if (r.ok) {
    const sis = loadSis();
    const i = sis.households.findIndex((h) => h.id === householdId);
    if (i >= 0) {
      const households = [...sis.households];
      households[i] = { ...households[i]!, ...values, revisionAt: r.updatedAt } as typeof households[number];
      writeSisLocalRaw({ ...sis, households });
    }
  }
  return r;
}

/** Profile photo + the photo slot in the child's documents, together. */
export async function setStudentPhotoByClassTeacher(
  studentId: string,
  photoUrl: string,
  revisionAt?: string,
): Promise<WriteResult> {
  const sis = loadSis();
  const cur = sis.students.find((s) => s.id === studentId);
  if (!cur) return { ok: false, error: "Student not found" };
  const docs = syncPhotoDoc(cur.docs, photoUrl);
  const r = await conditionalUpdate(
    "sis_students",
    studentId,
    { photo_url: photoUrl, docs },
    revisionAt,
  );
  if (r.ok) {
    const fresh = loadSis();
    const i = fresh.students.findIndex((s) => s.id === studentId);
    if (i >= 0) {
      const students = [...fresh.students];
      students[i] = { ...students[i]!, photoUrl, docs, revisionAt: r.updatedAt };
      writeSisLocalRaw({ ...fresh, students });
    }
  }
  return r;
}
