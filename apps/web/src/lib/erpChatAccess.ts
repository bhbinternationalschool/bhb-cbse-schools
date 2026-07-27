/**
 * Role / class / household authorization for ERP chat.
 * Teachers are scoped by class-teacher + subject-teaching duties for the AY.
 */

import type { MastersState } from "@/lib/masters";
import { listSectionParentContacts } from "@/lib/homework";
import { resolveParentHousehold } from "@/lib/parentPortal";
import {
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
  type SessionLike,
} from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import {
  loadSis,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import type { StaffRecord } from "@/lib/foundationMasters";

export type ChatActorKind = "staff" | "parent";

export type ChatActor = {
  kind: ChatActorKind;
  /** staffId or householdId (prefixed for parents: hh_<id> stored as household id) */
  key: string;
  displayName: string;
  staffId?: string;
  householdId?: string;
  roleCodes: string[];
};

export type ChatSectionRef = {
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  label: string;
};

export type ChatParentContact = {
  householdId: string;
  guardianName: string;
  mobile: string;
  childNames: string[];
  classLabels: string[];
  sectionIds: string[];
};

const OFFICE_ROLES = new Set(["owner", "principal", "admin", "office"]);

export function isOfficeLike(roleCodes: string[]): boolean {
  return roleCodes.some((c) => OFFICE_ROLES.has(c));
}

export function isTeacherOnly(roleCodes: string[]): boolean {
  return roleCodes.includes("teacher") && !isOfficeLike(roleCodes);
}

export function parentActorKey(householdId: string): string {
  return `hh:${householdId}`;
}

export function parseParentActorKey(key: string): string | null {
  if (key.startsWith("hh:")) return key.slice(3);
  return null;
}

export function staffActorKey(staffId: string): string {
  return staffId;
}

export function resolveChatActor(
  session: SessionLike & { householdId?: string; academicYearCode?: string },
  masters: MastersState,
  sis?: SisState,
): ChatActor | null {
  const persona = (session.persona || "staff").toLowerCase();
  const roleCodes = inferRoleCodes(session, masters);

  if (persona === "parent" || roleCodes.includes("parent")) {
    const hh =
      resolveSessionHousehold(session, sis) ||
      resolveParentHousehold(sis, { guardianName: session.fullName });
    if (!hh) return null;
    return {
      kind: "parent",
      key: parentActorKey(hh.id),
      displayName: hh.guardianName || session.fullName || "Parent",
      householdId: hh.id,
      roleCodes: ["parent"],
    };
  }

  const staff = resolveSessionStaff(session, masters);
  const staffId =
    staff?.id ||
    session.staffId ||
    `sess_${(session.email || session.fullName || "staff")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 24)}`;

  return {
    kind: "staff",
    key: staffActorKey(staffId),
    displayName: staff?.fullName || session.fullName || "Staff",
    staffId,
    roleCodes,
  };
}

export function resolveSessionHousehold(
  session: SessionLike & { householdId?: string },
  sis?: SisState,
): Household | null {
  const s = sis ?? loadSis();
  if (session.householdId) {
    return s.households.find((h) => h.id === session.householdId) ?? null;
  }
  return null;
}

/** Sections the staff member may chat about / announce to. */
export function staffAllowedSections(
  staff: StaffRecord | null | undefined,
  masters: MastersState,
  academicYearCode: string,
  roleCodes: string[],
): ChatSectionRef[] {
  if (isOfficeLike(roleCodes)) {
    return allActiveSections(masters);
  }
  if (!staff) return [];

  const sectionIds = new Set<string>();

  for (const link of staff.classTeacherLinks ?? []) {
    if (
      link.academicYearCode &&
      link.academicYearCode !== academicYearCode
    ) {
      continue;
    }
    if (link.sectionId) sectionIds.add(link.sectionId);
  }

  for (const link of staff.subjectTeachingLinks ?? []) {
    if (
      link.academicYearCode &&
      link.academicYearCode !== academicYearCode
    ) {
      continue;
    }
    if (link.sectionId) {
      sectionIds.add(link.sectionId);
    } else if (link.classId) {
      for (const sec of masters.sections ?? []) {
        if (sec.classId === link.classId && sec.isActive !== false) {
          sectionIds.add(sec.id);
        }
      }
    }
  }

  return [...sectionIds]
    .map((sectionId) => sectionRef(masters, sectionId))
    .filter((x): x is ChatSectionRef => !!x)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function allActiveSections(masters: MastersState): ChatSectionRef[] {
  return (masters.sections ?? [])
    .filter((s) => s.isActive !== false)
    .map((s) => sectionRef(masters, s.id))
    .filter((x): x is ChatSectionRef => !!x)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function sectionRef(
  masters: MastersState,
  sectionId: string,
): ChatSectionRef | null {
  const sec = (masters.sections ?? []).find((s) => s.id === sectionId);
  if (!sec) return null;
  const cls = (masters.classes ?? []).find((c) => c.id === sec.classId);
  const className = cls?.name || "";
  const sectionName = sec.name || "";
  return {
    classId: sec.classId,
    sectionId: sec.id,
    className,
    sectionName,
    label: sectionName ? `${className}-${sectionName}` : className || sectionId,
  };
}

export function staffAllowedParentContacts(
  actor: ChatActor,
  masters: MastersState,
  academicYearCode: string,
  sis?: SisState,
): ChatParentContact[] {
  if (actor.kind !== "staff") return [];
  const roleCodes = actor.roleCodes;
  if (
    roleCodes.includes("accounts") ||
    roleCodes.includes("transport") ||
    roleCodes.includes("driver")
  ) {
    if (!isOfficeLike(roleCodes)) return [];
  }

  const staff = (masters.staff ?? []).find((s) => s.id === actor.staffId);
  const sections = staffAllowedSections(
    staff,
    masters,
    academicYearCode,
    roleCodes,
  );
  if (!sections.length && !isOfficeLike(roleCodes)) return [];

  const byHh = new Map<string, ChatParentContact>();
  const state = sis ?? loadSis();

  for (const sec of sections) {
    const contacts = listSectionParentContacts(sec.sectionId, academicYearCode, state);
    for (const c of contacts) {
      if (!c.householdId) continue;
      const existing = byHh.get(c.householdId);
      if (existing) {
        for (const n of c.childNames) {
          if (!existing.childNames.includes(n)) existing.childNames.push(n);
        }
        if (!existing.classLabels.includes(sec.label)) {
          existing.classLabels.push(sec.label);
        }
        if (!existing.sectionIds.includes(sec.sectionId)) {
          existing.sectionIds.push(sec.sectionId);
        }
      } else {
        byHh.set(c.householdId, {
          householdId: c.householdId,
          guardianName: c.guardianName,
          mobile: c.mobile,
          childNames: [...c.childNames],
          classLabels: [sec.label],
          sectionIds: [sec.sectionId],
        });
      }
    }
  }

  return [...byHh.values()].sort((a, b) =>
    a.guardianName.localeCompare(b.guardianName),
  );
}

export function parentAllowedTeachers(
  householdId: string,
  masters: MastersState,
  academicYearCode: string,
  sis?: SisState,
): StaffRecord[] {
  const state = sis ?? loadSis();
  const children = state.students.filter(
    (st) =>
      st.householdId === householdId &&
      st.status === "active" &&
      (!st.academicYearCode || st.academicYearCode === academicYearCode),
  );
  const staffIds = new Set<string>();

  for (const child of children) {
    for (const s of masters.staff ?? []) {
      if (s.status !== "active") continue;
      const ct = (s.classTeacherLinks ?? []).some(
        (l) =>
          l.classId === child.classId &&
          l.sectionId === child.sectionId &&
          (!l.academicYearCode || l.academicYearCode === academicYearCode),
      );
      const st = (s.subjectTeachingLinks ?? []).some((l) => {
        if (l.classId !== child.classId) return false;
        if (l.academicYearCode && l.academicYearCode !== academicYearCode) {
          return false;
        }
        if (l.sectionId && l.sectionId !== child.sectionId) return false;
        return true;
      });
      if (ct || st) staffIds.add(s.id);
    }
  }

  return (masters.staff ?? [])
    .filter((s) => staffIds.has(s.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function parentChildren(
  householdId: string,
  academicYearCode: string,
  sis?: SisState,
): SisStudent[] {
  const state = sis ?? loadSis();
  return state.students.filter(
    (st) =>
      st.householdId === householdId &&
      st.status === "active" &&
      (!st.academicYearCode || st.academicYearCode === academicYearCode),
  );
}

export function canStaffChatWithParent(
  actor: ChatActor,
  householdId: string,
  masters: MastersState,
  academicYearCode: string,
  sis?: SisState,
): boolean {
  if (actor.kind !== "staff") return false;
  return staffAllowedParentContacts(
    actor,
    masters,
    academicYearCode,
    sis,
  ).some((p) => p.householdId === householdId);
}

export function canParentChatWithStaff(
  householdId: string,
  staffId: string,
  masters: MastersState,
  academicYearCode: string,
  sis?: SisState,
): boolean {
  return parentAllowedTeachers(
    householdId,
    masters,
    academicYearCode,
    sis,
  ).some((t) => t.id === staffId);
}

export function canCreateClassAnnouncement(
  actor: ChatActor,
  sectionId: string,
  masters: MastersState,
  academicYearCode: string,
): boolean {
  if (actor.kind !== "staff") return false;
  const staff = (masters.staff ?? []).find((s) => s.id === actor.staffId);
  return staffAllowedSections(
    staff,
    masters,
    academicYearCode,
    actor.roleCodes,
  ).some((s) => s.sectionId === sectionId);
}

export function canCreateStaffGroup(actor: ChatActor): boolean {
  return actor.kind === "staff";
}

export function sessionRoleCodes(
  session: SessionLike,
  masters: MastersState,
): string[] {
  const rbac = loadRbac();
  const roles = resolveSessionRoles(rbac, session, masters);
  if (roles.length) return roles.map((r) => r.code);
  return inferRoleCodes(session, masters);
}
