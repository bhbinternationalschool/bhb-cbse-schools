/**
 * Resolve WhatsApp sender identity against school roster, SIS, admissions, survey team.
 */

import { loadAccounts } from "@/lib/accountsStore";
import { findAdmissionLeadByMobile, loadAdmissions } from "@/lib/admissions";
import { findSurveyMemberForSession } from "@/lib/fieldSurvey";
import type { StaffRecord } from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import { loadSis, type Household } from "@/lib/sis";
import { loadTransport } from "@/lib/transport";
import { waNormalizeLocal10 } from "@/lib/waSend";

function findHouseholdByWaMobile(mobile10: string): Household | null {
  const sis = loadSis();
  const m = mobile10.replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  const byHh = sis.households.find(
    (h) => h.whatsappMobile === m || h.mobile === m || h.altMobile === m,
  );
  if (byHh) return byHh;
  const st = sis.students.find(
    (s) => s.fatherMobile === m || s.motherMobile === m,
  );
  if (!st?.householdId) return null;
  return sis.households.find((h) => h.id === st.householdId) || null;
}

export type WaRoleKind =
  | "owner"
  | "staff"
  | "teacher"
  | "parent"
  | "survey"
  | "admission_lead"
  | "vendor"
  | "transport";

export type WaResolvedRole = {
  kind: WaRoleKind;
  label: string;
  pickKeyword: string;
  staff?: StaffRecord;
  householdId?: string;
  leadId?: string;
};

export type WaResolvedIdentity = {
  mobile10: string;
  displayName: string;
  isKnown: boolean;
  roles: WaResolvedRole[];
};

function staffMobile10(s: StaffRecord): string {
  return waNormalizeLocal10(s.mobile || s.altMobile || "");
}

export function findStaffByMobile(
  masters: MastersState,
  mobile10: string,
): StaffRecord | null {
  if (mobile10.length !== 10) return null;
  return (
    (masters.staff ?? []).find((s) => {
      if (s.status !== "active") return false;
      const m = staffMobile10(s);
      const alt = waNormalizeLocal10(s.altMobile || "");
      return m === mobile10 || (alt.length === 10 && alt === mobile10);
    }) || null
  );
}

function isTeachingStaff(staff: StaffRecord): boolean {
  return (
    (staff.classTeacherLinks ?? []).length > 0 ||
    (staff.subjectTeachingLinks ?? []).length > 0
  );
}

function inferStaffIsOwner(staff: StaffRecord, masters: MastersState): boolean {
  if (isProtectedSuperAdminEmail(staff.email)) return true;
  const des = masters.designations.find((d) => d.id === staff.designationId);
  const blob = `${des?.code || ""} ${des?.name || ""} ${staff.fullName}`.toLowerCase();
  return /owner|trustee|director|principal|founder|chairman/.test(blob);
}

function inferStaffIsOffice(staff: StaffRecord, masters: MastersState): boolean {
  const des = masters.designations.find((d) => d.id === staff.designationId);
  const blob = `${des?.code || ""} ${des?.name || ""}`.toLowerCase();
  return /admin|office|registrar|clerk|accounts|hr|coordinator/.test(blob);
}

