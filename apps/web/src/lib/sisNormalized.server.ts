/**
 * SIS roster — Supabase normalized tables (sis_households / sis_students).
 * Server-only system of record push/pull.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeHousehold,
  normalizeStudent,
  emptyStudentDocs,
  type Household,
  type SisState,
  type SisStudent,
  type StudentDocs,
  type StudentDocKey,
} from "@/lib/sis";
import { sisDualWriteDbEnabled } from "@/lib/sisDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type SisRemoteBundle = {
  households: Household[];
  students: SisStudent[];
  householdUpdatedAt: Record<string, string>;
  studentUpdatedAt: Record<string, string>;
};

export type SisSyncMeta = {
  householdCount: number;
  studentCount: number;
  activeStudentCount: number;
  updatedAt: string;
};

type HouseholdRow = {
  id: string;
  code: string | null;
  guardian_name: string | null;
  mobile: string | null;
  whatsapp_mobile: string | null;
  email: string | null;
  address: string | null;
  locality: string | null;
  landmark: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  alt_mobile: string | null;
  updated_at: string;
};

type StudentRow = {
  id: string;
  admission_no: string | null;
  full_name: string | null;
  gender: string | null;
  dob: string | null;
  status: string | null;
  campus_id: string | null;
  class_id: string | null;
  section_id: string | null;
  roll_no: string | null;
  academic_year_code: string | null;
  student_type: string | null;
  fee_group_id: string | null;
  joined_on: string | null;
  father_name: string | null;
  mother_name: string | null;
  father_mobile: string | null;
  mother_mobile: string | null;
  father_aadhaar_last4: string | null;
  mother_aadhaar_last4: string | null;
  father_pan: string | null;
  mother_pan: string | null;
  guardian_relation: string | null;
  emergency_name: string | null;
  emergency_mobile: string | null;
  household_id: string | null;
  blood_group: string | null;
  religion: string | null;
  category: string | null;
  nationality: string | null;
  mother_tongue: string | null;
  place_of_birth: string | null;
  aadhaar_last4: string | null;
  pen: string | null;
  pen_status: string | null;
  apaar_id: string | null;
  srn: string | null;
  previous_school: string | null;
  previous_tc_no: string | null;
  previous_udise: string | null;
  docs: unknown;
  notes: string | null;
  photo_url: string | null;
  updated_at: string;
};

const DATA_URL_MAX = 8_000;

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function stripHeavyUrls(docs: StudentDocs): StudentDocs {
  const next = { ...emptyStudentDocs() };
  (Object.keys(next) as StudentDocKey[]).forEach((key) => {
    const d = docs[key];
    const fileUrl =
      d.fileUrl.startsWith("data:") && d.fileUrl.length > DATA_URL_MAX
        ? ""
        : d.fileUrl;
    next[key] = { ...d, fileUrl };
  });
  return next;
}

function photoForRemote(photoUrl: string): string {
  if (photoUrl.startsWith("data:") && photoUrl.length > DATA_URL_MAX) return "";
  return photoUrl;
}

function rowToHousehold(row: HouseholdRow): Household {
  return normalizeHousehold({
    id: row.id,
    code: row.code ?? "",
    guardianName: row.guardian_name ?? "",
    mobile: row.mobile ?? "",
    whatsappMobile: row.whatsapp_mobile ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    locality: row.locality ?? "",
    landmark: row.landmark ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    pincode: row.pincode ?? "",
    altMobile: row.alt_mobile ?? "",
  });
}

function rowToStudent(row: StudentRow): SisStudent {
  return normalizeStudent({
    id: row.id,
    admissionNo: row.admission_no ?? "",
    fullName: row.full_name ?? "",
    gender: (row.gender as SisStudent["gender"]) ?? "",
    dob: row.dob ?? "",
    status: row.status === "inactive" ? "inactive" : "active",
    campusId: row.campus_id ?? "",
    classId: row.class_id ?? "",
    sectionId: row.section_id ?? "",
    rollNo: row.roll_no ?? "",
    academicYearCode: row.academic_year_code ?? "",
    studentType: (row.student_type as SisStudent["studentType"]) ?? "NEW",
    feeGroupId: row.fee_group_id,
    joinedOn: row.joined_on ?? "",
    fatherName: row.father_name ?? "",
    motherName: row.mother_name ?? "",
    fatherMobile: row.father_mobile ?? "",
    motherMobile: row.mother_mobile ?? "",
    fatherAadhaarLast4: row.father_aadhaar_last4 ?? "",
    motherAadhaarLast4: row.mother_aadhaar_last4 ?? "",
    fatherPan: row.father_pan ?? "",
    motherPan: row.mother_pan ?? "",
    guardianRelation: row.guardian_relation ?? "",
    emergencyName: row.emergency_name ?? "",
    emergencyMobile: row.emergency_mobile ?? "",
    householdId: row.household_id ?? "",
    bloodGroup: row.blood_group ?? "",
    religion: row.religion ?? "",
    category: (row.category as SisStudent["category"]) ?? "",
    nationality: row.nationality ?? "Indian",
    motherTongue: row.mother_tongue ?? "",
    placeOfBirth: row.place_of_birth ?? "",
    aadhaarLast4: row.aadhaar_last4 ?? "",
    pen: row.pen ?? "",
    penStatus: (row.pen_status as SisStudent["penStatus"]) ?? "",
    apaarId: row.apaar_id ?? "",
    srn: row.srn ?? "",
    previousSchool: row.previous_school ?? "",
    previousTcNo: row.previous_tc_no ?? "",
    previousUdise: row.previous_udise ?? "",
    docs: (row.docs as SisStudent["docs"]) ?? undefined,
    notes: row.notes ?? "",
    photoUrl: row.photo_url ?? "",
    curriculum: null,
  });
}

function householdToRow(h: Household, tenantId: string, now: string) {
  return {
    id: h.id,
    tenant_id: tenantId,
    code: h.code,
    guardian_name: h.guardianName,
    mobile: h.mobile,
    whatsapp_mobile: h.whatsappMobile,
    email: h.email,
    address: h.address,
    locality: h.locality,
    landmark: h.landmark,
    city: h.city,
    state: h.state,
    pincode: h.pincode,
    alt_mobile: h.altMobile,
    updated_at: now,
  };
}

function studentToRow(s: SisStudent, tenantId: string, now: string) {
  const joined =
    s.joinedOn && /^\d{4}-\d{2}-\d{2}/.test(s.joinedOn) ? s.joinedOn : null;
  const dob = s.dob && /^\d{4}-\d{2}-\d{2}/.test(s.dob) ? s.dob : null;
  return {
    id: s.id,
    tenant_id: tenantId,
    admission_no: s.admissionNo,
    full_name: s.fullName,
    gender: s.gender,
    dob,
    status: s.status,
    campus_id: s.campusId,
    class_id: s.classId,
    section_id: s.sectionId,
    roll_no: s.rollNo,
    academic_year_code: s.academicYearCode,
    student_type: s.studentType,
    fee_group_id: s.feeGroupId,
    joined_on: joined,
    father_name: s.fatherName,
    mother_name: s.motherName,
    father_mobile: s.fatherMobile,
    mother_mobile: s.motherMobile,
    father_aadhaar_last4: s.fatherAadhaarLast4,
    mother_aadhaar_last4: s.motherAadhaarLast4,
    father_pan: s.fatherPan,
    mother_pan: s.motherPan,
    guardian_relation: s.guardianRelation,
    emergency_name: s.emergencyName,
    emergency_mobile: s.emergencyMobile,
    household_id: s.householdId || null,
    blood_group: s.bloodGroup,
    religion: s.religion,
    category: s.category,
    nationality: s.nationality,
    mother_tongue: s.motherTongue,
    place_of_birth: s.placeOfBirth,
    aadhaar_last4: s.aadhaarLast4,
    pen: s.pen,
    pen_status: s.penStatus,
    apaar_id: s.apaarId,
    srn: s.srn,
    previous_school: s.previousSchool,
    previous_tc_no: s.previousTcNo,
    previous_udise: s.previousUdise,
    docs: stripHeavyUrls(s.docs),
    notes: s.notes,
    photo_url: photoForRemote(s.photoUrl),
    updated_at: now,
  };
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: "sis_households" | "sis_students",
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

export async function fetchSisFromDb(): Promise<{
  bundle: SisRemoteBundle;
  meta: SisSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return {
      bundle: {
        households: [],
        students: [],
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      meta: null,
    };
  }
  const { sb, tenantId } = ctx;

  const [hhRes, stuRes, metaRes] = await Promise.all([
    sb.from("sis_households").select("*").eq("tenant_id", tenantId),
    sb.from("sis_students").select("*").eq("tenant_id", tenantId),
    sb.from("sis_sync_meta").select("*").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  if (hhRes.error || stuRes.error) {
    return {
      bundle: {
        households: [],
        students: [],
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      meta: null,
    };
  }

  const householdUpdatedAt: Record<string, string> = {};
  const studentUpdatedAt: Record<string, string> = {};
  const households = ((hhRes.data ?? []) as HouseholdRow[]).map((row) => {
    householdUpdatedAt[row.id] = row.updated_at;
    return rowToHousehold(row);
  });
  const students = ((stuRes.data ?? []) as StudentRow[]).map((row) => {
    studentUpdatedAt[row.id] = row.updated_at;
    return rowToStudent(row);
  });

  const metaRow = metaRes.data;
  return {
    bundle: { households, students, householdUpdatedAt, studentUpdatedAt },
    meta: metaRow
      ? {
          householdCount: metaRow.household_count as number,
          studentCount: metaRow.student_count as number,
          activeStudentCount: metaRow.active_student_count as number,
          updatedAt: String(metaRow.updated_at),
        }
      : null,
  };
}

export async function pushSisToDb(
  state: Pick<SisState, "households" | "students">,
): Promise<{ ok: boolean; error?: string; householdCount: number; studentCount: number }> {
  if (!sisDualWriteDbEnabled()) {
    return { ok: true, householdCount: 0, studentCount: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) {
    return {
      ok: false,
      error: "Supabase tenant not configured",
      householdCount: 0,
      studentCount: 0,
    };
  }
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const households = state.households ?? [];
  const students = state.students ?? [];

  const householdRows = households.map((h) => householdToRow(h, tenantId, now));
  if (householdRows.length > 0) {
    const { error } = await sb
      .from("sis_households")
      .upsert(householdRows, { onConflict: "id" });
    if (error) {
      return {
        ok: false,
        error: error.message,
        householdCount: 0,
        studentCount: 0,
      };
    }
  }

  const studentRows = students.map((s) => studentToRow(s, tenantId, now));
  const chunk = 40;
  for (let i = 0; i < studentRows.length; i += chunk) {
    const slice = studentRows.slice(i, i + chunk);
    const { error } = await sb
      .from("sis_students")
      .upsert(slice, { onConflict: "id" });
    if (error) {
      return {
        ok: false,
        error: error.message,
        householdCount: householdRows.length,
        studentCount: 0,
      };
    }
  }

  const keepHh = new Set(households.map((h) => h.id));
  const keepStu = new Set(students.map((s) => s.id));
  await Promise.all([
    deleteStale(sb, tenantId, "sis_households", keepHh),
    deleteStale(sb, tenantId, "sis_students", keepStu),
  ]);

  const activeCount = students.filter((s) => s.status === "active").length;
  await sb.from("sis_sync_meta").upsert(
    {
      tenant_id: tenantId,
      household_count: households.length,
      student_count: students.length,
      active_student_count: activeCount,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return {
    ok: true,
    householdCount: households.length,
    studentCount: students.length,
  };
}

export async function wipeSisRosterInDb(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;

  const { error: stuErr } = await sb
    .from("sis_students")
    .delete()
    .eq("tenant_id", tenantId);
  if (stuErr) return { ok: false, error: stuErr.message };

  const { error: hhErr } = await sb
    .from("sis_households")
    .delete()
    .eq("tenant_id", tenantId);
  if (hhErr) return { ok: false, error: hhErr.message };

  await sb.from("sis_sync_meta").upsert(
    {
      tenant_id: tenantId,
      household_count: 0,
      student_count: 0,
      active_student_count: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}
