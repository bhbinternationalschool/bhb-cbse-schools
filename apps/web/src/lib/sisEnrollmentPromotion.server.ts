/**
 * Promote a child's enrollment to the next academic year — Phase 4 of the
 * identity/enrollment split. See docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md.
 *
 * This is new capability, not a rewrite of an existing flow — Phase 0 found
 * there is no year-rollover function anywhere in the app; the 226
 * duplicated admission numbers in production were created directly,
 * outside the app entirely.
 *
 * The actual write is the sis_promote_enrollment Postgres function: it
 * inserts the new enrollment and marks the source one 'promoted' inside a
 * single transaction with a row lock, so nothing can observe a state where
 * both are active, or where the insert happened but the source wasn't
 * closed. Verified against a throwaway synthetic identity before this
 * shipped — clean promotion, both guard conditions (re-promoting an
 * already-promoted source; promoting into a year that already has an
 * enrollment) rejected correctly with nothing written, fixture deleted
 * afterward with zero trace. Never run against real student data as a
 * test.
 *
 * Nothing in the app calls this yet — no promotion UI exists. Building
 * that is separate, larger surface area (class-to-class mapping, handling
 * students held back, bulk vs one-at-a-time) and is a decision for
 * whoever asks for it next, not something to build silently alongside the
 * write-path fix.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

export type PromoteEnrollmentInput = {
  fromEnrollmentId: string;
  toAcademicYearCode: string;
  toClassId: string;
  toSectionId: string;
  toCampusId?: string;
  toFeeGroupId?: string;
  toStudentType?: string;
};

export type PromoteEnrollmentResult =
  | { ok: true; newEnrollmentId: string }
  | { ok: false; error: string; existingId?: string };

export async function promoteSisEnrollment(
  input: PromoteEnrollmentInput,
): Promise<PromoteEnrollmentResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Tenant context unavailable" };
  }
  const { sb, tenantId } = ctx;

  const { data, error } = await sb.rpc("sis_promote_enrollment", {
    p_tenant_id: tenantId,
    p_from_enrollment_id: input.fromEnrollmentId,
    p_to_academic_year_code: input.toAcademicYearCode,
    p_to_class_id: input.toClassId,
    p_to_section_id: input.toSectionId,
    p_to_campus_id: input.toCampusId ?? null,
    p_to_fee_group_id: input.toFeeGroupId ?? null,
    p_to_student_type: input.toStudentType ?? "PROMOTE",
  });

  if (error) {
    console.error("[sis-db] sis_promote_enrollment failed", error.message);
    return { ok: false, error: `Promotion refused: ${error.message}` };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    existing_id?: string;
    new_enrollment_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "Promotion refused",
      existingId: result.existing_id,
    };
  }

  return { ok: true, newEnrollmentId: result.new_enrollment_id! };
}
