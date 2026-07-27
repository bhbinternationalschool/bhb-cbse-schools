import {
  STAFF_CATEGORIES,
  STAFF_STREAMS,
  newFoundationId,
  normalizeStaffRecord,
  type Department,
  type Designation,
  type StaffCategory,
  type StaffCasteCategory,
  type StaffGender,
  type StaffJobType,
  type StaffRecord,
  type StaffStream,
} from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";

const TEMPLATE_HEADER =
  "emp_code,full_name,mobile,stream,category,job_type,department_code,designation_code,status,gender,religion,caste,basic_pay,oasis_id";

export type StaffImportPreview = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  sample: { empCode: string; fullName: string; action: string }[];
};

export type StaffImportOptions = {
  upsert?: boolean;
  /** Drop existing staff before applying rows (clears demo / prior roster). */
  replaceAll?: boolean;
  dryRun?: boolean;
};

/** Canonical field keys used after header alias resolution. */
type ColKey =
  | "emp_code"
  | "biometric_code"
  | "sr_no"
  | "full_name"
  | "mobile"
  | "email"
  | "stream"
  | "category"
  | "job_type"
  | "employment_category"
  | "department"
  | "designation"
  | "status"
  | "gender"
  | "religion"
  | "caste"
  | "date_of_birth"
  | "joining_date"
  | "leaving_date"
  | "staff_added_on"
  | "father_name"
  | "spouse_name"
  | "address"
  | "city"
  | "state"
  | "pan"
  | "voter_id"
  | "aadhaar"
  | "qualification"
  | "experience_years"
  | "experience_detail"
  | "experience_description"
  | "basic_pay"
  | "oasis_id"
  | "branch_name"
  | "bank_name"
  | "bank_account"
  | "ifsc"
  | "uan"
  | "pf_number";

const HEADER_ALIASES: Record<string, ColKey> = {
  emp_code: "emp_code",
  empcode: "emp_code",
  employee_code: "emp_code",
  employee_id: "emp_code",
  staff_code: "emp_code",
  biometric_code: "biometric_code",
  biometric: "biometric_code",
  biometric_id: "biometric_code",
  srno: "sr_no",
  sr_no: "sr_no",
  sr_no_: "sr_no",
  sno: "sr_no",
  full_name: "full_name",
  name: "full_name",
  staff_name: "full_name",
  mobile: "mobile",
  phone: "mobile",
  phone_no: "mobile",
  phoneno: "mobile",
  contact: "mobile",
  email: "email",
  email_id: "email",
  stream: "stream",
  type: "stream",
  staff_type: "stream",
  category: "category",
  employment_type: "category",
  job_type: "job_type",
  employmentcategory: "employment_category",
  employment_category: "employment_category",
  department_code: "department",
  department: "department",
  dept: "department",
  designation_code: "designation",
  designation: "designation",
  status: "status",
  gender: "gender",
  religion: "religion",
  caste: "caste",
  caste_category: "caste",
  category_caste: "caste",
  date_of_birth: "date_of_birth",
  dob: "date_of_birth",
  dateofbirth: "date_of_birth",
  joining_date: "joining_date",
  date_of_joining: "joining_date",
  dateofjoining: "joining_date",
  doj: "joining_date",
  leaving_date: "leaving_date",
  date_of_leaving: "leaving_date",
  dateofleaving: "leaving_date",
  dol: "leaving_date",
  staff_added_date: "staff_added_on",
  staff_added_on: "staff_added_on",
  father_name: "father_name",
  fathername: "father_name",
  spouse_name: "spouse_name",
  husband_name: "spouse_name",
  husbandname: "spouse_name",
  address: "address",
  city: "city",
  state: "state",
  statename: "state",
  state_name: "state",
  pan: "pan",
  pan_number: "pan",
  pan_no: "pan",
  pannumber: "pan",
  voter_id: "voter_id",
  voter_card_no: "voter_id",
  votercardno: "voter_id",
  aadhaar: "aadhaar",
  aadhaar_no: "aadhaar",
  adhar_card_no: "aadhaar",
  adharcardno: "aadhaar",
  aadhar: "aadhaar",
  qualification: "qualification",
  experience_years: "experience_years",
  expinyears: "experience_years",
  exp_in_years: "experience_years",
  experience: "experience_detail",
  experience_detail: "experience_detail",
  exp_description: "experience_description",
  experience_description: "experience_description",
  basic_pay: "basic_pay",
  basicpay: "basic_pay",
  oasis_id: "oasis_id",
  oasisid: "oasis_id",
  branch_name: "branch_name",
  branchname: "branch_name",
  bank_name: "bank_name",
  bankname: "bank_name",
  bank_account: "bank_account",
  bank_account_no: "bank_account",
  bankaccountno: "bank_account",
  ifsc: "ifsc",
  bank_ifsc: "ifsc",
  uan: "uan",
  uan_number: "uan",
  pf_number: "pf_number",
  pf_account_no: "pf_number",
  pfaccountno: "pf_number",
  pf_no: "pf_number",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

function normHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[.#]+$/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function resolveColKey(header: string): ColKey | null {
  const n = normHeader(header);
  return HEADER_ALIASES[n] ?? null;
}

function asStream(v: string): StaffStream | null {
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "teaching" || t === "t") return "teaching";
  if (
    t === "non_teaching" ||
    t === "nonteaching" ||
    t === "nt" ||
    t === "non_teaching_staff"
  )
    return "non_teaching";
  return (STAFF_STREAMS.find((s) => s.value === t)?.value as StaffStream) ?? null;
}

