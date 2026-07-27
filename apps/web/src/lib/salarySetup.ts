/**
 * Salary setup — heads, structure templates, pay-cycle settings,
 * per-staff structure assignment. localStorage (demo).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import type {
  StaffCategory,
  StaffRecord,
  StaffStream,
} from "@/lib/foundationMasters";
import { DEFAULT_AY } from "@/lib/masters";

export type SalaryHeadKind = "earning" | "deduction" | "employer";

export type SalaryHead = {
  id: string;
  code: string;
  name: string;
  kind: SalaryHeadKind;
  /** Used in Tally / export */
  tallyLedger: string;
  isActive: boolean;
  sortOrder: number;
};

export type SalaryLineCalc = "fixed" | "percent_of_basic";

export type SalaryStructureLine = {
  headId: string;
  calc: SalaryLineCalc;
  /** Fixed ₹ or % of basic */
  amount: number;
};

export type SalaryStructure = {
  id: string;
  code: string;
  name: string;
  /** Optional matchers — empty = any */
  designationId: string;
  category: StaffCategory | "";
  stream: StaffStream | "";
  lines: SalaryStructureLine[];
  isActive: boolean;
  note: string;
};

/**
 * Per-staff statutory deduction cover for payroll.
 * Structure may list PF/ESIC heads; enrollment decides which apply.
 */
export type StatutoryCover = "both" | "pf_only" | "esic_only" | "none";

export const STATUTORY_COVER_OPTIONS: {
  value: StatutoryCover;
  label: string;
}[] = [
  { value: "both", label: "PF + ESIC" },
  { value: "pf_only", label: "PF only" },
  { value: "esic_only", label: "ESIC only" },
  { value: "none", label: "Neither" },
];

export type StaffSalaryLink = {
  staffId: string;
  structureId: string;
  /** Override basic earning amount (0 = use structure) */
  basicOverride: number;
  /** Who avails PF / ESIC on this assignment */
  statutoryCover: StatutoryCover;
  effectiveFrom: string;
  salaryAccountNote: string;
};

export function normalizeStatutoryCover(
  v?: string | null,
): StatutoryCover {
  if (v === "pf_only" || v === "esic_only" || v === "none" || v === "both") {
    return v;
  }
  return "both";
}

/** Whether a salary head applies under this staff's PF/ESIC enrollment. */
export function headAllowedByStatutory(
  headCode: string,
  cover: StatutoryCover,
): boolean {
  const code = (headCode || "").toUpperCase();
  const isPf = code === "PF_EE" || code === "PF_ER" || code.startsWith("PF_");
  const isEsic =
    code === "ESIC_EE" ||
    code === "ESIC_ER" ||
    code.startsWith("ESIC_") ||
    code === "ESI_EE" ||
    code === "ESI_ER";
  if (!isPf && !isEsic) return true;
  if (cover === "none") return false;
  if (cover === "both") return true;
  if (cover === "pf_only") return isPf;
  if (cover === "esic_only") return isEsic;
  return true;
}

export type SalarySettings = {
  /** Days used for per-day rate (default 30) */
  dayCount: number;
  /** Attendance cut-off day of month (1–28) */
  cutoffDay: number;
  /** Pay credit day of next month (1–28) */
  payDay: number;
  /** School salary bank account (UP: separate from fee a/c) */
  salaryBankName: string;
  /** Branch label e.g. Murdaha Bazar, Varanasi */
  salaryBankBranch: string;
  salaryBankAccountNo: string;
  salaryBankIfsc: string;
  salaryAccountLabel: string;
};

/** BHB school salary bank — Union Bank Murdaha Bazar, Varanasi */
export const SCHOOL_SALARY_BANK = {
  name: "Union Bank of India",
  branch: "Murdaha Bazar, Varanasi",
  ifsc: "UBIN0548847",
  address: "At & Post Muradaha Bazar, Block Harhua, Varanasi, UP 221202",
  micr: "221026020",
} as const;

export type SalarySetupState = {
  version: 1;
  settings: SalarySettings;
  heads: SalaryHead[];
  structures: SalaryStructure[];
  staffLinks: StaffSalaryLink[];
};

