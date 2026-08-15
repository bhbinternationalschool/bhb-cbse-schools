/**
 * WhatsApp identity resolution with a database fallback.
 *
 * resolveWaIdentity() answers off the in-memory school mirror. Its staff
 * slice exists only because hydrateSchoolMirrorFromRemote() pulled
 * sis_staff into it (the school_mirror_state blob carries no staff at
 * all — stripStaffFromMastersForBlob strips it), and its sis slice the
 * same way from sis_households / sis_students. That pull is cached for
 * 45s, is skipped entirely while the mirror looks non-empty, and returns
 * nothing — silently, for the whole roster — if the tenant lookup or any
 * one of its table reads fails. Every one of those states makes a real,
 * active staff member or enrolled parent look like a stranger, and the
 * bot then tells them "your number is not on file yet".
 *
 * A cache miss is not evidence that a number is unknown. Before saying
 * so, ask the roster directly — per dimension, so a number the mirror
 * knows only as (say) an admission enquiry still gets its staff and
 * parent records checked.
 */

import type { Designation, StaffRecord } from "@/lib/foundationMasters";
import { normalizeStaffRecord } from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import { setMirrorSlice } from "@/lib/schoolDataMirror";
import type { Household, SisStudent } from "@/lib/sis";
import { waNormalizeLocal10 } from "@/lib/waSend";
import {
  resolveWaIdentity,
  staffRolesFor,
  type WaResolvedIdentity,
  type WaResolvedRole,
  type WaRoleKind,
} from "@/lib/waRoleResolver";

type StaffRow = {
  id: string;
  emp_code: string | null;
  full_name: string | null;
  stream: string | null;
  category: string | null;
  department_id: string | null;
  designation_id: string | null;
  campus_id: string | null;
  mobile: string | null;
  email: string | null;
  status: string | null;
  profile: unknown;
};

function rowToStaff(row: StaffRow): StaffRecord {
  const profile =
    row.profile && typeof row.profile === "object"
      ? (row.profile as Partial<StaffRecord>)
      : {};
  return normalizeStaffRecord({
    ...profile,
    id: row.id,
    empCode: row.emp_code ?? profile.empCode ?? "",
    fullName: row.full_name ?? profile.fullName ?? "",
    stream: (row.stream as StaffRecord["stream"]) || profile.stream || "teaching",
    category:
      (row.category as StaffRecord["category"]) || profile.category || "permanent",
    departmentId: row.department_id ?? profile.departmentId ?? null,
    designationId: row.designation_id ?? profile.designationId ?? null,
    campusId: row.campus_id || profile.campusId || null,
    mobile: row.mobile ?? profile.mobile ?? "",
    email: row.email ?? profile.email ?? "",
    status: row.status === "inactive" ? "inactive" : "active",
  });
}

/**
 * The active staff row this mobile belongs to, straight from sis_staff.
 * Matches the mirror-side rule in findStaffByMobile: primary mobile or
 * altMobile, either of which may be stored with a country code or
 * spacing, so the comparison happens on the normalized 10 digits.
 */
async function fetchStaffByMobileFromDb(
  mobile10: string,
): Promise<{ staff: StaffRecord; designations: Designation[] } | null> {
  const { getServerTenantContext } = await import("@/lib/serverTenant");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    console.warn("[waIdentity] no tenant context — cannot verify roster");
    return null;
  }
  const { sb, tenantId } = ctx;

  const { data, error } = await sb
    .from("sis_staff")
    .select(
      "id, emp_code, full_name, stream, category, department_id, designation_id, campus_id, mobile, email, status, profile",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (error) {
    console.warn("[waIdentity] staff lookup failed", error.message);
    return null;
  }

  const match = ((data ?? []) as StaffRow[])
    .map(rowToStaff)
    .find((s) => {
      const m = waNormalizeLocal10(s.mobile || "");
      const alt = waNormalizeLocal10(s.altMobile || "");
      return m === mobile10 || (alt.length === 10 && alt === mobile10);
    });
  if (!match) return null;

  const { data: desRows, error: desErr } = await sb
    .from("sis_designations")
    .select("id, code, name, department_id, is_active")
    .eq("tenant_id", tenantId);
  if (desErr) {
    console.warn("[waIdentity] designation lookup failed", desErr.message);
  }
  const designations: Designation[] = (
    (desRows ?? []) as {
      id: string;
      code: string | null;
      name: string | null;
      department_id: string | null;
      is_active: boolean | null;
    }[]
  ).map((d) => ({
    id: d.id,
    code: d.code ?? "",
    name: d.name ?? "",
    departmentId: d.department_id,
    isActive: d.is_active !== false,
  }));

  return { staff: match, designations };
}

