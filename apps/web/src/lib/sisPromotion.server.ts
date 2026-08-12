/**
 * Promote one live student to the next academic year — the visible half
 * of Phase 4. See docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md.
 *
 * Two writes, one operation, in a specific order:
 *
 *   1. sis_promote_enrollment (Phase 4) — atomic, guarded, self-contained.
 *      Records the promotion in sis_student_identities/sis_enrollments.
 *   2. pushSisToDb — the SAME guarded save path every other student edit
 *      already goes through — updates the live sis_students row so the
 *      change is visible on every real screen immediately. Phase 5 (the
 *      read-path cutover) has not happened; sis_students is still the
 *      only table anything in the app reads.
 *
 * Step 1 runs first deliberately: it has its own strong guards (row lock,
 * duplicate-year rejection) and is atomic in itself, so if it fails
 * nothing has changed anywhere. If step 2 then fails — a genuinely
 * possible partial state — the function reports that distinctly (`stage:
 * "live-record"`) rather than as a plain failure, because the enrollment
 * WAS recorded; only the visible side didn't update. That state is
 * recoverable (retry step 2 alone) and must never be reported as if
 * nothing happened.
 *
 * Self-healing: sis_student_identities/sis_enrollments were backfilled
 * once, from sis_students as it stood when Phase 2 ran. A student created
 * or edited since then has no matching identity/enrollment yet. Rather
 * than fail, this creates one from the current live row — using the same
 * coalesce(...,'') field mapping Phase 2's backfill used — so the new
 * tables stay a faithful mirror going forward instead of drifting stale.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerTenantContext } from "@/lib/serverTenant";
import { promoteSisEnrollment } from "@/lib/sisEnrollmentPromotion.server";
import { pushSisToDb, rowToStudent, type StudentRow } from "@/lib/sisNormalized.server";
import { normalizeStudent, type SisStudent } from "@/lib/sis";

export type PromoteStudentInput = {
  studentId: string;
  toAcademicYearCode: string;
  toClassId: string;
  toSectionId: string;
  toStudentType?: string;
};

export type PromoteStudentResult =
  | { ok: true; studentId: string; newEnrollmentId: string }
  | {
      ok: false;
      studentId: string;
      /** "enrollment" = nothing changed anywhere. "live-record" = the
       *  promotion IS recorded in sis_enrollments but sis_students did
       *  not update — not visible yet, needs a retry, not a re-promote. */
      stage: "enrollment" | "live-record";
      error: string;
    };

