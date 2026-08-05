import {
  type Designation,
  type StaffRecord,
  type StaffVehicleLink,
  type StaffVehicleRole,
} from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";

export function resolveClassTeachers(
  masters: MastersState,
  classId: string,
  sectionId: string,
  academicYearCode: string,
): StaffRecord[] {
  if (!classId || !sectionId) return [];
  const hits: { staff: StaffRecord; primary: boolean }[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    for (const link of s.classTeacherLinks ?? []) {
      if (
        link.classId === classId &&
        link.sectionId === sectionId &&
        (!link.academicYearCode ||
          link.academicYearCode === academicYearCode)
      ) {
        hits.push({ staff: s, primary: link.isPrimary });
      }
    }
  }
  hits.sort((a, b) => Number(b.primary) - Number(a.primary));
  return hits.map((h) => h.staff);
}

export function resolveClassTeacherName(
  masters: MastersState,
  classId: string,
  sectionId: string,
  academicYearCode: string,
): string {
  const list = resolveClassTeachers(
    masters,
    classId,
    sectionId,
    academicYearCode,
  );
  return list[0]?.fullName ?? "";
}

/** Subject teachers linked to a class (optional section + subject filter). */
export function resolveSubjectTeachers(
  masters: MastersState,
  classId: string,
  sectionId: string,
  academicYearCode: string,
  subjectId?: string,
): StaffRecord[] {
  if (!classId) return [];
  const out: StaffRecord[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    const hit = (s.subjectTeachingLinks ?? []).some((l) => {
      if (l.classId !== classId) return false;
      if (
        l.academicYearCode &&
        l.academicYearCode !== academicYearCode
      ) {
        return false;
      }
      if (l.sectionId && sectionId && l.sectionId !== sectionId) return false;
      if (subjectId && l.subjectId !== subjectId) return false;
      return true;
    });
    if (hit) out.push(s);
  }
  return out;
}

export function resolvePrincipal(masters: MastersState): StaffRecord | null {
  const designations = masters.designations ?? [];
  const prinDes = designations.find(
    (d) =>
      d.isActive &&
      (/^PRIN/i.test(d.code) || /principal/i.test(d.name)),
  );
  const active = (masters.staff ?? []).filter((s) => s.status === "active");
  if (prinDes) {
    const hit = active.find((s) => s.designationId === prinDes.id);
    if (hit) return hit;
  }
  return (
    active.find((s) => {
      const des = designations.find((d) => d.id === s.designationId);
      return des ? /principal/i.test(des.name) : false;
    }) ?? null
  );
}

export type StaffRouteAssignment = {
  staff: StaffRecord;
  link: StaffVehicleLink;
  roleLabel: string;
};

const ROLE_LABEL: Record<StaffVehicleRole, string> = {
  driver: "Driver",
  attendant: "Attendant",
  conductor: "Conductor",
  helper: "Helper",
};

export function staffAssignedToRoute(
  masters: MastersState,
  routeId: string,
  asOfDate?: string,
): StaffRouteAssignment[] {
  const today = asOfDate || new Date().toISOString().slice(0, 10);
  const out: StaffRouteAssignment[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    for (const link of s.vehicleLinks ?? []) {
      if (link.routeId !== routeId) continue;
      if (link.effectiveFrom && link.effectiveFrom > today) continue;
      if (link.effectiveTo && link.effectiveTo < today) continue;
      out.push({
        staff: s,
        link,
        roleLabel: ROLE_LABEL[link.role] ?? link.role,
      });
    }
  }
  out.sort((a, b) => a.roleLabel.localeCompare(b.roleLabel));
  return out;
}

export function formatRouteCrew(assignments: StaffRouteAssignment[]): string {
  if (assignments.length === 0) return "";
  return assignments
    .map((a) => `${a.roleLabel}: ${a.staff.fullName}`)
    .join(" · ");
}

export type StaffFieldErrors = Partial<
  Record<
    | "empCode"
    | "fullName"
    | "mobile"
    | "email"
    | "aadhaarNo"
    | "panNo"
    | "bankIfsc"
    | "loginUsername",
    string
  >
>;

