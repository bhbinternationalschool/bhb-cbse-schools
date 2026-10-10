/**
 * Targeted SIS writes for the parent app — one household's contact fields,
 * one student's documents — straight to the row, never through the
 * whole-roster push.
 *
 * pushSisToDb is built for a client that holds the complete roster: it
 * rewrites sis_sync_meta's counts from whatever it is given, so a payload
 * of one student would record the school as having one student. These
 * helpers update only the columns a parent may change and bump updated_at,
 * which is the row's revision — an office browser still holding the old
 * version of that row has its next save of it refused as a conflict rather
 * than silently overwriting what the parent submitted.
 *
 * After the row is written the server's in-process SIS cache is patched to
 * match, so a read in the same process (the app's next call) sees it.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  loadSis,
  writeSisLocalRaw,
  type Household,
  type SisStudent,
  type StudentDocs,
} from "@/lib/sis";
import { sisIdentitySplitEnabled } from "@/lib/sisNormalized.server";

export type HouseholdContactFields = Pick<
  Household,
  | "guardianName"
  | "altMobile"
  | "email"
  | "address"
  | "locality"
  | "landmark"
  | "city"
  | "state"
  | "pincode"
>;

export async function updateHouseholdContactInDb(
  householdId: string,
  fields: HouseholdContactFields,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const now = new Date().toISOString();
  const { error, data } = await ctx.sb
    .from("sis_households")
    .update({
      guardian_name: fields.guardianName,
      alt_mobile: fields.altMobile,
      email: fields.email,
      address: fields.address,
      locality: fields.locality,
      landmark: fields.landmark,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      updated_at: now,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", householdId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Household row not found" };

  const sis = loadSis();
  const i = sis.households.findIndex((h) => h.id === householdId);
  if (i >= 0) {
    const households = [...sis.households];
    households[i] = { ...households[i]!, ...fields, revisionAt: now };
    writeSisLocalRaw({ ...sis, households });
  }
  return { ok: true, updatedAt: now };
}

export async function updateStudentDocsInDb(
  studentId: string,
  docs: StudentDocs,
  photoUrl?: string,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { docs, updated_at: now };
  if (photoUrl !== undefined) patch.photo_url = photoUrl;

  // Under the identity split the docs live on the identity row the
  // enrollment points at; otherwise on the student row itself.
  let error: { message: string } | null = null;
  let touched = 0;
  if (sisIdentitySplitEnabled()) {
    const { data: enr, error: e1 } = await ctx.sb
      .from("sis_enrollments")
      .select("identity_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", studentId)
      .maybeSingle();
    if (e1) return { ok: false, error: e1.message };
    const identityId = (enr as { identity_id?: string } | null)?.identity_id;
    if (!identityId) return { ok: false, error: "Student identity not found" };
    const { error: e2, data } = await ctx.sb
      .from("sis_student_identities")
      .update(patch)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", identityId)
      .select("id");
    error = e2;
    touched = data?.length ?? 0;
  } else {
    const { error: e2, data } = await ctx.sb
      .from("sis_students")
      .update(patch)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", studentId)
      .select("id");
    error = e2;
    touched = data?.length ?? 0;
  }
  if (error) return { ok: false, error: error.message };
  if (touched === 0) return { ok: false, error: "Student row not found" };

  const sis = loadSis();
  const i = sis.students.findIndex((s) => s.id === studentId);
  if (i >= 0) {
    const students = [...sis.students];
    const next: SisStudent = { ...students[i]!, docs, revisionAt: now };
    if (photoUrl !== undefined) next.photoUrl = photoUrl;
    students[i] = next;
    writeSisLocalRaw({ ...sis, students });
  }
  return { ok: true, updatedAt: now };
}