/** Build role list for a WhatsApp mobile (10-digit). */
export function resolveWaIdentity(fromWaId: string): WaResolvedIdentity {
  const mobile10 = waNormalizeLocal10(fromWaId);
  const empty: WaResolvedIdentity = {
    mobile10,
    displayName: "",
    isKnown: false,
    roles: [],
  };
  if (mobile10.length !== 10) return empty;

  const masters = loadMasters();
  const roles: WaResolvedRole[] = [];
  let displayName = "";

  const staff = findStaffByMobile(masters, mobile10);
  if (staff) {
    displayName = staff.fullName;
    if (inferStaffIsOwner(staff, masters)) {
      roles.push({
        kind: "owner",
        label: "Director / Leadership",
        pickKeyword: "DIRECTOR",
        staff,
      });
    } else if (inferStaffIsOffice(staff, masters) || !isTeachingStaff(staff)) {
      roles.push({
        kind: "staff",
        label: "Staff / Office",
        pickKeyword: "STAFF",
        staff,
      });
    }
    if (isTeachingStaff(staff)) {
      roles.push({
        kind: "teacher",
        label: "Class teacher",
        pickKeyword: "TEACHER",
        staff,
      });
    }
  }

  const hh = findHouseholdByWaMobile(mobile10);
  if (hh) {
    displayName = displayName || hh.guardianName || "";
    roles.push({
      kind: "parent",
      label: "Enrolled parent (SIS)",
      pickKeyword: "PARENT",
      householdId: hh.id,
    });
  }

  try {
    const adm = loadAdmissions();
    const survey = findSurveyMemberForSession(adm, { mobile: mobile10 });
    if (survey?.assigned) {
      displayName = displayName || survey.fullName || "";
      roles.push({
        kind: "survey",
        label: "Field survey team",
        pickKeyword: "SURVEY",
      });
    }
    const lead = findAdmissionLeadByMobile(adm, mobile10);
    if (lead) {
      displayName = displayName || lead.guardianName || lead.childName || "";
      roles.push({
        kind: "admission_lead",
        label: "Admission enquiry",
        pickKeyword: "ADMISSION",
        leadId: lead.id,
      });
    }
  } catch {
    /* admissions mirror optional */
  }

  try {
    const accounts = loadAccounts();
    const vendor = (accounts.vendors ?? []).find((v) => {
      const p = waNormalizeLocal10(v.phone || "");
      return p === mobile10 && v.isActive !== false;
    });
    if (vendor) {
      displayName = displayName || vendor.name || "";
      roles.push({
        kind: "vendor",
        label: `Vendor · ${vendor.name}`,
        pickKeyword: "VENDOR",
      });
    }
  } catch {
    /* accounts optional */
  }

  try {
    const transport = loadTransport();
    const vehicle = transport.vehicles.find((v) => {
      const dm = waNormalizeLocal10(v.driverMobile || "");
      return dm === mobile10 && v.isActive;
    });
    if (vehicle) {
      displayName = displayName || vehicle.driverName || vehicle.name;
      roles.push({
        kind: "transport",
        label: `Driver · ${vehicle.registrationNo}`,
        pickKeyword: "TRANSPORT",
      });
    }
  } catch {
    /* transport optional */
  }

  const deduped = roles.filter(
    (r, i, arr) => arr.findIndex((x) => x.kind === r.kind) === i,
  );

  return {
    mobile10,
    displayName,
    isKnown: deduped.length > 0,
    roles: deduped,
  };
}

export function pickRoleByInput(
  roles: WaResolvedRole[],
  text: string,
): WaResolvedRole | null {
  const t = (text || "").trim();
  if (!t || !roles.length) return null;
  const upper = t.toUpperCase();
  const byKeyword = roles.find(
    (r) =>
      upper === r.pickKeyword ||
      upper.startsWith(`${r.pickKeyword} `) ||
      upper.includes(r.pickKeyword),
  );
  if (byKeyword) return byKeyword;
  const num = parseInt(t.replace(/\D/g, ""), 10);
  if (num >= 1 && num <= roles.length) return roles[num - 1];
  const low = t.toLowerCase();
  if (/director|owner|leadership/.test(low)) {
    return roles.find((r) => r.kind === "owner") || null;
  }
  if (/staff|office|employee/.test(low)) {
    return roles.find((r) => r.kind === "staff") || null;
  }
  if (/teacher|class|hw|homework/.test(low)) {
    return roles.find((r) => r.kind === "teacher") || null;
  }
  if (/parent|fee|dues|kid|child/.test(low)) {
    return roles.find((r) => r.kind === "parent") || null;
  }
  if (/survey|field|capture/.test(low)) {
    return roles.find((r) => r.kind === "survey") || null;
  }
  if (/vendor|supplier|purchase/.test(low)) {
    return roles.find((r) => r.kind === "vendor") || null;
  }
  if (/transport|driver|bus|route/.test(low)) {
    return roles.find((r) => r.kind === "transport") || null;
  }
  if (/admission|enquiry|register/.test(low)) {
    return roles.find((r) => r.kind === "admission_lead") || null;
  }
  return null;
}
