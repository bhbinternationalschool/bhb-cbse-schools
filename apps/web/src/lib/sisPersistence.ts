/**
 * Full SIS remote sync — households + students.
 * localStorage remains the working copy; Supabase overlays when configured.
 * Curriculum continues via curriculumPersistence (not stored on sis_students).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { TENANT } from "@/lib/types";
import {
  normalizeHousehold,
  normalizeStudent,
  type Household,
  type SisState,
  type SisStudent,
  type StudentDocs,
  type StudentDocKey,
  emptyStudentDocs,
} from "@/lib/sis";

export type SisRemoteBundle = {
  households: Household[];
  students: SisStudent[];
  householdUpdatedAt: Record<string, string>;
  studentUpdatedAt: Record<string, string>;
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

let tenantIdCache: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: SisState | null = null;
let hydratedOnce = false;

const DATA_URL_MAX = 8_000;

export function sisRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetSisPersistenceCache() {
  tenantIdCache = null;
  hydratedOnce = false;
  pendingPush = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

async function clientAndTenant(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  const sb = createBrowserSupabase();
  if (!sb) return null;
  if (tenantIdCache) return { sb, tenantId: tenantIdCache };
  const { data, error } = await sb
    .from("tenants")
    .select("id")
    .eq("slug", TENANT.slug)
    .maybeSingle();
  if (error || !data?.id) {
    console.warn("[sis] tenant resolve failed", error?.message);
    return null;
  }
  tenantIdCache = data.id as string;
  return { sb, tenantId: tenantIdCache };
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

export async function fetchSisRemote(): Promise<SisRemoteBundle | null> {
  if (!sisRemoteEnabled()) return null;
  const ctx = await clientAndTenant();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const [hhRes, stuRes] = await Promise.all([
    sb.from("sis_households").select("*").eq("tenant_id", tenantId),
    sb.from("sis_students").select("*").eq("tenant_id", tenantId),
  ]);

  if (hhRes.error) {
    console.warn("[sis] pull households failed", hhRes.error.message);
    return null;
  }
  if (stuRes.error) {
    console.warn("[sis] pull students failed", stuRes.error.message);
    return null;
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

  return { households, students, householdUpdatedAt, studentUpdatedAt };
}

/**
 * Merge remote roster into local SIS.
 * Remote wins on id collision; local-only rows kept.
 * Curriculum on local students is preserved (synced separately).
 */
export function mergeSisRemoteIntoState(
  local: SisState,
  remote: SisRemoteBundle,
): SisState {
  const hhMap = new Map<string, Household>();
  for (const h of local.households) hhMap.set(h.id, h);
  for (const h of remote.households) hhMap.set(h.id, h);

  const curriculumById = new Map(
    local.students.map((s) => [s.id, s.curriculum] as const),
  );
  const stuMap = new Map<string, SisStudent>();
  for (const s of local.students) stuMap.set(s.id, s);
  for (const s of remote.students) {
    const prev = stuMap.get(s.id);
    stuMap.set(
      s.id,
      normalizeStudent({
        ...s,
        curriculum: prev?.curriculum ?? curriculumById.get(s.id) ?? null,
      }),
    );
  }

  return {
    ...local,
    version: 1,
    households: [...hhMap.values()],
    students: [...stuMap.values()],
  };
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

export async function pushSisState(
  state: SisState,
): Promise<{ ok: boolean; error?: string }> {
  if (!sisRemoteEnabled()) return { ok: true };
  const ctx = await clientAndTenant();
  if (!ctx) return { ok: false, error: "Tenant not resolved" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const householdRows = state.households.map((h) =>
    householdToRow(h, tenantId, now),
  );
  if (householdRows.length > 0) {
    const { error } = await sb.from("sis_households").upsert(householdRows, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[sis] push households failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  const studentRows = state.students.map((s) =>
    studentToRow(s, tenantId, now),
  );
  // Upsert in chunks to avoid huge payloads
  const chunk = 40;
  for (let i = 0; i < studentRows.length; i += chunk) {
    const slice = studentRows.slice(i, i + chunk);
    const { error } = await sb.from("sis_students").upsert(slice, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[sis] push students failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  return { ok: true };
}

export function scheduleSisSync(state: SisState) {
  if (!sisRemoteEnabled()) return;
  if (typeof window === "undefined") return;
  pendingPush = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = pendingPush;
    pendingPush = null;
    pushTimer = null;
    if (!payload) return;
    void pushSisState(payload);
  }, 500);
}

/**
 * Pull roster once, merge into localStorage, then hydrate curriculum.
 */
export async function ensureSisHydrated(): Promise<boolean> {
  if (!sisRemoteEnabled()) return false;
  if (hydratedOnce) return false;
  hydratedOnce = true;

  const remote = await fetchSisRemote();
  const { loadSis, saveSis } = await import("@/lib/sis");
  let next = loadSis();
  let changed = false;

  if (remote && (remote.households.length > 0 || remote.students.length > 0)) {
    next = mergeSisRemoteIntoState(next, remote);
    changed = true;
  }

  // Push local (or merged) so empty remote gets seeded from demo
  await pushSisState(next);

  if (changed) {
    // Write without re-entering schedule from saveSis double-fire is fine
    saveSis(next);
  }

  const { ensureCurriculumHydrated } = await import(
    "@/lib/curriculumPersistence"
  );
  await ensureCurriculumHydrated();
  return changed;
}