const STORAGE_KEY = "bhb_salary_setup_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSalarySettings(): SalarySettings {
  return {
    dayCount: 30,
    cutoffDay: 25,
    payDay: 1,
    salaryBankName: SCHOOL_SALARY_BANK.name,
    salaryBankBranch: SCHOOL_SALARY_BANK.branch,
    salaryBankAccountNo: "",
    salaryBankIfsc: SCHOOL_SALARY_BANK.ifsc,
    salaryAccountLabel: "Salary account — Union Bank Murdaha Bazar",
  };
}

export function normalizeSalarySettings(
  s?: Partial<SalarySettings> | null,
): SalarySettings {
  const d = defaultSalarySettings();
  const dayCount = Number(s?.dayCount);
  const cutoffDay = Number(s?.cutoffDay);
  const payDay = Number(s?.payDay);
  const bankName = String(s?.salaryBankName ?? "").trim();
  const bankIfsc = String(s?.salaryBankIfsc ?? "")
    .trim()
    .toUpperCase();
  const bankBranch = String(s?.salaryBankBranch ?? "").trim();
  return {
    dayCount:
      Number.isFinite(dayCount) && dayCount >= 1 && dayCount <= 31
        ? Math.round(dayCount)
        : d.dayCount,
    cutoffDay:
      Number.isFinite(cutoffDay) && cutoffDay >= 1 && cutoffDay <= 28
        ? Math.round(cutoffDay)
        : d.cutoffDay,
    payDay:
      Number.isFinite(payDay) && payDay >= 1 && payDay <= 28
        ? Math.round(payDay)
        : d.payDay,
    salaryBankName: bankName || d.salaryBankName,
    salaryBankBranch: bankBranch || d.salaryBankBranch,
    salaryBankAccountNo: String(
      s?.salaryBankAccountNo ?? d.salaryBankAccountNo,
    ),
    salaryBankIfsc: bankIfsc || d.salaryBankIfsc,
    salaryAccountLabel:
      String(s?.salaryAccountLabel ?? d.salaryAccountLabel).trim() ||
      d.salaryAccountLabel,
  };
}

export function seedSalaryHeads(): SalaryHead[] {
  const rows: Omit<SalaryHead, "id">[] = [
    {
      code: "BASIC",
      name: "Basic",
      kind: "earning",
      tallyLedger: "Basic Pay",
      isActive: true,
      sortOrder: 1,
    },
    {
      code: "DA",
      name: "Dearness allowance",
      kind: "earning",
      tallyLedger: "DA",
      isActive: true,
      sortOrder: 2,
    },
    {
      code: "HRA",
      name: "House rent allowance",
      kind: "earning",
      tallyLedger: "HRA",
      isActive: true,
      sortOrder: 3,
    },
    {
      code: "TA",
      name: "Transport allowance",
      kind: "earning",
      tallyLedger: "Transport Allowance",
      isActive: true,
      sortOrder: 4,
    },
    {
      code: "SA",
      name: "Special allowance",
      kind: "earning",
      tallyLedger: "Special Allowance",
      isActive: true,
      sortOrder: 5,
    },
    {
      code: "PF_EE",
      name: "PF (employee)",
      kind: "deduction",
      tallyLedger: "PF Employee",
      isActive: true,
      sortOrder: 10,
    },
    {
      code: "ESIC_EE",
      name: "ESIC (employee)",
      kind: "deduction",
      tallyLedger: "ESIC Employee",
      isActive: true,
      sortOrder: 11,
    },
    {
      code: "PT",
      name: "Professional tax",
      kind: "deduction",
      tallyLedger: "Professional Tax",
      isActive: true,
      sortOrder: 12,
    },
    {
      code: "TDS",
      name: "TDS",
      kind: "deduction",
      tallyLedger: "TDS",
      isActive: true,
      sortOrder: 13,
    },
    {
      code: "ADV",
      name: "Advance recovery",
      kind: "deduction",
      tallyLedger: "Staff Advance",
      isActive: true,
      sortOrder: 14,
    },
    {
      code: "LWP",
      name: "Loss of pay / attendance",
      kind: "deduction",
      tallyLedger: "LWP Deduction",
      isActive: true,
      sortOrder: 15,
    },
    {
      code: "LATE",
      name: "Late / early penalty",
      kind: "deduction",
      tallyLedger: "Attendance Penalty",
      isActive: true,
      sortOrder: 16,
    },
    {
      code: "PF_ER",
      name: "PF (employer)",
      kind: "employer",
      tallyLedger: "PF Employer",
      isActive: true,
      sortOrder: 20,
    },
    {
      code: "ESIC_ER",
      name: "ESIC (employer)",
      kind: "employer",
      tallyLedger: "ESIC Employer",
      isActive: true,
      sortOrder: 21,
    },
  ];
  return rows.map((r) => ({ ...r, id: nid("sh") }));
}