export function validateStaffProfile(
  draft: Pick<
    StaffRecord,
    | "empCode"
    | "fullName"
    | "mobile"
    | "email"
    | "aadhaarNo"
    | "panNo"
    | "bankIfsc"
    | "loginUsername"
    | "loginEnabled"
  >,
): StaffFieldErrors {
  const errors: StaffFieldErrors = {};
  if (!draft.empCode.trim()) errors.empCode = "Employee code is required";
  if (!draft.fullName.trim()) errors.fullName = "Full name is required";
  const mobile = draft.mobile.replace(/\D/g, "");
  if (draft.mobile.trim() && mobile.length !== 10) {
    errors.mobile = "Mobile must be 10 digits";
  }
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) {
    errors.email = "Invalid email";
  }
  const aadhaar = draft.aadhaarNo.replace(/\D/g, "");
  if (draft.aadhaarNo.trim() && aadhaar.length !== 12) {
    errors.aadhaarNo = "Aadhaar must be 12 digits";
  }
  const pan = draft.panNo.trim().toUpperCase();
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    errors.panNo = "PAN format: AAAAA9999A";
  }
  const ifsc = draft.bankIfsc.trim().toUpperCase();
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    errors.bankIfsc = "IFSC format: ABCD0XXXXXX";
  }
  if (draft.loginEnabled && !draft.loginUsername.trim()) {
    errors.loginUsername = "Username required when login is enabled";
  }
  return errors;
}

export function designationName(
  masters: MastersState,
  designationId: string | null,
): string {
  if (!designationId) return "";
  return (
    masters.designations.find((d: Designation) => d.id === designationId)
      ?.name ?? ""
  );
}

export type StaffRemovalCheck = {
  canRemove: boolean;
  blockers: string[];
  suggestion: string;
  confirmMessage: string;
};

export function checkStaffRemoval(
  state: MastersState,
  staffId: string,
): StaffRemovalCheck {
  const staff = state.staff.find((s) => s.id === staffId);
  if (!staff) {
    return {
      canRemove: false,
      blockers: ["Staff not found"],
      suggestion: "Refresh and try again",
      confirmMessage: "Remove staff?",
    };
  }
  const confirmMessage = `Remove “${staff.fullName}” (${staff.empCode})?`;
  const blockers: string[] = [];
  if (staff.classTeacherLinks.length > 0) {
    blockers.push(
      `${staff.classTeacherLinks.length} class-teacher link(s)`,
    );
  }
  if (staff.subjectTeachingLinks.length > 0) {
    blockers.push(
      `${staff.subjectTeachingLinks.length} subject teaching link(s)`,
    );
  }
  if (staff.vehicleLinks.length > 0) {
    blockers.push(`${staff.vehicleLinks.length} vehicle link(s)`);
  }
  if (staff.dutyLinks.length > 0) {
    blockers.push(`${staff.dutyLinks.length} duty link(s)`);
  }
  if (staff.status === "active") {
    blockers.push("active status");
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion:
        staff.status === "active"
          ? "Inactivate first. Clear duty mappings before permanent remove."
          : "Clear duty mappings first, or keep as Inactive for HR audit",
      confirmMessage,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "Prefer keeping inactive on record for audit. Removal cannot be undone.",
    confirmMessage,
  };
}

export function removeStaff(
  state: MastersState,
  staffId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkStaffRemoval(state, staffId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      staff: state.staff.filter((s) => s.id !== staffId),
    },
  };
}

export function matchStaffLogin(
  masters: MastersState,
  identifier: string,
  password: string,
): StaffRecord | null {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  const hit = (masters.staff ?? []).find((s) => {
    if (s.status !== "active" || !s.loginEnabled) return false;
    const user = s.loginUsername.trim().toLowerCase();
    const email = s.email.trim().toLowerCase();
    const code = s.empCode.trim().toLowerCase();
    return user === id || email === id || code === id;
  });
  if (!hit) return null;
  // Empty password in demo = accept any non-empty secret, or empty both
  if (!hit.loginPassword) {
    return password.length >= 0 ? hit : null;
  }
  return hit.loginPassword === password ? hit : null;
}

