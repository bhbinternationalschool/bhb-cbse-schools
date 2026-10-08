/**
 * A class teacher's edits to one child / one family, written straight to
 * that row — never through the whole-roster push (see sisProfile.server.ts
 * for why). Each write is conditional on the row's revision the teacher
 * read (`updated_at`): if the office saved the row in between, the write is
 * refused as a conflict instead of overwriting their work.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { SHEET_COLUMNS, type SheetValues } from "@/lib/classDetailsSheet";
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

/**
 * My class → Class sheet: one child's measured height / weight, blood group,
 * mother tongue, religion, category, parents' education and CWSN. Columns go
 * to their columns; the rest live in the `profile` jsonb, so the row's
 * profile is read and only the keys sent are changed — never the whole bag
 * from the browser. Conditional on the revision the teacher read, like
 * every class-teacher write. `measuredOn` is stamped only with a height or
 * weight.
 */
export async function setStudentSheetValues(
  studentId: string,
  values: SheetValues,
  measuredOn: string,
  revisionAt: string | undefined,
): Promise<WriteResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const cur = await ctx.sb
    .from("sis_students")
    .select("profile, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "Record not found" };
  const readAt = String(cur.data.updated_at || "");
  if (revisionAt && readAt !== revisionAt) {
    return { ok: false, conflict: true, error: "Someone else changed this child's record just now — reload and try again" };
  }

  const patch: Record<string, unknown> = {};
  const profileChanges: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values) as [keyof SheetValues, unknown][]) {
    const col = SHEET_COLUMNS[k];
    if (col) patch[col] = v;
    else profileChanges[k] = v;
    local[k] = v;
  }
  if ("heightCm" in values || "weightKg" in values) {
    profileChanges.measuredOn = measuredOn;
    local.measuredOn = measuredOn;
  }
  if (Object.keys(profileChanges).length) {
    const profile = (cur.data.profile && typeof cur.data.profile === "object" && !Array.isArray(cur.data.profile)
      ? cur.data.profile
      : {}) as Record<string, unknown>;
    patch.profile = { ...profile, ...profileChanges };
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to save for this child" };

  // Conditional on the revision just read, so a save landing between the
  // read and this write is not overwritten.
  const r = await conditionalUpdate("sis_students", studentId, patch, readAt || revisionAt);
  if (r.ok) {
    const sis = loadSis();
    const i = sis.students.findIndex((s) => s.id === studentId);
    if (i >= 0) {
      const students = [...sis.students];
      students[i] = { ...students[i]!, ...local, revisionAt: r.updatedAt } as (typeof students)[number];
      writeSisLocalRaw({ ...sis, students });
    }
  }
  return r;
}
