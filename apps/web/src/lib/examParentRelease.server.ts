import "server-only";

import {
  EXAM_PARENT_RELEASE_KEY,
  normalizeExamParentRelease,
  type ExamParentReleaseState,
} from "@/lib/examParentRelease";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * The parent-release switches — one module_local_state row, written only
 * through /api/v1/staff/exams/parent-release.
 *
 * null = the read failed: unknown. Every parent route treats that as
 * "nothing released" and says it could not check, never as an empty list
 * that happens to look like "released nothing" while hiding a fault.
 */
export async function readExamParentRelease(): Promise<
  { state: ExamParentReleaseState; updatedAt: string } | null
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", EXAM_PARENT_RELEASE_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[exam-parent-release] read failed", error.message);
    return null;
  }
  return {
    state: normalizeExamParentRelease(data?.state),
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  };
}

/**
 * Saved only over the copy the caller read (`baseUpdatedAt`; "" = no row
 * yet): two office tabs switching different exams at once must not drop
 * each other's switch.
 */
export async function writeExamParentRelease(
  state: ExamParentReleaseState,
  baseUpdatedAt: string,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string; conflict?: boolean }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  if (baseUpdatedAt) {
    const { data, error } = await ctx.sb
      .from("module_local_state")
      .update({ state, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("module_key", EXAM_PARENT_RELEASE_KEY)
      .eq("updated_at", baseUpdatedAt)
      .select("updated_at");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: false, conflict: true, error: "Someone else changed the release switches meanwhile — try again." };
    }
    return { ok: true, updatedAt: now };
  }
  const { error } = await ctx.sb
    .from("module_local_state")
    .insert({ tenant_id: ctx.tenantId, module_key: EXAM_PARENT_RELEASE_KEY, state, updated_at: now });
  if (error) {
    return /duplicate|unique/i.test(error.message)
      ? { ok: false, conflict: true, error: "Someone else changed the release switches meanwhile — try again." }
      : { ok: false, error: error.message };
  }
  return { ok: true, updatedAt: now };
}