function asCategory(v: string): StaffCategory | null {
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "permanent" || t === "p" || t === "confirmed") return "permanent";
  if (t === "contract" || t === "c") return "contract";
  if (t === "part_time" || t === "parttime" || t === "pt" || t === "temporary")
    return "part_time";
  return (
    (STAFF_CATEGORIES.find((s) => s.value === t)?.value as StaffCategory) ??
    null
  );
}

function asJobType(v: string): StaffJobType {
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "confirmed") return "confirmed";
  if (t === "probation") return "probation";
  if (t === "temporary") return "temporary";
  if (t === "contract") return "contract";
  return "";
}

function categoryFromJobType(job: StaffJobType): StaffCategory {
  if (job === "contract") return "contract";
  if (job === "temporary") return "part_time";
  return "permanent";
}

function asGender(v: string): StaffGender {
  const t = v.trim().toLowerCase();
  if (t === "m" || t === "male") return "M";
  if (t === "f" || t === "female") return "F";
  if (t === "o" || t === "other") return "O";
  return "";
}

function asCaste(v: string): StaffCasteCategory {
  const t = v.trim().toUpperCase();
  if (t === "GENERAL" || t === "GEN") return "GENERAL";
  if (t === "OBC") return "OBC";
  if (t === "SC") return "SC";
  if (t === "ST") return "ST";
  if (t === "OTHER") return "OTHER";
  return "";
}

/** Parse vendor dates like 9/1/80, 4/1/25, or ISO / Excel serials as strings. */
export function parseStaffImportDate(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const isoHit = v.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (isoHit) {
    return `${isoHit[1]}-${isoHit[2]!.padStart(2, "0")}-${isoHit[3]!.padStart(2, "0")}`;
  }
  const us = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return "";
}

function deptCodeFromName(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned.slice(0, 12) || "DEPT").slice(0, 12);
}

function desigCodeFromName(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned.slice(0, 12) || "DES").slice(0, 12);
}

function ensureDepartment(
  departments: Department[],
  nameOrCode: string,
): { departments: Department[]; id: string } {
  const key = nameOrCode.trim();
  if (!key) return { departments, id: "" };
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
    code: deptCodeFromName(key),
    name: key,
    isActive: true,
  };
  return { departments: [...departments, row], id: row.id };
}

