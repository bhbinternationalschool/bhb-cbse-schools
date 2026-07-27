import teacherRosterJson from "@/lib/data/teacherRosterFromExcel.json";
import {
  newFoundationId,
  normalizeStaffRecord,
  type Department,
  type Designation,
  type StaffRecord,
} from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";

type SeedStaff = {
  empCode: string;
  fullName: string;
  biometricId?: string;
  mobile?: string;
  email?: string;
  stream?: StaffRecord["stream"];
  category?: StaffRecord["category"];
  jobType?: StaffRecord["jobType"];
  departmentName?: string;
  designationName?: string;
  gender?: StaffRecord["gender"];
  religion?: string;
  casteCategory?: StaffRecord["casteCategory"];
  dateOfBirth?: string;
  joiningDate?: string;
  leavingDate?: string;
  staffAddedOn?: string;
  fatherName?: string;
  spouseName?: string;
  addressCurrent?: string;
  city?: string;
  state?: string;
  panNo?: string;
  voterId?: string;
  aadhaarNo?: string;
  qualification?: string;
  experienceYears?: string;
  experienceDetail?: string;
  experienceDescription?: string;
  basicPay?: string;
  oasisId?: string;
  branchName?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  uanNumber?: string;
  pfNumber?: string;
  status?: StaffRecord["status"];
};

type SeedFile = {
  departments: { code: string; name: string }[];
  designations: { code: string; name: string; dept?: string }[];
  staff: SeedStaff[];
};

const SEED = teacherRosterJson as SeedFile;

function ensureDepartment(
  departments: Department[],
  name: string,
  codeHint?: string,
): { departments: Department[]; id: string | null } {
  const key = name.trim();
  if (!key) return { departments, id: null };
  const upper = key.toUpperCase();
  const existing = departments.find(
    (d) =>
      d.code.toUpperCase() === upper ||
      d.name.toUpperCase() === upper ||
      d.name.toLowerCase() === key.toLowerCase(),
  );
  if (existing) return { departments, id: existing.id };
  const row: Department = {
    id: newFoundationId("dep"),
    code: (codeHint || key)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 12) || "DEPT",
    name: key,
    isActive: true,
  };
  return { departments: [...departments, row], id: row.id };
}

function ensureDesignation(
  designations: Designation[],
  name: string,
  departmentId: string | null,
  codeHint?: string,
): { designations: Designation[]; id: string | null } {
  const key = name.trim();
  if (!key) return { designations, id: null };
  const upper = key.toUpperCase();
  const existing = designations.find(
    (d) =>
      d.code.toUpperCase() === upper ||
      d.name.toUpperCase() === upper ||
      d.name.toLowerCase() === key.toLowerCase(),
  );
  if (existing) return { designations, id: existing.id };
  const row: Designation = {
    id: newFoundationId("des"),
    code: (codeHint || key)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 12) || "DES",
    name: key,
    departmentId,
    isActive: true,
  };
  // Prefer short PRIN code so resolvePrincipal /^PRIN/ matches reliably
  if (/^principal$/i.test(key)) row.code = "PRIN";
  return { designations: [...designations, row], id: row.id };
}

/** Demo EMP-001… roster from defaultFoundationSlice. */
export function looksLikeDemoStaffRoster(staff: StaffRecord[]): boolean {
  if (!staff.length) return false;
  const demoHit = staff.some(
    (s) =>
      s.empCode.toUpperCase() === "EMP-001" &&
      /priya\s+sharma/i.test(s.fullName),
  );
  if (demoHit) return true;
  const allEmpDemo =
    staff.length <= 12 &&
    staff.every(
      (s) =>
        /^EMP-0\d{2}$/i.test(s.empCode) &&
        /^98000000\d{2}$/.test(s.mobile.replace(/\D/g, "")),
    );
  return allEmpDemo;
}

export function buildTeacherRosterOntoMasters(
  state: MastersState,
): MastersState {
  let departments = [...(state.departments ?? [])];
  let designations = [...(state.designations ?? [])];

  for (const d of SEED.departments) {
    const ensured = ensureDepartment(departments, d.name, d.code);
    departments = ensured.departments;
  }
  for (const d of SEED.designations) {
    let departmentId: string | null = null;
    if (d.dept) {
      const dep = ensureDepartment(departments, d.dept);
      departments = dep.departments;
      departmentId = dep.id;
    }
    const ensured = ensureDesignation(
      designations,
      d.name,
      departmentId,
      d.code,
    );
    designations = ensured.designations;
  }

  const staff: StaffRecord[] = SEED.staff.map((row) => {
    let departmentId: string | null = null;
    if (row.departmentName) {
      const dep = ensureDepartment(departments, row.departmentName);
      departments = dep.departments;
      departmentId = dep.id;
    }
    let designationId: string | null = null;
    if (row.designationName) {
      const des = ensureDesignation(
        designations,
        row.designationName,
        departmentId,
      );
      designations = des.designations;
      designationId = des.id;
    }
    const loginBase = row.fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.|\.$/g, "")
      .slice(0, 24);
    return normalizeStaffRecord({
      id: newFoundationId("stf"),
      empCode: row.empCode,
      fullName: row.fullName,
      stream: row.stream ?? "teaching",
      category: row.category ?? "permanent",
      jobType: row.jobType ?? "",
      departmentId,
      designationId,
      mobile: row.mobile ?? "",
      email: row.email ?? "",
      status: row.status ?? "active",
      gender: row.gender ?? "",
      religion: row.religion ?? "",
      casteCategory: row.casteCategory ?? "",
      dateOfBirth: row.dateOfBirth ?? "",
      joiningDate: row.joiningDate ?? "",
      leavingDate: row.leavingDate ?? "",
      staffAddedOn: row.staffAddedOn ?? "",
      fatherName: row.fatherName ?? "",
      spouseName: row.spouseName ?? "",
      addressCurrent: row.addressCurrent ?? "",
      city: row.city ?? "",
      state: row.state ?? "",
      panNo: row.panNo ?? "",
      voterId: row.voterId ?? "",
      aadhaarNo: row.aadhaarNo ?? "",
      qualification: row.qualification ?? "",
      experienceYears: row.experienceYears ?? "",
      experienceDetail: row.experienceDetail ?? "",
      experienceDescription: row.experienceDescription ?? "",
      basicPay: row.basicPay ?? "",
      oasisId: row.oasisId ?? "",
      branchName: row.branchName ?? "",
      bankName: row.bankName ?? "",
      bankAccountNo: row.bankAccountNo ?? "",
      bankIfsc: row.bankIfsc ?? "",
      uanNumber: row.uanNumber ?? "",
      pfNumber: row.pfNumber ?? "",
      biometricId: row.biometricId ?? "",
      loginUsername: loginBase || row.empCode.toLowerCase(),
    });
  });

  return { ...state, departments, designations, staff };
}

/** One-time swap of demo EMP-* staff for Teacher.xlsx roster. */
export function migrateDemoStaffToTeacherRoster(
  state: MastersState,
): MastersState {
  if (!looksLikeDemoStaffRoster(state.staff ?? [])) return state;
  return buildTeacherRosterOntoMasters(state);
}