/** Resolve the logged-in staff row from session (staffId / email / name). */
export function resolveSessionStaff(
  session: {
    staffId?: string;
    email?: string;
    fullName: string;
  },
  masters: MastersState,
): StaffRecord | null {
  const roster = masters.staff ?? [];
  if (session.staffId) {
    const byId = roster.find((s) => s.id === session.staffId);
    if (byId) return byId;
  }
  const email = (session.email || "").trim().toLowerCase();
  if (email) {
    const byEmail = roster.find((s) => {
      const e = s.email.trim().toLowerCase();
      const u = s.loginUsername.trim().toLowerCase();
      const c = s.empCode.trim().toLowerCase();
      return e === email || u === email || c === email;
    });
    if (byEmail) return byEmail;
  }
  const name = session.fullName.trim().toLowerCase();
  if (!name) return null;
  return (
    roster.find((s) => s.fullName.trim().toLowerCase() === name) ?? null
  );
}

/** Class–section rows where this session's staff is class teacher (current AY). */
export function listSessionClassTeacherSections(
  session: {
    staffId?: string;
    email?: string;
    fullName: string;
  },
  masters: MastersState,
  academicYearCode: string,
): { classId: string; sectionId: string; label: string }[] {
  const staff = resolveSessionStaff(session, masters);
  if (!staff) return [];
  const out: { classId: string; sectionId: string; label: string }[] = [];
  for (const link of staff.classTeacherLinks ?? []) {
    if (link.academicYearCode && link.academicYearCode !== academicYearCode) {
      continue;
    }
    const cls = masters.classes.find((c) => c.id === link.classId);
    const sec = masters.sections.find((s) => s.id === link.sectionId);
    if (!cls || !sec) continue;
    out.push({
      classId: link.classId,
      sectionId: link.sectionId,
      label: `${cls.name || "Class"} · ${sec.name || ""}`.trim(),
    });
  }
  return out;
}

/**
 * Principal / admin / office can manage, direct, and adjust leave.
 * Regular staff may only request their own leave.
 * Prefer RBAC `staff.edit` / `policies.edit`; legacy regex remains as fallback.
 */
export function canManageStaffLeave(
  session: { roleCode: string; staffId?: string; email?: string; fullName: string },
  masters: MastersState,
): boolean {
  if (
    hasPermission(session, masters, "staff", "edit") ||
    hasPermission(session, masters, "policies", "edit")
  ) {
    return true;
  }
  const rc = (session.roleCode || "").toLowerCase();
  if (
    /principal|admin|accounts|office|hm|head.?master|vice.?principal|registrar/.test(
      rc,
    )
  ) {
    return true;
  }
  const self = resolveSessionStaff(session, masters);
  if (!self) return false;
  const des = masters.designations.find((d) => d.id === self.designationId);
  const blob = `${des?.code || ""} ${des?.name || ""}`.toLowerCase();
  return /prin|principal|admin|hm|head.?master|vice.?principal/.test(blob);
}

/**
 * Salary setup + payroll prepare — driven by RBAC `payroll.create` / `edit`.
 * Accounts are denied by default template (§6i.4).
 */
export function canManagePayroll(
  session: {
    roleCode: string;
    staffId?: string;
    email?: string;
    fullName: string;
    persona?: string;
  },
  masters: MastersState,
): boolean {
  return (
    hasPermission(session, masters, "payroll", "edit") ||
    hasPermission(session, masters, "payroll", "create")
  );
}

/** Issue / edit staff advances without full payroll desk access. */
export function canManageStaffAdvances(
  session: {
    roleCode: string;
    staffId?: string;
    email?: string;
    fullName: string;
    persona?: string;
  },
  masters: MastersState,
): boolean {
  if (canManagePayroll(session, masters)) return true;
  return (
    hasPermission(session, masters, "staff_advances", "edit") ||
    hasPermission(session, masters, "staff_advances", "create")
  );
}

export function canViewStaffAdvancesDesk(
  session: {
    roleCode: string;
    staffId?: string;
    email?: string;
    fullName: string;
    persona?: string;
  },
  masters: MastersState,
): boolean {
  if (canManageStaffAdvances(session, masters)) return true;
  return (
    hasPermission(session, masters, "staff_advances", "view") ||
    hasPermission(session, masters, "payroll", "view")
  );
}

/**
 * Principal / Admin / HM / Owner — approve payroll & increments (RBAC `payroll.approve`).
 */
export function canApprovePayroll(
  session: {
    roleCode: string;
    staffId?: string;
    email?: string;
    fullName: string;
    persona?: string;
  },
  masters: MastersState,
): boolean {
  return hasPermission(session, masters, "payroll", "approve");
}