export function seedSalaryStructures(heads: SalaryHead[]): SalaryStructure[] {
  const by = (code: string) => heads.find((h) => h.code === code)?.id || "";
  const teaching: SalaryStructure = {
    id: nid("ss"),
    code: "TEACH_STD",
    name: "Teaching — standard",
    designationId: "",
    category: "",
    stream: "teaching",
    isActive: true,
    note: "Default teaching template",
    lines: [
      { headId: by("BASIC"), calc: "fixed" as const, amount: 25000 },
      { headId: by("DA"), calc: "percent_of_basic" as const, amount: 20 },
      { headId: by("HRA"), calc: "percent_of_basic" as const, amount: 40 },
      { headId: by("TA"), calc: "fixed" as const, amount: 1600 },
      { headId: by("PF_EE"), calc: "percent_of_basic" as const, amount: 12 },
      { headId: by("PF_ER"), calc: "percent_of_basic" as const, amount: 12 },
      { headId: by("ESIC_EE"), calc: "percent_of_basic" as const, amount: 0.75 },
      { headId: by("ESIC_ER"), calc: "percent_of_basic" as const, amount: 3.25 },
      { headId: by("PT"), calc: "fixed" as const, amount: 200 },
    ].filter((l) => l.headId),
  };
  const nonTeach: SalaryStructure = {
    id: nid("ss"),
    code: "NTEACH_STD",
    name: "Non-teaching — standard",
    designationId: "",
    category: "",
    stream: "non_teaching",
    isActive: true,
    note: "Default non-teaching template",
    lines: [
      { headId: by("BASIC"), calc: "fixed" as const, amount: 15000 },
      { headId: by("DA"), calc: "percent_of_basic" as const, amount: 15 },
      { headId: by("HRA"), calc: "percent_of_basic" as const, amount: 30 },
      { headId: by("TA"), calc: "fixed" as const, amount: 1000 },
      { headId: by("PF_EE"), calc: "percent_of_basic" as const, amount: 12 },
      { headId: by("PF_ER"), calc: "percent_of_basic" as const, amount: 12 },
      { headId: by("ESIC_EE"), calc: "percent_of_basic" as const, amount: 0.75 },
      { headId: by("ESIC_ER"), calc: "percent_of_basic" as const, amount: 3.25 },
      { headId: by("PT"), calc: "fixed" as const, amount: 200 },
    ].filter((l) => l.headId),
  };
  return [teaching, nonTeach];
}

export function defaultSalarySetupState(): SalarySetupState {
  const heads = seedSalaryHeads();
  return {
    version: 1,
    settings: defaultSalarySettings(),
    heads,
    structures: seedSalaryStructures(heads),
    staffLinks: [],
  };
}

export function loadSalarySetup(): SalarySetupState {
  if (typeof window === "undefined") return defaultSalarySetupState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = defaultSalarySetupState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<SalarySetupState>;
    const seed = defaultSalarySetupState();
    return {
      version: 1,
      settings: normalizeSalarySettings(parsed.settings),
      heads:
        Array.isArray(parsed.heads) && parsed.heads.length
          ? parsed.heads.map(normalizeHead)
          : seed.heads,
      structures:
        Array.isArray(parsed.structures) && parsed.structures.length
          ? parsed.structures.map(normalizeStructure)
          : seed.structures,
      staffLinks: Array.isArray(parsed.staffLinks)
        ? parsed.staffLinks.map(normalizeLink)
        : [],
    };
  } catch {
    return defaultSalarySetupState();
  }
}

