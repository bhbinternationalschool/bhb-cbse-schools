import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { normalizeUdiseSchoolAnswers, UDISE_SCHOOL_ANSWERS_KEY } from "@/lib/udiseSchoolAnswers";
import {
  erpSchoolFacts,
  normalizeProfileStore,
  UDISE_SCHOOL_PROFILE_KEY,
  withCapture,
  type ErpSchoolFacts,
  type SchoolProfileStore,
  type SectionCapture,
} from "@/lib/udiseSchoolProfile";

/**
 * The UDISE+ School Profile captures — one module_local_state row, written
 * only through /api/v1/udise/robot/school-profile. Patterned on
 * udiseSchoolAnswers.server.ts: direct read/upsert, server truth, no browser
 * copy (deliberately NOT in moduleStateRegistry, so no desk can push it).
 * null = the read failed: unknown, never "nothing captured".
 */
export async function readSchoolProfileStore(): Promise<{ store: SchoolProfileStore; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", UDISE_SCHOOL_PROFILE_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[udise-school-profile] read failed", error.message);
    return null;
  }
  return { store: normalizeProfileStore(data?.state), updatedAt: data?.updated_at ? String(data.updated_at) : "" };
}

/**
 * Store one section's snapshot for one year. Read-modify-write: a failed
 * read refuses the write, because writing over an unread row would erase
 * every earlier year's capture.
 */
export async function saveSchoolProfileSection(
  academicYear: string,
  sectionKey: string,
  capture: SectionCapture,
): Promise<{ ok: true; store: SchoolProfileStore; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const got = await readSchoolProfileStore();
  if (!got) return { ok: false, error: "Could not read the stored school profile — nothing saved. Try again." };
  const store = withCapture(got.store, academicYear, sectionKey, capture);
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: UDISE_SCHOOL_PROFILE_KEY, state: store, updated_at: now },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, store, updatedAt: now };
}

/**
 * What the ERP truly knows about the school, from the STORED Masters slices
 * (masters_desk_slices — what loadServerMasters reads; the row-table copy in
 * masters_desk_settings is written by the same save). Not loadServerMasters:
 * on a failed read it returns defaultMasters(), whose profile is TENANT
 * constants — that would turn "unknown" into "the ERP says".
 * null = the read failed.
 */
export async function readErpSchoolFacts(academicYear: string): Promise<ErpSchoolFacts | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const [slices, staff, designations, answers] = await Promise.all([
    ctx.sb
      .from("masters_desk_slices")
      .select("slice_key, payload")
      .eq("tenant_id", ctx.tenantId)
      .in("slice_key", ["schoolProfile", "classes", "academicYears"]),
    ctx.sb.from("sis_staff").select("*").eq("tenant_id", ctx.tenantId),
    ctx.sb.from("sis_designations").select("*").eq("tenant_id", ctx.tenantId),
    ctx.sb
      .from("module_local_state")
      .select("state")
      .eq("tenant_id", ctx.tenantId)
      .eq("module_key", UDISE_SCHOOL_ANSWERS_KEY)
      .maybeSingle(),
  ]);
  if (slices.error) {
    console.warn("[udise-school-profile] masters read failed", slices.error.message);
    return null;
  }
  const by = Object.fromEntries((slices.data ?? []).map((r) => [String(r.slice_key), r.payload as unknown]));
  return erpSchoolFacts({
    profile: by.schoolProfile,
    classes: by.classes,
    academicYears: by.academicYears,
    academicYear,
    principalName: staff.error || designations.error ? "" : onePrincipal(staff.data ?? [], designations.data ?? []),
    mediumEnglishConfirmed: answers.error ? false : !!normalizeUdiseSchoolAnswers(answers.data?.state).answers.mediumEnglish,
  });
}

/**
 * The principal, when exactly one active staff member holds a Principal
 * designation (not Vice) — the rule aadhaarCertificate.server.ts uses. Two
 * or none → "" (the office types it).
 */
function onePrincipal(staff: Record<string, unknown>[], designations: Record<string, unknown>[]): string {
  const ids = new Set(
    designations
      .filter((d) => /principal/i.test(String(d.name ?? "")) && !/vice/i.test(String(d.name ?? "")))
      .map((d) => String(d.id)),
  );
  const heads = staff.filter(
    // Same reading as staffPersistence: anything but "inactive" is active.
    (s) => s.status !== "inactive" && ids.has(String(s.designation_id ?? s.designationId ?? "")),
  );
  return heads.length === 1 ? String(heads[0]!.full_name ?? heads[0]!.fullName ?? "").trim() : "";
}