function ensureDesignation(
  designations: Designation[],
  nameOrCode: string,
  departmentId: string | null,
): { designations: Designation[]; id: string } {
  const key = nameOrCode.trim();
  if (!key) return { designations, id: "" };
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
    code: desigCodeFromName(key),
    name: key,
    departmentId,
    isActive: true,
  };
  return { designations: [...designations, row], id: row.id };
}

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const keys = rows[i]!.map((h) => resolveColKey(h)).filter(Boolean);
    const hasName = keys.includes("full_name");
    const hasCode =
      keys.includes("emp_code") ||
      keys.includes("biometric_code") ||
      keys.includes("sr_no");
    if (hasName && (hasCode || keys.length >= 5)) return i;
  }
  return 0;
}

function colIndex(map: Map<ColKey, number>, key: ColKey): number {
  return map.get(key) ?? -1;
}

function cell(cols: string[], i: number): string {
  return i >= 0 ? (cols[i] ?? "").trim() : "";
}

export function downloadStaffImportTemplate() {
  const sample = [
    TEMPLATE_HEADER,
    "EMP001,Anita Sharma,9876543210,teaching,permanent,confirmed,ACAD,PGT,active,F,Hindu,GENERAL,25000,",
    "EMP002,Ravi Kumar,9876501234,non_teaching,contract,contract,ADMIN,CLK,active,M,Hindu,OBC,18000,",
  ].join("\n");
  const blob = new Blob([sample], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "staff_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadStaffRosterCsv(masters: MastersState) {
  const lines = [TEMPLATE_HEADER];
  for (const s of masters.staff ?? []) {
    const dep = masters.departments.find((d) => d.id === s.departmentId);
    const des = masters.designations.find((d) => d.id === s.designationId);
    lines.push(
      [
        s.empCode,
        `"${s.fullName.replace(/"/g, '""')}"`,
        s.mobile,
        s.stream,
        s.category,
        s.jobType,
        dep?.code ?? "",
        des?.code ?? "",
        s.status,
        s.gender,
        s.religion,
        s.casteCategory,
        s.basicPay,
        s.oasisId,
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "staff_roster.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Convert vendor Teacher.xlsx (or similar) into CSV text for staff import.
 * Skips title rows above the header that contains Full Name.
 */
export async function workbookToStaffImportCsv(
  data: ArrayBuffer | Uint8Array,
): Promise<{ csv: string; headerRow: number }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = wb.Sheets[sheetName]!;
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const asStrings = grid.map((row) =>
    (row as unknown[]).map((c) => String(c ?? "").trim()),
  );
  const headerRow = findHeaderRow(asStrings);
  const sliced = asStrings.slice(headerRow);
  const csv = sliced
    .map((row) =>
      row
        .map((cellValue) => {
          const s = String(cellValue ?? "");
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    )
    .join("\n");
  return { csv, headerRow };
}

export function previewStaffImport(
  csvText: string,
  masters: MastersState,
  upsert = true,
  replaceAll = false,
): StaffImportPreview {
  return applyStaffImport(csvText, masters, {
    upsert,
    replaceAll,
    dryRun: true,
  });
}

export function applyStaffImport(
  csvText: string,
  masters: MastersState,
  options: StaffImportOptions | boolean = true,
  dryRunLegacy?: boolean,
): StaffImportPreview & { state: MastersState } {
  const opts: StaffImportOptions =
    typeof options === "boolean"
      ? { upsert: options, dryRun: dryRunLegacy ?? false, replaceAll: false }
      : options;
  const upsert = opts.upsert !== false;
  const replaceAll = opts.replaceAll === true;
  const dryRun = opts.dryRun === true;

  const allRows = parseCsv(csvText);
  const errors: string[] = [];
  const sample: StaffImportPreview["sample"] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  if (allRows.length < 2) {
    return {
      state: masters,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["File needs a header row and at least one data row"],
      sample: [],
    };
  }

  const headerAt = findHeaderRow(allRows);
  const headerCells = allRows[headerAt]!;
  const colMap = new Map<ColKey, number>();
  headerCells.forEach((h, i) => {
    const key = resolveColKey(h);
    if (key && !colMap.has(key)) colMap.set(key, i);
  });

  const iName = colIndex(colMap, "full_name");
  const iCode = colIndex(colMap, "emp_code");
  const iBio = colIndex(colMap, "biometric_code");
  const iSr = colIndex(colMap, "sr_no");

  if (iName < 0) {
    return {
      state: masters,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["File must include a Full Name column"],
      sample: [],
    };
  }

  let departments = [...(masters.departments ?? [])];
  let designations = [...(masters.designations ?? [])];
  let staff = replaceAll ? [] : [...(masters.staff ?? [])];
  const byCode = new Map(
    staff.map((s) => [s.empCode.trim().toUpperCase(), s] as const),
  );
  const usedCodes = new Set(byCode.keys());

  for (let r = headerAt + 1; r < allRows.length; r++) {
    const cols = allRows[r]!;
    const fullName = cell(cols, iName);
    if (!fullName) {
      skipped++;
      continue;
    }

    const biometric = cell(cols, iBio);
    const sr = cell(cols, iSr) || String(r - headerAt);
    let empCode = (cell(cols, iCode) || biometric || `STF-${sr.padStart(3, "0")}`)
      .trim()
      .toUpperCase();
    if (!empCode) {
      skipped++;
      errors.push(`Row ${r + 1}: missing emp code / biometric / SrNo`);
      continue;
    }
    if (!cell(cols, iCode) && !biometric && usedCodes.has(empCode)) {
      empCode = `STF-${sr.padStart(3, "0")}-${r}`;
    }

    const streamRaw = cell(cols, colIndex(colMap, "stream")) || "teaching";
    const stream = asStream(streamRaw) ?? "teaching";
    if (streamRaw.trim() && !asStream(streamRaw)) {
      errors.push(`Row ${r + 1}: unknown Type/stream "${streamRaw}" — used teaching`);
    }

    const jobRaw = cell(cols, colIndex(colMap, "job_type"));
    const jobType = asJobType(jobRaw);
    const empCatRaw = cell(cols, colIndex(colMap, "employment_category"));
    const catRaw =
      cell(cols, colIndex(colMap, "category")) ||
      empCatRaw ||
      (jobType ? categoryFromJobType(jobType) : "permanent");
    const category =
      asCategory(typeof catRaw === "string" ? catRaw : String(catRaw)) ??
      categoryFromJobType(jobType);

    const depLabel = cell(cols, colIndex(colMap, "department"));
    let departmentId: string | null = null;
    if (depLabel) {
      const ensured = ensureDepartment(departments, depLabel);
      departments = ensured.departments;
      departmentId = ensured.id || null;
    }

    const desLabel = cell(cols, colIndex(colMap, "designation"));
    let designationId: string | null = null;
    if (desLabel) {
      const ensured = ensureDesignation(designations, desLabel, departmentId);
      designations = ensured.designations;
      designationId = ensured.id || null;
    }

    const mobile = cell(cols, colIndex(colMap, "mobile")).replace(/\D/g, "").slice(-10);
    const email = cell(cols, colIndex(colMap, "email"));
    const leavingDate = parseStaffImportDate(
      cell(cols, colIndex(colMap, "leaving_date")),
    );
    const statusRaw = cell(cols, colIndex(colMap, "status")).toLowerCase();
    let status: StaffRecord["status"] = "active";
    if (
      statusRaw === "inactive" ||
      statusRaw === "left" ||
      statusRaw === "resigned"
    ) {
      status = "inactive";
    } else if (leavingDate) {
      const left = new Date(leavingDate);
      if (!Number.isNaN(left.getTime()) && left.getTime() < Date.now()) {
        status = "inactive";
      }
    }

    const gender = asGender(cell(cols, colIndex(colMap, "gender")));
    const religion = cell(cols, colIndex(colMap, "religion"));
    const casteCategory = asCaste(cell(cols, colIndex(colMap, "caste")));
    const dateOfBirth = parseStaffImportDate(
      cell(cols, colIndex(colMap, "date_of_birth")),
    );
    const joiningDate = parseStaffImportDate(
      cell(cols, colIndex(colMap, "joining_date")),
    );
    const staffAddedOn = parseStaffImportDate(
      cell(cols, colIndex(colMap, "staff_added_on")),
    );
    const fatherName = cell(cols, colIndex(colMap, "father_name"));
    const spouseName = cell(cols, colIndex(colMap, "spouse_name"));
    const addressCurrent = cell(cols, colIndex(colMap, "address"));
    const city = cell(cols, colIndex(colMap, "city"));
    const state = cell(cols, colIndex(colMap, "state"));
    const panNo = cell(cols, colIndex(colMap, "pan"));
    const voterId = cell(cols, colIndex(colMap, "voter_id"));
    const aadhaarNo = cell(cols, colIndex(colMap, "aadhaar")).replace(/\D/g, "");
    const qualification = cell(cols, colIndex(colMap, "qualification"));
    const experienceYears = cell(cols, colIndex(colMap, "experience_years"));
    const experienceDetail = cell(cols, colIndex(colMap, "experience_detail"));
    const experienceDescription = cell(
      cols,
      colIndex(colMap, "experience_description"),
    );
    const basicPay = cell(cols, colIndex(colMap, "basic_pay")).replace(
      /[^\d.]/g,
      "",
    );
    const oasisId = cell(cols, colIndex(colMap, "oasis_id"));
    const branchName = cell(cols, colIndex(colMap, "branch_name"));
    const bankName = cell(cols, colIndex(colMap, "bank_name"));
    const bankAccountNo = cell(cols, colIndex(colMap, "bank_account"));
    const bankIfsc = cell(cols, colIndex(colMap, "ifsc"));
    const uanNumber = cell(cols, colIndex(colMap, "uan"));
    const pfNumber = cell(cols, colIndex(colMap, "pf_number"));
    const biometricId = biometric || cell(cols, colIndex(colMap, "biometric_code"));

    const patch: Partial<StaffRecord> = {
      fullName,
      stream,
      category,
      jobType: jobType || undefined,
      departmentId,
      designationId,
      mobile,
      email,
      status,
      gender,
      religion,
      casteCategory,
      dateOfBirth,
      joiningDate,
      leavingDate,
      staffAddedOn,
      fatherName,
      spouseName,
      addressCurrent,
      city,
      state,
      panNo,
      voterId,
      aadhaarNo,
      qualification,
      experienceYears,
      experienceDetail,
      experienceDescription,
      basicPay,
      oasisId,
      branchName,
      bankName,
      bankAccountNo,
      bankIfsc,
      uanNumber,
      pfNumber,
      biometricId,
    };

    const existing = byCode.get(empCode);
    if (existing) {
      if (!upsert) {
        skipped++;
        continue;
      }
      const next = normalizeStaffRecord({
        ...existing,
        ...Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined && v !== ""),
        ),
        id: existing.id,
        empCode,
        fullName,
        stream,
        category,
        status,
        departmentId: departmentId ?? existing.departmentId,
        designationId: designationId ?? existing.designationId,
        jobType: jobType || existing.jobType,
      });
      if (!dryRun) {
        const at = staff.findIndex((s) => s.id === existing.id);
        if (at >= 0) staff[at] = next;
        byCode.set(empCode, next);
      }
      updated++;
      if (sample.length < 8) {
        sample.push({ empCode, fullName, action: "update" });
      }
    } else {
      const row = normalizeStaffRecord({
        id: newFoundationId("stf"),
        empCode,
        ...patch,
        fullName,
        stream,
        category,
        status,
        jobType,
        departmentId,
        designationId,
      });
      if (!dryRun) {
        staff.push(row);
        byCode.set(empCode, row);
        usedCodes.add(empCode);
      }
      created++;
      if (sample.length < 8) {
        sample.push({ empCode, fullName, action: replaceAll ? "create" : "create" });
      }
    }
  }

  return {
    state: dryRun
      ? masters
      : { ...masters, staff, departments, designations },
    created,
    updated,
    skipped,
    errors,
    sample,
  };
}