export function saveSalarySetup(state: SalarySetupState) {
  if (!assertModulePermission("payroll", "edit", "saveSalarySetup")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeHead(h: Partial<SalaryHead>): SalaryHead {
  const kind: SalaryHeadKind =
    h.kind === "deduction" || h.kind === "employer" ? h.kind : "earning";
  return {
    id: h.id || nid("sh"),
    code: String(h.code || "").trim().toUpperCase() || "HEAD",
    name: String(h.name || "").trim() || "Head",
    kind,
    tallyLedger: String(h.tallyLedger || h.name || ""),
    isActive: h.isActive !== false,
    sortOrder: Number(h.sortOrder) || 0,
  };
}

function normalizeStructure(s: Partial<SalaryStructure>): SalaryStructure {
  const cat = s.category;
  const category: StaffCategory | "" =
    cat === "permanent" || cat === "contract" || cat === "part_time"
      ? cat
      : "";
  const stream: StaffStream | "" =
    s.stream === "teaching" || s.stream === "non_teaching" ? s.stream : "";
  return {
    id: s.id || nid("ss"),
    code: String(s.code || "").trim().toUpperCase() || "STRUCT",
    name: String(s.name || "").trim() || "Structure",
    designationId: s.designationId || "",
    category,
    stream,
    lines: Array.isArray(s.lines)
      ? s.lines
          .filter((l) => l.headId)
          .map((l) => ({
            headId: l.headId,
            calc: l.calc === "percent_of_basic" ? "percent_of_basic" : "fixed",
            amount: Math.max(0, Number(l.amount) || 0),
          }))
      : [],
    isActive: s.isActive !== false,
    note: String(s.note || ""),
  };
}

function normalizeLink(l: Partial<StaffSalaryLink>): StaffSalaryLink {
  return {
    staffId: String(l.staffId || ""),
    structureId: String(l.structureId || ""),
    basicOverride: Math.max(0, Number(l.basicOverride) || 0),
    statutoryCover: normalizeStatutoryCover(l.statutoryCover),
    effectiveFrom: String(l.effectiveFrom || "").slice(0, 10),
    salaryAccountNote: String(l.salaryAccountNote || ""),
  };
}

/** Build common structure lines from school-entered amounts (Basic + % allowances). */
export function buildStructureLinesFromPack(
  heads: SalaryHead[],
  pack: {
    basic: number;
    daPercent: number;
    hraPercent: number;
    taFixed: number;
    specialFixed: number;
    pfPercent: number;
    ptFixed: number;
  },
): SalaryStructureLine[] {
  const by = (code: string) => heads.find((h) => h.code === code && h.isActive);
  const lines: SalaryStructureLine[] = [];
  const basic = by("BASIC");
  if (basic && pack.basic > 0) {
    lines.push({ headId: basic.id, calc: "fixed", amount: pack.basic });
  }
  const da = by("DA");
  if (da && pack.daPercent > 0) {
    lines.push({
      headId: da.id,
      calc: "percent_of_basic",
      amount: pack.daPercent,
    });
  }
  const hra = by("HRA");
  if (hra && pack.hraPercent > 0) {
    lines.push({
      headId: hra.id,
      calc: "percent_of_basic",
      amount: pack.hraPercent,
    });
  }
  const ta = by("TA");
  if (ta && pack.taFixed > 0) {
    lines.push({ headId: ta.id, calc: "fixed", amount: pack.taFixed });
  }
  const sa = by("SA");
  if (sa && pack.specialFixed > 0) {
    lines.push({ headId: sa.id, calc: "fixed", amount: pack.specialFixed });
  }
  const pfEe = by("PF_EE");
  if (pfEe && pack.pfPercent > 0) {
    lines.push({
      headId: pfEe.id,
      calc: "percent_of_basic",
      amount: pack.pfPercent,
    });
  }
  const pfEr = by("PF_ER");
  if (pfEr && pack.pfPercent > 0) {
    lines.push({
      headId: pfEr.id,
      calc: "percent_of_basic",
      amount: pack.pfPercent,
    });
  }
  const pt = by("PT");
  if (pt && pack.ptFixed > 0) {
    lines.push({ headId: pt.id, calc: "fixed", amount: pack.ptFixed });
  }
  return lines;
}

export function cloneSalaryStructure(
  source: SalaryStructure,
  opts: { code: string; name: string; scalePercent?: number },
): SalaryStructure {
  const scale = (opts.scalePercent ?? 100) / 100;
  return {
    ...source,
    id: nid("ss"),
    code: opts.code.trim().toUpperCase(),
    name: opts.name.trim(),
    lines: source.lines.map((l) => ({
      ...l,
      amount:
        l.calc === "fixed"
          ? Math.round(l.amount * scale)
          : l.amount, // keep % same when scaling fixed components
    })),
    note: source.note
      ? `${source.note} (cloned)`
      : `Cloned from ${source.code}`,
  };
}

export function newSalaryId(prefix: string) {
  return nid(prefix);
}

/** Resolve structure for a staff member (link → stream/category/designation match → first active). */
export function resolveStructureForStaff(
  state: SalarySetupState,
  staff: StaffRecord,
): SalaryStructure | null {
  const link = state.staffLinks.find((l) => l.staffId === staff.id);
  if (link?.structureId) {
    const hit = state.structures.find(
      (s) => s.id === link.structureId && s.isActive,
    );
    if (hit) return hit;
  }
  const active = state.structures.filter((s) => s.isActive);
  const scored = active
    .map((s) => {
      let score = 0;
      if (s.designationId && s.designationId === staff.designationId) score += 4;
      else if (s.designationId) return { s, score: -1 };
      if (s.category && s.category === staff.category) score += 2;
      else if (s.category) return { s, score: -1 };
      if (s.stream && s.stream === staff.stream) score += 1;
      else if (s.stream) return { s, score: -1 };
      return { s, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.s ?? active[0] ?? null;
}

export function computeStructureAmounts(
  state: SalarySetupState,
  structure: SalaryStructure,
  basicOverride = 0,
  statutoryCover: StatutoryCover = "both",
): {
  basic: number;
  earnings: { head: SalaryHead; amount: number }[];
  deductions: { head: SalaryHead; amount: number }[];
  employer: { head: SalaryHead; amount: number }[];
  gross: number;
  totalDeductions: number;
} {
  const cover = normalizeStatutoryCover(statutoryCover);
  const headsById = new Map(state.heads.map((h) => [h.id, h]));
  const basicLine = structure.lines.find((l) => {
    const h = headsById.get(l.headId);
    return h?.code === "BASIC";
  });
  let basic = basicOverride > 0 ? basicOverride : 0;
  if (!basic && basicLine) {
    basic =
      basicLine.calc === "fixed"
        ? basicLine.amount
        : basicLine.amount; // basic itself is fixed
  }

  const earnings: { head: SalaryHead; amount: number }[] = [];
  const deductions: { head: SalaryHead; amount: number }[] = [];
  const employer: { head: SalaryHead; amount: number }[] = [];

  for (const line of structure.lines) {
    const head = headsById.get(line.headId);
    if (!head || !head.isActive) continue;
    if (!headAllowedByStatutory(head.code, cover)) continue;
    const amount =
      head.code === "BASIC" && basicOverride > 0
        ? basicOverride
        : line.calc === "percent_of_basic"
          ? Math.round((basic * line.amount) / 100)
          : line.amount;
    const row = { head, amount };
    if (head.kind === "earning") earnings.push(row);
    else if (head.kind === "deduction") deductions.push(row);
    else employer.push(row);
  }

  const gross = earnings.reduce((s, e) => s + e.amount, 0);
  const totalDeductions = deductions.reduce((s, e) => s + e.amount, 0);
  return {
    basic,
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
  };
}

export function salarySetupCompleteness(state: SalarySetupState): {
  ok: boolean;
  detail: string;
} {
  const heads = state.heads.filter((h) => h.isActive).length;
  const structs = state.structures.filter((s) => s.isActive).length;
  const settings = normalizeSalarySettings(state.settings);
  const bankNamed = !!settings.salaryBankName.trim();
  const bankIfsc = !!settings.salaryBankIfsc.trim();
  const bankAc = !!settings.salaryBankAccountNo.trim();
  const bankOk = bankNamed && bankIfsc;
  const ok = heads >= 3 && structs >= 1 && bankOk;
  return {
    ok,
    detail: `${heads} heads · ${structs} structures · ${settings.salaryBankName || "no bank"} ${settings.salaryBankBranch || ""}${
      bankAc ? " · a/c set" : " · enter salary a/c no."
    }`,
  };
}

export { DEFAULT_AY };