/**
 * Put the recovered staff row (and the designations that grade it) back
 * into the mirror, so the rest of the inbound — waStaffAttendanceBotServer
 * re-resolves the sender through findStaffByMobile(loadMasters()) — sees
 * the same person this function just identified.
 */
function patchMirrorStaff(staff: StaffRecord, designations: Designation[]) {
  const masters = loadMasters();
  const nextStaff = [
    ...(masters.staff ?? []).filter((s) => s.id !== staff.id),
    staff,
  ];
  const desMap = new Map<string, Designation>();
  for (const d of masters.designations ?? []) desMap.set(d.id, d);
  for (const d of designations) desMap.set(d.id, d);
  const next: MastersState = {
    ...masters,
    staff: nextStaff,
    designations: [...desMap.values()],
  };
  setMirrorSlice("masters", next);
}

const STAFF_ROLE_KINDS = new Set<WaRoleKind>(["owner", "staff", "teacher"]);

/** The order resolveWaIdentity itself produces, so a recovered role lands
 *  where the menu expects it rather than at whichever end we appended. */
const ROLE_ORDER: WaRoleKind[] = [
  "owner",
  "staff",
  "teacher",
  "parent",
  "survey",
  "admission_lead",
  "vendor",
  "transport",
];

function sortRoles(roles: WaResolvedRole[]): WaResolvedRole[] {
  return [...roles].sort(
    (a, b) => ROLE_ORDER.indexOf(a.kind) - ROLE_ORDER.indexOf(b.kind),
  );
}

/**
 * resolveWaIdentity, but each dimension the mirror could not answer is
 * re-checked against the database before the caller acts on the miss.
 *
 * Checked per dimension, not just when the sender is wholly unrecognised:
 * a teacher who once enquired about admission resolves as an admission
 * lead, which would otherwise count as "known" and leave her staff role
 * — and her staff menu — permanently missing. The cost is one narrow read
 * per dimension the mirror already failed on, and none at all for a
 * sender it fully resolved.
 */
export async function resolveWaIdentityServer(
  fromWaId: string,
): Promise<WaResolvedIdentity> {
  const identity = resolveWaIdentity(fromWaId);

  const mobile10 = identity.mobile10;
  if (mobile10.length !== 10) return identity;

  let roles = identity.roles;
  let displayName = identity.displayName;

  if (!roles.some((r) => STAFF_ROLE_KINDS.has(r.kind))) {
    let found: { staff: StaffRecord; designations: Designation[] } | null = null;
    try {
      found = await fetchStaffByMobileFromDb(mobile10);
    } catch (e) {
      console.warn("[waIdentity] staff fallback error", e);
    }
    if (found) {
      const staffRoles = staffRolesFor(found.staff, found.designations);
      if (staffRoles.length > 0) {
        console.warn(
          `[waIdentity] mirror missed active staff ${found.staff.empCode} for ${mobile10} — recovered from sis_staff`,
        );
        patchMirrorStaff(found.staff, found.designations);
        roles = [...staffRoles, ...roles];
        // Staff naming wins over a lead's or vendor's, exactly as it does
        // in resolveWaIdentity.
        displayName = found.staff.fullName || displayName;
      }
    }
  }

  if (!roles.some((r) => r.kind === "parent")) {
    // Shared with the parent OTP routes: same rule, same seeding of the
    // mirror, so a parent the bot recognises is a parent who can sign in
    // — and neither path can drift into recognising a different family.
    let hh: { household: Household; students: SisStudent[] } | null = null;
    try {
      const { resolveHouseholdByMobileServer } = await import(
        "@/lib/parentHousehold.server"
      );
      hh = await resolveHouseholdByMobileServer(mobile10);
    } catch (e) {
      console.warn("[waIdentity] household fallback error", e);
    }
    if (hh) {
      console.warn(
        `[waIdentity] mirror missed household ${hh.household.id} for ${mobile10} — recovered from sis_households`,
      );
      roles = [
        ...roles,
        {
          kind: "parent",
          label: "Enrolled parent (SIS)",
          pickKeyword: "PARENT",
          householdId: hh.household.id,
        },
      ];
      displayName = displayName || hh.household.guardianName || "";
    }
  }

  if (roles === identity.roles) return identity;

  return {
    ...identity,
    displayName,
    isKnown: roles.length > 0,
    roles: sortRoles(roles),
  };
}