async function ensureIdentityAndCurrentEnrollment(
  sb: SupabaseClient,
  tenantId: string,
  row: StudentRow & { admission_no: string; academic_year_code: string },
): Promise<{ ok: true; enrollmentId: string } | { ok: false; error: string }> {
  let identityId: string | null = null;

  const { data: existingIdentity, error: idErr } = await sb
    .from("sis_student_identities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("admission_no", row.admission_no)
    .maybeSingle();
  if (idErr) return { ok: false, error: `Identity lookup failed: ${idErr.message}` };

  if (existingIdentity) {
    identityId = existingIdentity.id as string;
  } else {
    identityId = "sid_" + Math.random().toString(36).slice(2, 14);
    const { error: insErr } = await sb.from("sis_student_identities").insert({
      id: identityId,
      tenant_id: tenantId,
      admission_no: row.admission_no,
      full_name: row.full_name ?? "",
      gender: row.gender ?? "",
      dob: row.dob,
      father_name: row.father_name ?? "",
      mother_name: row.mother_name ?? "",
      father_mobile: row.father_mobile ?? "",
      mother_mobile: row.mother_mobile ?? "",
      father_aadhaar_last4: row.father_aadhaar_last4 ?? "",
      mother_aadhaar_last4: row.mother_aadhaar_last4 ?? "",
      father_pan: row.father_pan ?? "",
      mother_pan: row.mother_pan ?? "",
      guardian_relation: row.guardian_relation ?? "",
      emergency_name: row.emergency_name ?? "",
      emergency_mobile: row.emergency_mobile ?? "",
      household_id: row.household_id ?? "",
      blood_group: row.blood_group ?? "",
      religion: row.religion ?? "",
      category: row.category ?? "",
      nationality: row.nationality ?? "",
      mother_tongue: row.mother_tongue ?? "",
      place_of_birth: row.place_of_birth ?? "",
      aadhaar_last4: row.aadhaar_last4 ?? "",
      pen: row.pen ?? "",
      pen_status: row.pen_status ?? "",
      apaar_id: row.apaar_id ?? "",
      srn: row.srn ?? "",
      previous_school: row.previous_school ?? "",
      previous_tc_no: row.previous_tc_no ?? "",
      previous_udise: row.previous_udise ?? "",
      docs: row.docs ?? {},
      notes: row.notes ?? "",
      photo_url: row.photo_url ?? "",
    });
    if (insErr) return { ok: false, error: `Identity creation failed: ${insErr.message}` };
  }

  const { data: existingEnrollment, error: enrErr } = await sb
    .from("sis_enrollments")
    .select("id")
    .eq("identity_id", identityId)
    .eq("academic_year_code", row.academic_year_code)
    .maybeSingle();
  if (enrErr) return { ok: false, error: `Enrollment lookup failed: ${enrErr.message}` };

  if (existingEnrollment) {
    return { ok: true, enrollmentId: existingEnrollment.id as string };
  }

  const enrollmentId = "enr_" + Math.random().toString(36).slice(2, 14);
  const { error: enrInsErr } = await sb.from("sis_enrollments").insert({
    id: enrollmentId,
    tenant_id: tenantId,
    identity_id: identityId,
    academic_year_code: row.academic_year_code,
    class_id: row.class_id ?? "",
    section_id: row.section_id ?? "",
    campus_id: row.campus_id ?? "",
    roll_no: row.roll_no ?? "",
    fee_group_id: row.fee_group_id ?? "",
    student_type: row.student_type ?? "",
    status: "active",
  });
  if (enrInsErr) return { ok: false, error: `Enrollment creation failed: ${enrInsErr.message}` };

  return { ok: true, enrollmentId };
}

export async function promoteStudentToNextYear(
  input: PromoteStudentInput,
): Promise<PromoteStudentResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: "Tenant context unavailable",
    };
  }
  const { sb, tenantId } = ctx;

  const { data: row, error: rowErr } = await sb
    .from("sis_students")
    .select("*")
    .eq("id", input.studentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (rowErr || !row) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: rowErr?.message ?? "Student not found",
    };
  }
  const typed = row as StudentRow;
  if (typed.status === "inactive") {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: "Student is inactive — cannot promote",
    };
  }
  if (!typed.admission_no) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: "Student has no admission number — cannot link to an identity",
    };
  }
  if (!typed.academic_year_code) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: "Student has no current academic year on record",
    };
  }
  if (typed.academic_year_code === input.toAcademicYearCode) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "enrollment",
      error: "Target year matches the student's current year",
    };
  }

  const ensured = await ensureIdentityAndCurrentEnrollment(sb, tenantId, {
    ...typed,
    admission_no: typed.admission_no,
    academic_year_code: typed.academic_year_code,
  });
  if (!ensured.ok) {
    return { ok: false, studentId: input.studentId, stage: "enrollment", error: ensured.error };
  }

  const promo = await promoteSisEnrollment({
    fromEnrollmentId: ensured.enrollmentId,
    toAcademicYearCode: input.toAcademicYearCode,
    toClassId: input.toClassId,
    toSectionId: input.toSectionId,
    toFeeGroupId: typed.fee_group_id ?? undefined,
    toStudentType: input.toStudentType ?? "PROMOTE",
  });
  if (!promo.ok) {
    return { ok: false, studentId: input.studentId, stage: "enrollment", error: promo.error };
  }

  const current = rowToStudent(typed);
  const updated: SisStudent = normalizeStudent({
    ...current,
    classId: input.toClassId,
    sectionId: input.toSectionId,
    academicYearCode: input.toAcademicYearCode,
    rollNo: "",
    studentType: (input.toStudentType as SisStudent["studentType"]) ?? "PROMOTE",
    revisionAt: typed.updated_at,
  });

  const pushResult = await pushSisToDb({ households: [], students: [updated] });
  if (!pushResult.ok || pushResult.studentCount < 1) {
    return {
      ok: false,
      studentId: input.studentId,
      stage: "live-record",
      error:
        pushResult.error ??
        "The promotion was recorded but the live record did not update yet — retry rather than promote again.",
    };
  }

  return { ok: true, studentId: input.studentId, newEnrollmentId: promo.newEnrollmentId };
}
