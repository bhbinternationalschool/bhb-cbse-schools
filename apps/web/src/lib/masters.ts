import { assertModulePermission } from "@/lib/rbacGuard";
import type { FoundationSlice } from "@/lib/foundationMasters";
import {
  ensureFoundationOnMasters,
  defaultFoundationSlice,
  normalizeMastersStaffRoster,
} from "@/lib/foundationMasters";
import { ensureFoundationFeeStructure202627 } from "@/lib/feeStructureFoundation202627";
import { ensurePrimaryFeeStructure202627 } from "@/lib/feeStructurePrimary202627";
import { ensureMiddleFeeStructure202627 } from "@/lib/feeStructureMiddle202627";
import { ensureSecondaryFeeStructure202627 } from "@/lib/feeStructureSecondary202627";
import {
  buildTeacherRosterOntoMasters,
  migrateDemoStaffToTeacherRoster,
} from "@/lib/teacherRosterSeed";
import {
  ncfCartOfferingsReady,
  seedNcfCartOfferings,
} from "@/lib/ncfCartSeed";
import {
  getSchoolMirrorSync,
  scheduleClientSchoolMirrorSync,
  setMirrorSlice,
} from "@/lib/schoolDataMirror";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export type Campus = {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
  address?: string;
  isActive: boolean;
};

export type SchoolClass = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Stage band: PRE_PRIMARY | PRIMARY | MIDDLE | SECONDARY | SENIOR */
  groupCode?: ClassGroupCode;
};

export type ClassGroupCode =
  | "PRE_PRIMARY"
  | "PRIMARY"
  | "MIDDLE"
  | "SECONDARY"
  | "SENIOR";

export type ClassGroupDef = {
  code: ClassGroupCode;
  label: string;
  shortLabel: string;
  /** NEP stage alignment */
  nepHint: string;
  classNames: string[];
};

/** Standard Indian school class bands (Nursery → XII). */
export const CLASS_GROUPS: ClassGroupDef[] = [
  {
    code: "PRE_PRIMARY",
    label: "Pre-Primary",
    shortLabel: "Nur–UKG",
    nepHint: "NCF-FS Balvatika · UP School Readiness",
    classNames: ["Nursery", "LKG", "UKG"],
  },
  {
    code: "PRIMARY",
    label: "Primary",
    shortLabel: "I–V",
    nepHint: "NCF I–II FLN + III–V · UP हमारा परिवेश",
    classNames: ["I", "II", "III", "IV", "V"],
  },
  {
    code: "MIDDLE",
    label: "Middle",
    shortLabel: "VI–VIII",
    nepHint: "NCF Middle · UP Basic upper primary",
    classNames: ["VI", "VII", "VIII"],
  },
  {
    code: "SECONDARY",
    label: "Secondary",
    shortLabel: "IX–X",
    nepHint: "CBSE / NCF Secondary Phase 1",
    classNames: ["IX", "X"],
  },
  {
    code: "SENIOR",
    label: "Senior Secondary",
    shortLabel: "XI–XII",
    nepHint: "CBSE / NCF Secondary Phase 2 (choice)",
    classNames: ["XI", "XII"],
  },
];

export function classGroupCodeForName(name: string): ClassGroupCode {
  const n = name.trim();
  for (const g of CLASS_GROUPS) {
    if (g.classNames.some((c) => c.toLowerCase() === n.toLowerCase())) {
      return g.code;
    }
  }
  // Heuristics for custom names
  const lower = n.toLowerCase();
  if (
    lower.includes("pre") ||
    lower.includes("nursery") ||
    lower.includes("lkg") ||
    lower.includes("ukg") ||
    lower.includes("kg")
  ) {
    return "PRE_PRIMARY";
  }
  return "PRIMARY";
}

export function normalizeSchoolClass(
  c: SchoolClass,
  index = 0,
): SchoolClass {
  return {
    ...c,
    groupCode: c.groupCode ?? classGroupCodeForName(c.name),
    sortOrder: c.sortOrder || index + 1,
  };
}

export function classesInGroup(
  classes: SchoolClass[],
  groupCode: ClassGroupCode,
): SchoolClass[] {
  return classes
    .filter(
      (c) => (c.groupCode ?? classGroupCodeForName(c.name)) === groupCode,
    )
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export type Section = {
  id: string;
  classId: string;
  name: string;
  isActive: boolean;
};

/** Fee head category code (masters-managed; not a fixed enum). */
export type FeeHeadCategory = string;

export type FeeHeadCategoryDef = {
  id: string;
  code: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
};

export type FeeFrequency =
  | "one_time"
  | "monthly"
  | "quarterly"
  | "half_yearly"
  | "annual"
  | "as_needed";

export type FeeHead = {
  id: string;
  code: string;
  nameEn: string;
  nameHi?: string;
  /** References FeeHeadCategoryDef.code */
  category: FeeHeadCategory;
  frequency: FeeFrequency;
  isOptional: boolean;
  /**
   * Refundable heads (e.g. security / caution deposit) can be returned on TC/exit.
   * Default false = non-refundable fee.
   */
  isRefundable: boolean;
  isActive: boolean;
  sortOrder: number;
};

/** NEW = admission bundle; PROMOTE = continuing; MID_YEAR = join mid-session */
export type FeeStudentType = "NEW" | "PROMOTE" | "MID_YEAR" | "RTE";

export type FeeGroup = {
  id: string;
  code: string;
  name: string;
  academicYearCode: string;
  studentType: FeeStudentType;
  /** Empty = all classes */
  classIds: string[];
  isActive: boolean;
  /** When structure was last published for Fee Take visibility */
  structurePublishedAt: string | null;
  structurePublishedBy: string;
};

export type FeeStructureLine = {
  id: string;
  feeGroupId: string;
  feeHeadId: string;
  /** null = all classes in the group */
  classId: string | null;
  amountPaise: number;
  /** Which installment this line bills on; null = first / as configured */
  installmentId: string | null;
};

export type FeeInstallment = {
  id: string;
  academicYearCode: string;
  code: string;
  label: string;
  dueOn: string; // YYYY-MM-DD IST calendar
  sortOrder: number;
  isActive: boolean;
};

export type LateFeeMode = "flat" | "percent";

export type LateFeeRule = {
  id: string;
  academicYearCode: string;
  graceDays: number;
  mode: LateFeeMode;
  /** Flat amount in paise, or percent × 100 (e.g. 200 = 2%) */
  value: number;
  /** Primary / first selected head (legacy + display) */
  feeHeadId: string;
  /** Fee heads late fee applies to / posts against (multi-select) */
  feeHeadIds: string[];
  maxAmountPaise: number | null;
  isActive: boolean;
};

/** Demo SIS roster until full Students module lands */
export type DemoStudent = {
  id: string;
  admissionNo: string;
  fullName: string;
  classId: string;
  sectionId: string;
  status: "active" | "inactive";
};

/** §6b Special / misc fee definition */
export type SpecialFee = {
  id: string;
  code: string;
  name: string;
  feeHeadId: string;
  academicYearCode: string;
  amountPaise: number;
  dueOn: string;
  reason: string;
  isActive: boolean;
};

/** Who owes this special fee */
export type SpecialFeeAssignment = {
  id: string;
  specialFeeId: string;
  classIds: string[];
  studentIds: string[];
  /** classes = all in selected classes; students = only listed; mixed = union */
  scope: "classes" | "students" | "mixed";
  createdAt: string;
};

/** Foundation §8.5 concession policy kinds — extensible master list */
export type ConcessionKindDef = {
  id: string;
  code: string;
  label: string;
  /** Built-in kinds cannot be deleted */
  isSystem: boolean;
};

export type ConcessionValueMode = "percent" | "fixed";

/** Sibling discount by child ordinal (2 = 2nd child, 3 = 3rd, …). */
export type SiblingConcessionTier = {
  childNo: number;
  mode: ConcessionValueMode;
  value: number;
};

/** Master concession rule (policy) — student grants land in Fee Take later */
export type ConcessionRule = {
  id: string;
  code: string;
  name: string;
  /** References ConcessionKindDef.code */
  kind: string;
  academicYearCode: string;
  mode: ConcessionValueMode;
  /**
   * percent → whole percent (10 = 10%);
   * fixed → amount in paise
   * Fallback when siblingTiers is empty (or non-sibling kinds).
   */
  value: number;
  /**
   * Sibling kind only: rates for 2nd, 3rd, 4th+ child.
   * Highest tier also covers higher child numbers (4th+).
   */
  siblingTiers: SiblingConcessionTier[];
  /** Empty = all fee heads */
  feeHeadIds: string[];
  /** Auto-approve grant if estimated concession ≤ this (paise). null = always Principal */
  autoApproveMaxPaise: number | null;
  documentationRequired: boolean;
  /** Other concession codes that cannot stack with this */
  incompatibleCodes: string[];
  notes: string;
  isActive: boolean;
};

/** Demo / pending student grants until Fee Take owns this */
export type ConcessionGrant = {
  id: string;
  concessionId: string;
  studentId: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  /**
   * Sibling grants: which child ordinal this discount is for (2, 3, 4…).
   * null = flat rule.value / auto at apply time.
   */
  siblingChildNo: number | null;
};

export type MastersState = {
  version: 2;
  campuses: Campus[];
  classes: SchoolClass[];
  sections: Section[];
  feeHeads: FeeHead[];
  /** Editable fee-head categories (tuition, deposit, custom…). */
  feeHeadCategories: FeeHeadCategoryDef[];
  feeGroups: FeeGroup[];
  feeStructureLines: FeeStructureLine[];
  installments: FeeInstallment[];
  lateFeeRules: LateFeeRule[];
  /** School rules for mid-year join billing */
  midYearFeePolicy: MidYearFeePolicy;
  students: DemoStudent[];
  specialFees: SpecialFee[];
  specialFeeAssignments: SpecialFeeAssignment[];
  concessionKinds: ConcessionKindDef[];
  concessions: ConcessionRule[];
  concessionGrants: ConcessionGrant[];
} & FoundationSlice;

/** Configurable mid-year join fee rules (school decides). */
export type MidYearFeePolicy = {
  /** Skip installment months strictly before the join month */
  skipMonthsBeforeJoin: boolean;
  /** Still bill April academic fees (tuition etc.) even when join is later */
  alwaysBillAprilAcademic: boolean;
  /** Transport only from join month — never for April catch-up or earlier months */
  transportFromJoinMonthOnly: boolean;
  /** Keep admission / annual / one-time heads even if their due month is before join */
  includeOneTimeBeforeJoin: boolean;
};

export const DEFAULT_MID_YEAR_FEE_POLICY: MidYearFeePolicy = {
  skipMonthsBeforeJoin: true,
  alwaysBillAprilAcademic: true,
  transportFromJoinMonthOnly: true,
  includeOneTimeBeforeJoin: true,
};

export function normalizeMidYearFeePolicy(
  p?: Partial<MidYearFeePolicy> | null,
): MidYearFeePolicy {
  return {
    skipMonthsBeforeJoin: p?.skipMonthsBeforeJoin ?? true,
    alwaysBillAprilAcademic: p?.alwaysBillAprilAcademic ?? true,
    transportFromJoinMonthOnly: p?.transportFromJoinMonthOnly ?? true,
    includeOneTimeBeforeJoin: p?.includeOneTimeBeforeJoin ?? true,
  };
}

const FEE_STUDENT_TYPE_ORDER: Record<FeeStudentType, number> = {
  NEW: 0,
  PROMOTE: 1,
  MID_YEAR: 2,
  RTE: 3,
};

/**
 * Rank a fee group by the earliest class band it covers
 * (Pre-Primary → … → Senior). Empty classIds (“all”) ranks last.
 */
export function feeGroupClassBandRank(
  state: MastersState,
  group: FeeGroup,
): number {
  if (!group.classIds?.length) return CLASS_GROUPS.length;
  let min = CLASS_GROUPS.length;
  for (const id of group.classIds) {
    const cls = state.classes.find((c) => c.id === id);
    if (!cls) continue;
    const code = cls.groupCode ?? classGroupCodeForName(cls.name);
    const idx = CLASS_GROUPS.findIndex((g) => g.code === code);
    if (idx >= 0 && idx < min) min = idx;
  }
  return min;
}

/** All class-band indexes a fee group covers (ascending). Empty = all classes. */
export function feeGroupClassBandRanks(
  state: MastersState,
  group: FeeGroup,
): number[] {
  if (!group.classIds?.length) return [];
  const found = new Set<number>();
  for (const id of group.classIds) {
    const cls = state.classes.find((c) => c.id === id);
    if (!cls) continue;
    const code = cls.groupCode ?? classGroupCodeForName(cls.name);
    const idx = CLASS_GROUPS.findIndex((g) => g.code === code);
    if (idx >= 0) found.add(idx);
  }
  return [...found].sort((a, b) => a - b);
}

/** Sort fee groups: class band → student type → name. */
export function sortFeeGroupsByClassBand(
  state: MastersState,
  groups: FeeGroup[] = state.feeGroups,
): FeeGroup[] {
  return groups.slice().sort((a, b) => {
    const ra = feeGroupClassBandRank(state, a);
    const rb = feeGroupClassBandRank(state, b);
    if (ra !== rb) return ra - rb;
    const ta = FEE_STUDENT_TYPE_ORDER[a.studentType] ?? 99;
    const tb = FEE_STUDENT_TYPE_ORDER[b.studentType] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  });
}

/** Class ids ordered by CLASS_GROUPS then class sortOrder. */
export function sortClassIdsByClassBand(
  state: MastersState,
  classIds: string[],
): string[] {
  const order = CLASS_GROUPS.flatMap((g) =>
    classesInGroup(state.classes, g.code).map((c) => c.id),
  );
  const rank = new Map(order.map((id, i) => [id, i]));
  return classIds.slice().sort((a, b) => {
    const ia = rank.get(a) ?? 9999;
    const ib = rank.get(b) ?? 9999;
    return ia - ib;
  });
}

/** Label for bands a fee group covers (e.g. "Nur–UKG · I–V"). */
export function feeGroupClassBandLabel(
  state: MastersState,
  group: FeeGroup,
): string {
  const ranks = feeGroupClassBandRanks(state, group);
  if (!ranks.length) return "All classes";
  return ranks
    .map((i) => CLASS_GROUPS[i]?.shortLabel ?? CLASS_GROUPS[i]?.label)
    .filter(Boolean)
    .join(" · ");
}

/**
 * Bucket fee groups into every CLASS_GROUPS section (Pre-Primary → Senior),
 * then an “All classes” bucket. A group appears once under its earliest band.
 * Empty bands are still returned so the UI shows full serial order.
 */
export function groupFeeGroupsByClassBand(
  state: MastersState,
  groups: FeeGroup[] = state.feeGroups,
): { key: string; label: string; shortLabel: string; groups: FeeGroup[] }[] {
  const sorted = sortFeeGroupsByClassBand(state, groups);
  const sections = CLASS_GROUPS.map((g) => ({
    key: g.code,
    label: g.label,
    shortLabel: g.shortLabel,
    groups: [] as FeeGroup[],
  }));
  const allSection = {
    key: "ALL",
    label: "All classes",
    shortLabel: "All",
    groups: [] as FeeGroup[],
  };

  for (const group of sorted) {
    const ranks = feeGroupClassBandRanks(state, group);
    if (!ranks.length) {
      allSection.groups.push(group);
      continue;
    }
    const earliest = ranks[0]!;
    sections[earliest]?.groups.push(group);
  }

  return allSection.groups.length
    ? [...sections, allSection]
    : sections;
}

const STORAGE_KEY = "bhb_masters_v5";
const LEGACY_KEYS = [
  "bhb_masters_v4",
  "bhb_masters_v3",
  "bhb_masters_v2",
  "bhb_masters_v1",
];
export const DEFAULT_AY = "2025-26";

export type SessionYearOption = {
  code: string;
  label: string;
  status: "current" | "closed" | "upcoming";
};

/**
 * Active “current” academic year from Masters (Academics tab).
 * Falls back to DEFAULT_AY when masters are unavailable (SSR / empty).
 */
export function currentAcademicYearCode(
  state?: MastersState | null,
): string {
  const m =
    state ??
    (typeof window !== "undefined" ? loadMasters() : null);
  if (!m?.academicYears?.length) return DEFAULT_AY;
  const cur = m.academicYears.find(
    (y) => y.status === "current" && y.isActive !== false,
  );
  return cur?.code ?? DEFAULT_AY;
}

/**
 * The current academic year, or null when Masters has not been read yet.
 *
 * The strict counterpart to currentAcademicYearCode, which returns DEFAULT_AY
 * ("2025-26") for "I don't know". That fallback is a guess, and a guess must
 * never be written anywhere durable. On 2026-08-10 a frozen desk held no
 * academic years, so currentAcademicYearCode returned 2025-26 and the session
 * aligner PATCHed that fabrication into the signed SERVER cookie, where it
 * outlived the empty desk that produced it. The school ran in a session that
 * had ended on 2026-03-31, and every scoped query went with it — while the
 * database plainly said 2026-27 was `status: 'current'`.
 *
 * Use this anywhere the answer leaves the browser. Keep currentAcademicYearCode
 * for display paths that genuinely need a string; the fallback is being retired
 * bucket by bucket (see LEGACY_FALLBACK_AY in docs/TODO.md).
 */
export function resolvedAcademicYearCode(
  state?: MastersState | null,
): string | null {
  const m =
    state ??
    (typeof window !== "undefined" ? loadMasters() : null);
  if (!m?.academicYears?.length) return null;
  const cur = m.academicYears.find(
    (y) => y.status === "current" && y.isActive !== false,
  );
  return cur?.code ?? null;
}

/** Years for header Session selector and import pickers — from Masters. */
export function listSessionYearOptions(
  state?: MastersState | null,
): SessionYearOption[] {
  const m =
    state ??
    (typeof window !== "undefined" ? loadMasters() : null);
  if (!m?.academicYears?.length) {
    // Nothing is known, so claim nothing. This used to return DEFAULT_AY
    // labelled `status: "current"`, which is what rendered "2025-26 · Current"
    // in the header on a desk that had never loaded a single academic year.
    // The selector falls back to the session's own code when this is empty,
    // which shows what the session actually is instead of asserting a year.
    return [];
  }
  return m.academicYears
    .filter((y) => y.isActive !== false)
    .slice()
    .sort((a, b) => b.code.localeCompare(a.code))
    .map((y) => ({
      code: y.code,
      label: y.label || y.code,
      status: y.status,
    }));
}

/** Push workspace header/session cookie to match Masters current (or any code). */
export async function syncWorkspaceAcademicYear(
  academicYearCode: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const res = await fetch("/api/session/ay", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ academicYearCode }),
  });
  return res.ok;
}

/** Academic session months April → March (Indian school year). */
export const SESSION_MONTHS: {
  code: string;
  label: string;
  month: number; // 1–12 calendar month
}[] = [
  { code: "APR", label: "April", month: 4 },
  { code: "MAY", label: "May", month: 5 },
  { code: "JUN", label: "June", month: 6 },
  { code: "JUL", label: "July", month: 7 },
  { code: "AUG", label: "August", month: 8 },
  { code: "SEP", label: "September", month: 9 },
  { code: "OCT", label: "October", month: 10 },
  { code: "NOV", label: "November", month: 11 },
  { code: "DEC", label: "December", month: 12 },
  { code: "JAN", label: "January", month: 1 },
  { code: "FEB", label: "February", month: 2 },
  { code: "MAR", label: "March", month: 3 },
];

export type InstallmentPattern = "monthly" | "quarterly" | "half_yearly";

export function sessionStartYear(ayCode: string): number {
  const y = Number(ayCode.split("-")[0]);
  return Number.isFinite(y) ? y : 2025;
}

/** Due date `YYYY-MM-DD` for a session month (default day 10). */
export function dueOnForSessionMonth(
  ayCode: string,
  calendarMonth: number,
  day = 10,
): string {
  const start = sessionStartYear(ayCode);
  const year = calendarMonth >= 4 ? start : start + 1;
  return `${year}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildSessionInstallments(
  ayCode: string,
  pattern: InstallmentPattern = "monthly",
): FeeInstallment[] {
  const activeCodes =
    pattern === "monthly"
      ? new Set(SESSION_MONTHS.map((m) => m.code))
      : pattern === "quarterly"
        ? new Set(["APR", "JUL", "OCT", "JAN"])
        : new Set(["APR", "OCT"]);

  return SESSION_MONTHS.map((m, i) => ({
    id: id("inst"),
    academicYearCode: ayCode,
    code: m.code,
    label: m.label,
    dueOn: dueOnForSessionMonth(ayCode, m.month, 10),
    sortOrder: i + 1,
    isActive: activeCodes.has(m.code),
  }));
}

/** Ensure all Apr–Mar rows exist for AY; keep existing ids/amounts links. */
export function ensureAprToMarInstallments(
  state: MastersState,
  ayCode = DEFAULT_AY,
): MastersState {
  const existing = state.installments.filter(
    (i) => i.academicYearCode === ayCode,
  );
  const byCode = new Map(existing.map((i) => [i.code, i]));
  const merged: FeeInstallment[] = SESSION_MONTHS.map((m, i) => {
    const prev = byCode.get(m.code);
    if (prev) {
      return {
        ...prev,
        label: m.label,
        dueOn: prev.dueOn || dueOnForSessionMonth(ayCode, m.month),
        sortOrder: i + 1,
      };
    }
    return {
      id: id("inst"),
      academicYearCode: ayCode,
      code: m.code,
      label: m.label,
      dueOn: dueOnForSessionMonth(ayCode, m.month),
      sortOrder: i + 1,
      isActive: true, // monthly by default
    };
  });
  const otherYears = state.installments.filter(
    (i) => i.academicYearCode !== ayCode,
  );
  return { ...state, installments: [...otherYears, ...merged] };
}

export function applyInstallmentPattern(
  state: MastersState,
  pattern: InstallmentPattern,
  ayCode = DEFAULT_AY,
): MastersState {
  const withMonths = ensureAprToMarInstallments(state, ayCode);
  const activeCodes =
    pattern === "monthly"
      ? new Set(SESSION_MONTHS.map((m) => m.code))
      : pattern === "quarterly"
        ? new Set(["APR", "JUL", "OCT", "JAN"])
        : new Set(["APR", "OCT"]);

  return {
    ...withMonths,
    installments: withMonths.installments.map((i) =>
      i.academicYearCode !== ayCode
        ? i
        : { ...i, isActive: activeCodes.has(i.code) },
    ),
  };
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

/** Compact INR for dashboard KPIs (₹1.2L, ₹3.4Cr). */
export function formatInrCompact(paise: number): string {
  const rupees = paise / 100;
  if (!Number.isFinite(rupees)) return "₹0";
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) {
    return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `₹${(rupees / 1_00_000).toFixed(2)} L`;
  }
  if (abs >= 10_000) {
    return `₹${(rupees / 1_000).toFixed(1)}k`;
  }
  return formatInr(paise);
}

export function parseInrToPaise(raw: string): number {
  const n = Number(String(raw).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function buildClasses() {
  const classNames = CLASS_GROUPS.flatMap((g) => g.classNames);
  const classes: SchoolClass[] = classNames.map((name, i) => ({
    id: id("cls"),
    name,
    sortOrder: i + 1,
    isActive: true,
    groupCode: classGroupCodeForName(name),
  }));
  const sections: Section[] = classes.flatMap((c) =>
    ["A", "B"].map((name) => ({
      id: id("sec"),
      classId: c.id,
      name,
      isActive: true,
    })),
  );
  return { classes, sections };
}

function buildFeeHeads(): FeeHead[] {
  const rows: Omit<FeeHead, "id">[] = [
    {
      code: "TUITION",
      nameEn: "Tuition Fee",
      nameHi: "शिक्षा शुल्क",
      category: "tuition",
      frequency: "monthly",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 10,
    },
    {
      code: "ADMISSION",
      nameEn: "Admission Fee",
      nameHi: "प्रवेश शुल्क",
      category: "admission",
      frequency: "one_time",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 20,
    },
    {
      code: "ANNUAL",
      nameEn: "Annual Charges",
      nameHi: "वार्षिक शुल्क",
      category: "annual",
      frequency: "annual",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 30,
    },
    {
      code: "EXAM",
      nameEn: "Examination Fee",
      nameHi: "परीक्षा शुल्क",
      category: "exam",
      frequency: "as_needed",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 40,
    },
    {
      code: "TRANSPORT",
      nameEn: "Transport Fee",
      nameHi: "परिवहन शुल्क",
      category: "transport",
      frequency: "monthly",
      isOptional: true,
      isRefundable: false,
      isActive: true,
      sortOrder: 50,
    },
    {
      code: "COMPUTER",
      nameEn: "Computer Fee",
      nameHi: "कंप्यूटर शुल्क",
      category: "computer",
      frequency: "monthly",
      isOptional: true,
      isRefundable: false,
      isActive: true,
      sortOrder: 60,
    },
    {
      code: "LAB",
      nameEn: "Lab Fee",
      nameHi: "प्रयोगशाला शुल्क",
      category: "lab",
      frequency: "annual",
      isOptional: true,
      isRefundable: false,
      isActive: true,
      sortOrder: 70,
    },
    {
      code: "LIBRARY",
      nameEn: "Library Fee",
      nameHi: "पुस्तकालय शुल्क",
      category: "library",
      frequency: "annual",
      isOptional: true,
      isRefundable: false,
      isActive: true,
      sortOrder: 80,
    },
    {
      code: "DEV",
      nameEn: "Development Fee",
      nameHi: "विकास शुल्क",
      category: "development",
      frequency: "annual",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 90,
    },
    {
      code: "SECURITY",
      nameEn: "Security Deposit",
      nameHi: "सुरक्षा जमा",
      category: "deposit",
      frequency: "one_time",
      isOptional: false,
      isRefundable: true,
      isActive: true,
      sortOrder: 95,
    },
    {
      code: "LATE",
      nameEn: "Late Fee",
      nameHi: "विलंब शुल्क",
      category: "late_fee",
      frequency: "as_needed",
      isOptional: false,
      isRefundable: false,
      isActive: true,
      sortOrder: 100,
    },
    {
      code: "CERT",
      nameEn: "Certificate Fee",
      nameHi: "प्रमाणपत्र शुल्क",
      category: "certificate",
      frequency: "as_needed",
      isOptional: true,
      isRefundable: false,
      isActive: true,
      sortOrder: 110,
    },
  ];
  return rows.map((r) => ({ ...r, id: id("fh") }));
}

function bandIds(
  classes: SchoolClass[],
  names: string[],
): string[] {
  return classes.filter((c) => names.includes(c.name)).map((c) => c.id);
}

export function defaultMasters(): MastersState {
  const { classes, sections } = buildClasses();
  const feeHeads = buildFeeHeads();
  const byCode = (code: string) => feeHeads.find((f) => f.code === code)!;

  const installments = buildSessionInstallments(DEFAULT_AY, "monthly");
  const byInst = (code: string) => installments.find((i) => i.code === code)!;

  const primary = bandIds(classes, [
    "Nursery",
    "LKG",
    "UKG",
    "I",
    "II",
    "III",
    "IV",
    "V",
  ]);
  const middle = bandIds(classes, ["VI", "VII", "VIII"]);
  const secondary = bandIds(classes, ["IX", "X"]);
  const senior = bandIds(classes, ["XI", "XII"]);

  const feeGroups: FeeGroup[] = [
    {
      id: id("fg"),
      code: "NEW_PRIMARY",
      name: "New admission · Nursery–V",
      academicYearCode: DEFAULT_AY,
      studentType: "NEW",
      classIds: primary,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "PROMOTE_PRIMARY",
      name: "Promoted · Nursery–V",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      classIds: primary,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "NEW_MIDDLE",
      name: "New admission · VI–VIII",
      academicYearCode: DEFAULT_AY,
      studentType: "NEW",
      classIds: middle,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "PROMOTE_MIDDLE",
      name: "Promoted · VI–VIII",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      classIds: middle,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "NEW_SEC",
      name: "New admission · IX–X",
      academicYearCode: DEFAULT_AY,
      studentType: "NEW",
      classIds: secondary,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "PROMOTE_SEC",
      name: "Promoted · IX–X",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      classIds: secondary,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "NEW_SR",
      name: "New admission · XI–XII",
      academicYearCode: DEFAULT_AY,
      studentType: "NEW",
      classIds: senior,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
    {
      id: id("fg"),
      code: "PROMOTE_SR",
      name: "Promoted · XI–XII",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      classIds: senior,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    },
  ];

  const R = (n: number) => n * 100;
  const feeStructureLines: FeeStructureLine[] = [];

  function addBundle(
    group: FeeGroup,
    amounts: {
      admission?: number;
      annual: number;
      tuitionM: number;
      exam: number;
      development: number;
      security?: number;
    },
  ) {
    const lines: [string, number, string][] = [];
    if (group.studentType === "NEW" && amounts.admission) {
      lines.push([byCode("ADMISSION").id, amounts.admission, byInst("APR").id]);
    }
    if (group.studentType === "NEW" && amounts.security) {
      lines.push([byCode("SECURITY").id, amounts.security, byInst("APR").id]);
    }
    lines.push(
      [byCode("ANNUAL").id, amounts.annual, byInst("APR").id],
      [byCode("DEV").id, amounts.development, byInst("APR").id],
      [byCode("EXAM").id, amounts.exam, byInst("OCT").id],
    );
    for (const inst of installments) {
      lines.push([byCode("TUITION").id, amounts.tuitionM, inst.id]);
    }
    for (const [feeHeadId, rupees, installmentId] of lines) {
      feeStructureLines.push({
        id: id("fsl"),
        feeGroupId: group.id,
        feeHeadId,
        classId: null,
        amountPaise: R(rupees),
        installmentId,
      });
    }
  }

  const byGroup = (code: string) => feeGroups.find((g) => g.code === code)!;
  addBundle(byGroup("NEW_PRIMARY"), {
    admission: 5000,
    security: 2000,
    annual: 3500,
    tuitionM: 1500,
    exam: 800,
    development: 1500,
  });
  addBundle(byGroup("PROMOTE_PRIMARY"), {
    annual: 3500,
    tuitionM: 1500,
    exam: 800,
    development: 1500,
  });
  addBundle(byGroup("NEW_MIDDLE"), {
    admission: 6000,
    security: 2500,
    annual: 4000,
    tuitionM: 1850,
    exam: 1000,
    development: 2000,
  });
  addBundle(byGroup("PROMOTE_MIDDLE"), {
    annual: 4000,
    tuitionM: 1850,
    exam: 1000,
    development: 2000,
  });
  addBundle(byGroup("NEW_SEC"), {
    admission: 8000,
    security: 3000,
    annual: 5000,
    tuitionM: 2350,
    exam: 1500,
    development: 2500,
  });
  addBundle(byGroup("PROMOTE_SEC"), {
    annual: 5000,
    tuitionM: 2350,
    exam: 1500,
    development: 2500,
  });
  addBundle(byGroup("NEW_SR"), {
    admission: 10000,
    security: 5000,
    annual: 6000,
    tuitionM: 3000,
    exam: 2000,
    development: 3000,
  });
  addBundle(byGroup("PROMOTE_SR"), {
    annual: 6000,
    tuitionM: 3000,
    exam: 2000,
    development: 3000,
  });

  const lateFeeRules: LateFeeRule[] = [
    {
      id: id("lfr"),
      academicYearCode: DEFAULT_AY,
      graceDays: 7,
      mode: "flat",
      value: R(100),
      feeHeadId: byCode("LATE").id,
      /** Empty = apply to all overdue heads; LATE id is posting head only */
      feeHeadIds: [],
      maxAmountPaise: R(500),
      isActive: true,
    },
  ];

  const students = buildDemoStudents(classes, sections);

  const examHead = byCode("EXAM");
  const certHead = byCode("CERT");
  const specialFees: SpecialFee[] = [
    {
      id: id("spf"),
      code: "EXAM_HY",
      name: "Exam fee — Half yearly",
      feeHeadId: examHead.id,
      academicYearCode: DEFAULT_AY,
      amountPaise: R(500),
      dueOn: "2025-09-15",
      reason: "Half-yearly examination 2025-26",
      isActive: true,
    },
    {
      id: id("spf"),
      code: "BONAFIDE",
      name: "Bonafide certificate fee",
      feeHeadId: certHead.id,
      academicYearCode: DEFAULT_AY,
      amountPaise: R(100),
      dueOn: "2025-04-30",
      reason: "On request / certificate issue",
      isActive: true,
    },
  ];

  const tuitionId = byCode("TUITION").id;
  const transportId = byCode("TRANSPORT").id;
  const admissionId = byCode("ADMISSION").id;

  const concessions: ConcessionRule[] = [
    {
      id: id("cnc"),
      code: "SIBLING",
      name: "Sibling discount",
      kind: "sibling",
      academicYearCode: DEFAULT_AY,
      mode: "percent",
      value: 10,
      siblingTiers: [
        { childNo: 2, mode: "percent", value: 10 },
        { childNo: 3, mode: "percent", value: 15 },
        { childNo: 4, mode: "percent", value: 20 },
      ],
      feeHeadIds: [tuitionId],
      autoApproveMaxPaise: R(5000),
      documentationRequired: false,
      incompatibleCodes: ["STAFF"],
      notes: "2nd 10% · 3rd 15% · 4th+ 20% on tuition",
      isActive: true,
    },
    {
      id: id("cnc"),
      code: "STAFF",
      name: "Staff ward",
      kind: "staff_ward",
      academicYearCode: DEFAULT_AY,
      mode: "percent",
      value: 50,
      siblingTiers: [],
      feeHeadIds: [tuitionId],
      autoApproveMaxPaise: R(20000),
      documentationRequired: true,
      incompatibleCodes: ["SIBLING"],
      notes: "Staff child · HR letter required",
      isActive: true,
    },
    {
      id: id("cnc"),
      code: "RTE",
      name: "RTE / EWS free-ship",
      kind: "rte_ews",
      academicYearCode: DEFAULT_AY,
      mode: "percent",
      value: 100,
      siblingTiers: [],
      feeHeadIds: [tuitionId, admissionId],
      autoApproveMaxPaise: null,
      documentationRequired: true,
      incompatibleCodes: [],
      notes: "Principal + documentation · UP RTE rules",
      isActive: true,
    },
    {
      id: id("cnc"),
      code: "MERIT",
      name: "Merit scholarship",
      kind: "merit",
      academicYearCode: DEFAULT_AY,
      mode: "percent",
      value: 25,
      siblingTiers: [],
      feeHeadIds: [tuitionId],
      autoApproveMaxPaise: null,
      documentationRequired: true,
      incompatibleCodes: [],
      notes: "Principal approval required",
      isActive: true,
    },
    {
      id: id("cnc"),
      code: "HARDSHIP",
      name: "Management / hardship",
      kind: "hardship",
      academicYearCode: DEFAULT_AY,
      mode: "fixed",
      value: R(0),
      siblingTiers: [],
      feeHeadIds: [tuitionId],
      autoApproveMaxPaise: null,
      documentationRequired: true,
      incompatibleCodes: [],
      notes: "Case-by-case fixed amount · Principal",
      isActive: true,
    },
    {
      id: id("cnc"),
      code: "TRANSPORT",
      name: "Transport concession",
      kind: "transport",
      academicYearCode: DEFAULT_AY,
      mode: "percent",
      value: 20,
      siblingTiers: [],
      feeHeadIds: [transportId],
      autoApproveMaxPaise: R(2000),
      documentationRequired: false,
      incompatibleCodes: [],
      notes: "On transport head only",
      isActive: true,
    },
  ];

  const base: MastersState = {
    version: 2,
    campuses: [
      {
        id: id("cam"),
        code: "MAIN",
        name: "Main Campus",
        isPrimary: true,
        address: "Varanasi, Uttar Pradesh",
        isActive: true,
      },
    ],
    classes,
    sections,
    feeHeads,
    feeHeadCategories: defaultFeeHeadCategories(),
    feeGroups,
    feeStructureLines,
    installments,
    lateFeeRules,
    midYearFeePolicy: DEFAULT_MID_YEAR_FEE_POLICY,
    students,
    specialFees,
    specialFeeAssignments: [],
    concessionKinds: defaultConcessionKinds(),
    concessions,
    concessionGrants: [],
    ...defaultFoundationSlice(classes),
  };
  // Real Teacher.xlsx roster (not EMP-001 demo placeholders)
  return buildTeacherRosterOntoMasters({ ...base, staff: [] });
}

/** Go-live empty slate — session shell only; no demo classes, fees, staff, or depts. */
export function emptyMastersShell(): MastersState {
  const foundation = defaultFoundationSlice([]);
  return {
    ...foundation,
    version: 2 as const,
    campuses: [
      {
        id: id("cam"),
        code: "MAIN",
        name: "Main Campus",
        isPrimary: true,
        isActive: true,
      },
    ],
    feeHeadCategories: defaultFeeHeadCategories(),
    classes: [],
    sections: [],
    feeHeads: [],
    feeGroups: [],
    feeStructureLines: [],
    installments: [],
    lateFeeRules: [],
    midYearFeePolicy: DEFAULT_MID_YEAR_FEE_POLICY,
    students: [],
    specialFees: [],
    specialFeeAssignments: [],
    concessionKinds: defaultConcessionKinds(),
    concessions: [],
    concessionGrants: [],
    subjects: [],
    classSubjects: [],
    staff: [],
    departments: [],
    designations: [],
    holidays: [],
    academicTerms: [],
  };
}

export function defaultFeeHeadCategories(): FeeHeadCategoryDef[] {
  const seed: { code: string; label: string }[] = [
    { code: "tuition", label: "Tuition" },
    { code: "admission", label: "Admission" },
    { code: "exam", label: "Exam" },
    { code: "transport", label: "Transport" },
    { code: "annual", label: "Annual" },
    { code: "development", label: "Development" },
    { code: "lab", label: "Lab" },
    { code: "computer", label: "Computer" },
    { code: "library", label: "Library" },
    { code: "deposit", label: "Deposit / security" },
    { code: "late_fee", label: "Late fee" },
    { code: "certificate", label: "Certificate" },
    { code: "misc", label: "Misc" },
  ];
  return seed.map((s, i) => ({
    id: `fhc_${s.code}`,
    code: s.code,
    label: s.label,
    isActive: true,
    sortOrder: (i + 1) * 10,
  }));
}

/** Active categories for dropdowns; seeds defaults when empty. */
export function resolveFeeHeadCategories(
  state: MastersState | null | undefined,
): FeeHeadCategoryDef[] {
  const list =
    state?.feeHeadCategories?.length
      ? state.feeHeadCategories.map(normalizeFeeHeadCategory)
      : defaultFeeHeadCategories();
  return list
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function normalizeFeeHeadCategory(
  c: Partial<FeeHeadCategoryDef> & { id: string },
): FeeHeadCategoryDef {
  return {
    id: c.id,
    code: (c.code ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "misc",
    label: (c.label ?? "").trim() || c.code || "Category",
    isActive: c.isActive !== false,
    sortOrder: c.sortOrder ?? 0,
  };
}

export function feeHeadCategoryLabel(
  state: MastersState | null | undefined,
  code: string,
): string {
  const hit = resolveFeeHeadCategories(state).find(
    (c) => c.code === code || c.code === code?.toLowerCase(),
  );
  return hit?.label ?? code ?? "—";
}

/** @deprecated Use resolveFeeHeadCategories(state) — kept for older imports. */
export const FEE_CATEGORIES: { value: string; label: string }[] =
  defaultFeeHeadCategories().map((c) => ({
    value: c.code,
    label: c.label,
  }));

export function checkFeeHeadCategoryRemoval(
  state: MastersState,
  categoryId: string,
): RemovalCheck {
  const cat = resolveFeeHeadCategories(state).find((c) => c.id === categoryId);
  const label = cat?.label ?? "this category";
  const usedN = (state.feeHeads ?? []).filter(
    (h) => h.category === cat?.code,
  ).length;
  if (usedN > 0) {
    return {
      canRemove: false,
      blockers: [`${usedN} fee head(s)`],
      suggestion: `Linked to ${usedN} fee head(s). Reassign those heads first, or use Inactivate.`,
      confirmMessage: `Remove category “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Unused categories can be removed.",
    confirmMessage: `Remove category “${label}”?`,
  };
}

export function removeFeeHeadCategory(
  state: MastersState,
  categoryId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkFeeHeadCategoryRemoval(state, categoryId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      feeHeadCategories: resolveFeeHeadCategories(state).filter(
        (c) => c.id !== categoryId,
      ),
    },
  };
}

export function defaultConcessionKinds(): ConcessionKindDef[] {
  return SYSTEM_CONCESSION_KINDS.map((k) => ({
    id: `ck_sys_${k.code}`,
    code: k.code,
    label: k.label,
    isSystem: true,
  }));
}

/** Built-in kinds (always available); schools can add custom kinds. */
export const SYSTEM_CONCESSION_KINDS: { code: string; label: string }[] = [
  { code: "sibling", label: "Sibling" },
  { code: "staff_ward", label: "Staff ward" },
  { code: "rte_ews", label: "RTE / EWS" },
  { code: "merit", label: "Merit scholarship" },
  { code: "hardship", label: "Hardship / management" },
  { code: "transport", label: "Transport" },
  { code: "other", label: "Other" },
];

export function resolveConcessionKinds(
  state: MastersState,
): ConcessionKindDef[] {
  const kinds = state.concessionKinds?.length
    ? [...state.concessionKinds]
    : defaultConcessionKinds();
  const codes = new Set(kinds.map((k) => k.code));
  for (const sys of SYSTEM_CONCESSION_KINDS) {
    if (!codes.has(sys.code)) {
      kinds.push({
        id: `ck_sys_${sys.code}`,
        code: sys.code,
        label: sys.label,
        isSystem: true,
      });
    }
  }
  return kinds;
}

/** Slim roster mirror of SIS — starts empty for live schools (import or add students). */
function buildDemoStudents(
  _classes: SchoolClass[],
  _sections: Section[],
): DemoStudent[] {
  return [];
}

/** Demo name → class label (for SIS rematch when class ids drift). */
export const DEMO_STUDENT_CLASS_BY_NAME: Record<string, string> = {
  "Rahul Singh": "VI",
  "Ananya Singh": "III",
  "Ananya Gupta": "III", // legacy name → still rematch
  "Kabir Ali": "VI",
  "Meera Joshi": "VIII",
  "Arjun Verma": "VIII",
  "Isha Patel": "III",
  "Dev Sharma": "III",
  "Sara Khan": "III",
  "Rohan Das": "X",
  "Priya Nair": "X",
};

/** Names that share one demo household (siblings). */
export const DEMO_SIBLING_NAMES = ["Rahul Singh", "Ananya Singh"] as const;

/** Rebuild masters.students against current class/section ids (empty when no SIS sync yet). */
export function rebuildDemoRoster(masters: MastersState): MastersState {
  return {
    ...masters,
    students: buildDemoStudents(masters.classes, masters.sections),
  };
}

/**
 * Fix student class/section ids that no longer exist on masters.
 * Does not invent demo people — drops broken slim rows or leaves empty.
 */
export function ensureStudentClassLinks(masters: MastersState): MastersState {
  const classIds = new Set(masters.classes.map((c) => c.id));
  const students = masters.students ?? [];
  if (students.length === 0) return masters;

  const valid = students.filter(
    (s) =>
      classIds.has(s.classId) &&
      masters.sections.some(
        (sec) => sec.id === s.sectionId && sec.classId === s.classId,
      ),
  );
  if (valid.length === students.length) return masters;
  const next = { ...masters, students: valid };
  if (typeof window !== "undefined") saveMasters(next);
  return next;
}

/** Resolve who is covered by a special fee assignment */
export function resolveSpecialFeeAssignees(
  state: MastersState,
  assignment: SpecialFeeAssignment,
): DemoStudent[] {
  const active = state.students.filter((s) => s.status === "active");
  if (assignment.scope === "students") {
    return active.filter((s) => assignment.studentIds.includes(s.id));
  }
  if (assignment.scope === "classes") {
    return active.filter((s) => assignment.classIds.includes(s.classId));
  }
  // mixed = union of class cohort + explicit students
  const fromClass = active.filter((s) =>
    assignment.classIds.includes(s.classId),
  );
  const fromStudents = active.filter((s) =>
    assignment.studentIds.includes(s.id),
  );
  const map = new Map<string, DemoStudent>();
  for (const s of [...fromClass, ...fromStudents]) map.set(s.id, s);
  return [...map.values()];
}

/** If calendar still looks like old quarterly default, switch on all 12 months. */
export function preferMonthlyIfQuarterlyStub(state: MastersState): MastersState {
  let next = ensureAprToMarInstallments(state, DEFAULT_AY);
  const ay = next.installments.filter((i) => i.academicYearCode === DEFAULT_AY);
  const activeCodes = ay
    .filter((i) => i.isActive)
    .map((i) => i.code)
    .sort()
    .join(",");
  const quarterlyStub =
    activeCodes === "APR,JAN,JUL,OCT" || activeCodes === "APR,JUL,OCT,JAN";
  if (quarterlyStub) {
    next = applyInstallmentPattern(next, "monthly", DEFAULT_AY);
  }
  return next;
}

function ensureClassRoster(state: MastersState): MastersState {
  // An empty roster means "not loaded", not "no classes". Filling it in from
  // CLASS_GROUPS mints a fresh id per class, and those ids are what students,
  // leads and fee lines would then be written against — pointing at a
  // generation no other device or the server has ever seen.
  //
  // This is reachable with a partly-hydrated state (say fee heads arrived but
  // classes did not), which the guard in ensureFeeSetup does not catch, so it
  // is checked again here. Backfilling a MISSING class into a roster that
  // already exists is still fine; conjuring the whole roster is not.
  if (!state.classes?.length && isSupabaseConfigured()) return state;

  let classes = (state.classes ?? []).map((c, i) => normalizeSchoolClass(c, i));
  let sections = [...(state.sections ?? [])];

  // School does not offer Pre-Nursery — drop legacy demo rows.
  const dropIds = new Set(
    classes
      .filter((c) => c.name.trim().toLowerCase() === "pre-nursery")
      .map((c) => c.id),
  );
  if (dropIds.size > 0) {
    classes = classes.filter((c) => !dropIds.has(c.id));
    sections = sections.filter((s) => !dropIds.has(s.classId));
  }

  const byName = new Map(classes.map((c) => [c.name.toLowerCase(), c]));

  let sortBase = classes.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  for (const g of CLASS_GROUPS) {
    for (const name of g.classNames) {
      if (byName.has(name.toLowerCase())) continue;
      sortBase += 1;
      const cls: SchoolClass = {
        id: id("cls"),
        name,
        sortOrder: sortBase,
        isActive: true,
        groupCode: g.code,
      };
      classes.push(cls);
      byName.set(name.toLowerCase(), cls);
      for (const secName of ["A", "B"]) {
        sections.push({
          id: id("sec"),
          classId: cls.id,
          name: secName,
          isActive: true,
        });
      }
    }
  }

  const order = CLASS_GROUPS.flatMap((g) => g.classNames);
  classes = classes
    .map((c) => normalizeSchoolClass(c))
    .sort((a, b) => {
      const ia = order.findIndex(
        (n) => n.toLowerCase() === a.name.toLowerCase(),
      );
      const ib = order.findIndex(
        (n) => n.toLowerCase() === b.name.toLowerCase(),
      );
      const sa = ia >= 0 ? ia : 1000 + a.sortOrder;
      const sb = ib >= 0 ? ib : 1000 + b.sortOrder;
      return sa - sb;
    })
    .map((c, i) => ({ ...c, sortOrder: i + 1 }));

  let next: MastersState = { ...state, classes, sections };
  if (dropIds.size > 0) {
    next = {
      ...next,
      feeGroups: (next.feeGroups ?? []).map((g) => ({
        ...g,
        classIds: g.classIds.filter((cid) => !dropIds.has(cid)),
        name: g.name
          .replace(/Pre-Nursery–/gi, "Nursery–")
          .replace(/Pre-Nursery-/gi, "Nursery-")
          .replace(/Pre-Nursery/gi, "Nursery"),
      })),
      classSubjects: (next.classSubjects ?? []).filter(
        (l) => !dropIds.has(l.classId),
      ),
    };
  }
  return next;
}

/** Normalize legacy fee heads (isRefundable + deposit category). */
export function normalizeFeeHead(
  h: Partial<FeeHead> & { id: string },
): FeeHead {
  const code = (h.code ?? "").toUpperCase();
  const looksLikeDeposit =
    h.category === "deposit" ||
    code === "SECURITY" ||
    code === "CAUTION" ||
    /SECURITY|CAUTION|DEPOSIT/.test(code);
  const category: FeeHeadCategory = looksLikeDeposit
    ? "deposit"
    : ((h.category as FeeHeadCategory) ?? "misc");
  const inferredRefundable = looksLikeDeposit;
  return {
    id: h.id,
    code: h.code ?? "",
    nameEn: h.nameEn ?? "",
    nameHi: h.nameHi,
    category,
    frequency: (h.frequency as FeeFrequency) ?? "one_time",
    isOptional: !!h.isOptional,
    isRefundable: h.isRefundable == null ? inferredRefundable : !!h.isRefundable,
    isActive: h.isActive !== false,
    sortOrder: h.sortOrder ?? 0,
  };
}

function ensureFeeHeads(state: MastersState): MastersState {
  let heads = (state.feeHeads ?? []).map((h) => normalizeFeeHead(h));
  if (!heads.some((h) => h.code.toUpperCase() === "SECURITY")) {
    const seed = buildFeeHeads().find((h) => h.code === "SECURITY");
    if (seed) {
      heads = [
        ...heads,
        {
          ...seed,
          id: id("fh"),
          sortOrder:
            Math.max(0, ...heads.map((h) => h.sortOrder)) + 5,
        },
      ];
    }
  }
  const categories = resolveFeeHeadCategories(state);
  // Ensure every head category exists in the catalog
  const codes = new Set(categories.map((c) => c.code));
  const nextCats = [...categories];
  for (const h of heads) {
    const code = (h.category || "misc").toLowerCase();
    if (!codes.has(code)) {
      codes.add(code);
      nextCats.push(
        normalizeFeeHeadCategory({
          id: id("fhc"),
          code,
          label: code.replace(/_/g, " "),
          isActive: true,
          sortOrder: (nextCats.length + 1) * 10,
        }),
      );
    }
  }
  return {
    ...state,
    feeHeads: heads,
    feeHeadCategories: nextCats,
  };
}

/**
 * Has this masters state actually been loaded, or is it just empty?
 *
 * A state with no classes, no fee heads and no subjects has not been
 * hydrated yet. It is NOT "a school that has no classes" — a real school
 * that had deleted everything would still be a case for showing nothing,
 * never for inventing a curriculum.
 */
function mastersLooksUnhydrated(state: MastersState): boolean {
  return (
    !state.classes?.length &&
    !state.feeHeads?.length &&
    !state.subjects?.length
  );
}

function ensureFeeSetup(state: MastersState): MastersState {
  // Absent is not a default.
  //
  // On a cold client this function used to fabricate an entire school:
  // `defaultMasters()` supplies `full.classes` when the roster is empty, and
  // ensureClassRoster then mints any class still missing — each with a fresh
  // random id. The result is a complete 15-class generation the server has
  // never seen, written straight to localStorage by loadMasters(), which
  // then fails guardMastersOverwrite as a `regenerated` push and leaves the
  // device frozen on ids that exist nowhere else.
  //
  // That is what a cleared browser produced against production on
  // 2026-08-10: ids cls_kwlp6sqz… while the database held cls_p7bw8cpc…, and
  // clearing storage — the workaround staff had been told to use — made it
  // worse rather than better.
  //
  // With Supabase configured there is a real roster to hydrate; seeding one
  // locally can only conflict with it. Demo mode has nothing to hydrate
  // from, so it still gets a usable school.
  if (mastersLooksUnhydrated(state) && isSupabaseConfigured()) return state;

  let next = { ...state, version: 2 as const };
  if (!next.feeGroups?.length || !next.feeStructureLines?.length) {
    const full = defaultMasters();
    next = {
      ...full,
      campuses: state.campuses?.length ? state.campuses : full.campuses,
      classes: state.classes?.length ? state.classes : full.classes,
      sections: state.sections?.length ? state.sections : full.sections,
      feeHeads: state.feeHeads?.length ? state.feeHeads : full.feeHeads,
    };
  }
  next = ensureClassRoster(next);
  next = ensureFeeHeads(next);
  if (!next.lateFeeRules?.length) {
    const full = defaultMasters();
    next = { ...next, lateFeeRules: full.lateFeeRules };
  }
  next = {
    ...next,
    midYearFeePolicy: normalizeMidYearFeePolicy(next.midYearFeePolicy),
  };
  next = {
    ...next,
    lateFeeRules: next.lateFeeRules.map((r) => {
      const ids =
        r.feeHeadIds?.length > 0
          ? r.feeHeadIds
          : r.feeHeadId
            ? [r.feeHeadId]
            : [];
      return {
        ...r,
        feeHeadIds: ids,
        feeHeadId: ids[0] ?? r.feeHeadId,
      };
    }),
  };
  next = ensureAprToMarInstallments(next, DEFAULT_AY);
  if (!next.students) next = { ...next, students: [] };
  if (!next.specialFees) next = { ...next, specialFees: [] };
  if (!next.specialFeeAssignments) {
    next = { ...next, specialFeeAssignments: [] };
  }
  if (!next.concessions?.length) {
    const full = defaultMasters();
    next = { ...next, concessions: full.concessions };
  } else {
    next = {
      ...next,
      concessions: next.concessions.map(normalizeConcessionRule),
    };
  }
  if (!next.concessionGrants) {
    next = { ...next, concessionGrants: [] };
  } else {
    next = {
      ...next,
      concessionGrants: next.concessionGrants.map(normalizeConcessionGrant),
    };
  }
  next = {
    ...next,
    feeGroups: (next.feeGroups ?? []).map(normalizeFeeGroup),
  };
  next = repairFeeGroupClassIds(next);
  next = {
    ...next,
    concessionKinds: resolveConcessionKinds(next),
  };
  next = ensureFoundationOnMasters(next);
  next = migrateDemoStaffToTeacherRoster(next);
  // Auto-seed IX–X / XI–XII NCF cart offerings when class maps are thin
  if (!ncfCartOfferingsReady(next)) {
    const seeded = seedNcfCartOfferings({
      classes: next.classes ?? [],
      subjects: next.subjects ?? [],
      classSubjects: next.classSubjects ?? [],
    });
    next = {
      ...next,
      subjects: seeded.subjects,
      classSubjects: seeded.classSubjects,
    };
  }
  next = ensureFoundationFeeStructure202627(next);
  next = ensurePrimaryFeeStructure202627(next);
  next = ensureMiddleFeeStructure202627(next);
  next = ensureSecondaryFeeStructure202627(next);
  return next;
}

export function loadMasters(): MastersState {
  if (typeof window === "undefined") {
    const mirrored = getSchoolMirrorSync().masters as MastersState | null;
    if (mirrored && Array.isArray(mirrored.classes)) {
      return ensureFeeSetup(mirrored);
    }
    // Cold mirror. Seeding demo masters here mints fresh random class, section
    // and fee-head ids on every call, and anything written against them lands
    // in the DB pointing at nothing — this is how admission leads ended up
    // with an unresolvable classSoughtId. Fail closed on a real tenant and let
    // the caller hydrate; keep demo seeding only when there is no Supabase to
    // hydrate from. Matches what the browser already does with empty storage.
    return shouldSeedEmptyMastersShell() ? emptyMastersShell() : defaultMasters();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = ensureFeeSetup(JSON.parse(raw) as MastersState);
      const migrated = migrateDemoStaffToTeacherRoster(parsed);
      const normalized = normalizeMastersStaffRoster(migrated);
      if (normalized !== migrated || migrated !== parsed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      // One-time upgrade: turn on full Apr–Mar monthly calendar
      let merged = ensureFeeSetup(JSON.parse(legacy) as MastersState);
      merged = applyInstallmentPattern(merged, "monthly", DEFAULT_AY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }
    const seed = shouldSeedEmptyMastersShell() ? emptyMastersShell() : defaultMasters();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  } catch {
    return shouldSeedEmptyMastersShell() ? emptyMastersShell() : defaultMasters();
  }
}

/**
 * A real tenant gets an empty shell, never generated demo masters: the ids in
 * defaultMasters() are freshly random, so anything saved against them dangles.
 * Applies on both sides — the server has the same NEXT_PUBLIC_SUPABASE_* env
 * the browser is built with.
 */
function shouldSeedEmptyMastersShell(): boolean {
  return isSupabaseConfigured();
}

/**
 * Save masters and report whether the write actually reached the database.
 *
 * Returns the real outcome so a caller can stop assuming success. Callers
 * that ignore the promise behave exactly as before. `blocked` means the
 * write never left the browser (RBAC or a closed session) — previously
 * indistinguishable from a successful save, so the UI reported "saved"
 * either way.
 */
export function saveMasters(
  state: MastersState,
): Promise<MastersSaveOutcome> {
  if (!assertModulePermission("masters", "edit", "saveMasters")) {
    return Promise.resolve({ ok: false, reason: "blocked" });
  }
  return persistMastersClient(state);
}

export type MastersSaveOutcome =
  | { ok: true; reason?: "unchanged" }
  | { ok: false; reason: string };

/** System imports (fee discounts seed) — bypass RBAC / closed-session guards. */
export function persistMastersSystemImport(
  state: MastersState,
): Promise<MastersSaveOutcome> {
  if (typeof window === "undefined") {
    setMirrorSlice("masters", state);
    return Promise.resolve({ ok: true });
  }
  return persistMastersClient(state);
}

async function persistMastersClient(
  state: MastersState,
): Promise<MastersSaveOutcome> {
  if (typeof window === "undefined") {
    setMirrorSlice("masters", state);
    void import("@/lib/staffPersistence").then(({ scheduleStaffSync }) => {
      scheduleStaffSync(state);
    });
    return { ok: true };
  }
  const serialized = JSON.stringify({ ...state, version: 2 });
  const prev = localStorage.getItem(STORAGE_KEY);
  if (prev === serialized) return { ok: true, reason: "unchanged" };

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (e) {
    console.warn("[masters] localStorage quota exceeded — using server DB persistence", e);
  }
  writeMastersMirrorMeta(new Date().toISOString());
  void import("@/lib/staffPersistence").then(
    ({ scheduleStaffSync, stripStaffFromMastersForBlob }) => {
      scheduleClientSchoolMirrorSync({
        masters: stripStaffFromMastersForBlob(state),
      });
      scheduleStaffSync(state);
    },
  );
  // Deliberately does NOT touch the desk meta. `bhb_masters_desk_db_meta_v1`
  // holds the desk revision this client last saw, and it is sent back as
  // `baseUpdatedAt` for optimistic locking (mastersNormalizedClient.ts).
  // Stamping it with a local clock here made the client claim to have
  // hydrated at a revision that never existed on the server, so every save
  // after the first was refused 409 "stale" — masters became unsavable in
  // production on 2026-08-10. That key is now only ever written from a
  // server response: the push result, a hydrate, or the wipe signal.
  // Awaited, not fire-and-forget: the caller needs the real outcome.
  // scheduleMastersSync queues the state synchronously, so flushing straight
  // after is safe and turns the debounced push into an awaitable one.
  const { scheduleMastersSync } = await import("@/lib/mastersPersistence");
  scheduleMastersSync(state);
  window.dispatchEvent(new CustomEvent("bhb-masters-updated"));

  const { flushMastersDeskSyncPending } = await import(
    "@/lib/mastersNormalizedClient"
  );
  const pushed = await flushMastersDeskSyncPending();
  // `null` = nothing was queued (Supabase unconfigured / demo mode). The
  // local write stands; there is no remote write to have failed.
  if (!pushed) return { ok: true };
  return pushed.ok ? { ok: true } : { ok: false, reason: pushed.reason };
}

const MASTERS_MIRROR_META = "bhb_masters_mirror_meta_v1";

function readMastersMirrorMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(MASTERS_MIRROR_META);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeMastersMirrorMeta(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MASTERS_MIRROR_META, JSON.stringify({ updatedAt: iso }));
}

export function mastersMirrorIsEmpty(state: MastersState): boolean {
  return (state.classes?.length ?? 0) <= 3 && (state.campuses?.length ?? 0) <= 1;
}

/** Pull masters from server mirror — avoids seed overwriting cloud on new browser. */
export function hydrateMastersFromMirror(
  raw: unknown,
  remoteAt: string,
  remoteIsNewer: boolean,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  const localAt = readMastersMirrorMeta();
  const takeRemote =
    remoteIsNewer && (!localAt || (!!remoteAt && remoteAt > localAt));
  if (!takeRemote) return false;
  const normalized = ensureFeeSetup(
    migrateDemoStaffToTeacherRoster(raw as MastersState),
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...normalized, version: 2 }),
  );
  writeMastersMirrorMeta(remoteAt || new Date().toISOString());
  setMirrorSlice("masters", normalized);
  return true;
}

export function newId(prefix: string) {
  return id(prefix);
}

/** Guard for master Remove actions — blocked when linked data exists. */
export type RemovalCheck = {
  canRemove: boolean;
  blockers: string[];
  /** Shown under disabled Remove, and in confirm when allowed */
  suggestion: string;
  confirmMessage: string;
};

function lateRuleUsesHead(rule: LateFeeRule, feeHeadId: string): boolean {
  const ids =
    rule.feeHeadIds?.length > 0
      ? rule.feeHeadIds
      : rule.feeHeadId
        ? [rule.feeHeadId]
        : [];
  return ids.includes(feeHeadId);
}

export function checkFeeHeadRemoval(
  state: MastersState,
  feeHeadId: string,
): RemovalCheck {
  const name =
    state.feeHeads.find((h) => h.id === feeHeadId)?.nameEn ?? "this fee head";
  const blockers: string[] = [];
  const structureN = state.feeStructureLines.filter(
    (l) => l.feeHeadId === feeHeadId,
  ).length;
  if (structureN > 0) {
    blockers.push(`${structureN} fee structure line(s)`);
  }
  const lateN = state.lateFeeRules.filter((r) =>
    lateRuleUsesHead(r, feeHeadId),
  ).length;
  if (lateN > 0) blockers.push(`${lateN} late-fee rule(s)`);
  const specialN = (state.specialFees ?? []).filter(
    (f) => f.feeHeadId === feeHeadId,
  ).length;
  if (specialN > 0) blockers.push(`${specialN} special fee(s)`);
  const concN = (state.concessions ?? []).filter((c) =>
    c.feeHeadIds.includes(feeHeadId),
  ).length;
  if (concN > 0) blockers.push(`${concN} concession rule(s)`);

  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Linked data present (${blockers.join("; ")}). Clear Fee structure / Late fee / Special fees / Concessions first, or use Inactivate.`,
      confirmMessage: `Remove fee head “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "Prefer Inactivate if you may need this head later. Removal cannot be undone.",
    confirmMessage: `Remove fee head “${name}”?`,
  };
}

export function checkFeeGroupRemoval(
  state: MastersState,
  feeGroupId: string,
): RemovalCheck {
  const name =
    state.feeGroups.find((g) => g.id === feeGroupId)?.name ?? "this fee group";
  const structureN = state.feeStructureLines.filter(
    (l) => l.feeGroupId === feeGroupId,
  ).length;
  if (structureN > 0) {
    return {
      canRemove: false,
      blockers: [`${structureN} fee structure line(s)`],
      suggestion: `Fee structure has ${structureN} amount line(s). Remove those under Fee structure first, or use Inactivate.`,
      confirmMessage: `Remove fee group “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "Prefer Inactivate if students may still map to this group. Removal cannot be undone.",
    confirmMessage: `Remove fee group “${name}”?`,
  };
}

export function checkCampusRemoval(
  state: MastersState,
  campusId: string,
): RemovalCheck {
  const campus = state.campuses.find((c) => c.id === campusId);
  const name = campus?.name ?? "this campus";
  const blockers: string[] = [];
  if (state.campuses.length <= 1) {
    blockers.push("only campus on record");
  }
  if (campus?.isPrimary) {
    blockers.push("marked as Primary");
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot remove (${blockers.join("; ")}). Add another campus and make it Primary first, or use Inactivate.`,
      confirmMessage: `Remove campus “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Prefer Inactivate if the campus may reopen. Removal cannot be undone.",
    confirmMessage: `Remove campus “${name}”?`,
  };
}

export function checkClassRemoval(
  state: MastersState,
  classId: string,
): RemovalCheck {
  const name = state.classes.find((c) => c.id === classId)?.name ?? "this class";
  const blockers: string[] = [];
  const sectionN = state.sections.filter((s) => s.classId === classId).length;
  if (sectionN > 0) blockers.push(`${sectionN} section(s)`);
  const studentN = (state.students ?? []).filter(
    (s) => s.classId === classId,
  ).length;
  if (studentN > 0) blockers.push(`${studentN} student(s)`);
  const groupN = state.feeGroups.filter((g) =>
    g.classIds.includes(classId),
  ).length;
  if (groupN > 0) blockers.push(`${groupN} fee group(s)`);
  const assignN = (state.specialFeeAssignments ?? []).filter((a) =>
    a.classIds.includes(classId),
  ).length;
  if (assignN > 0) blockers.push(`${assignN} special-fee assignment(s)`);

  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Linked data present (${blockers.join("; ")}). Remove sections / unlink fee groups & assignments first, or use Inactivate.`,
      confirmMessage: `Remove class “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Prefer Inactivate if the class may return. Removal cannot be undone.",
    confirmMessage: `Remove class “${name}”?`,
  };
}

export function checkSectionRemoval(
  state: MastersState,
  sectionId: string,
): RemovalCheck {
  const section = state.sections.find((s) => s.id === sectionId);
  const cls = state.classes.find((c) => c.id === section?.classId);
  const label = section
    ? `${cls?.name ?? "?"}-${section.name}`
    : "this section";
  const studentN = (state.students ?? []).filter(
    (s) => s.sectionId === sectionId,
  ).length;
  if (studentN > 0) {
    return {
      canRemove: false,
      blockers: [`${studentN} student(s)`],
      suggestion: `${studentN} student(s) are in this section. Move or remove them first, or use Inactivate.`,
      confirmMessage: `Remove section “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Prefer Inactivate if the section may reopen. Removal cannot be undone.",
    confirmMessage: `Remove section “${label}”?`,
  };
}

export function checkSpecialFeeRemoval(
  state: MastersState,
  specialFeeId: string,
): RemovalCheck {
  const name =
    (state.specialFees ?? []).find((f) => f.id === specialFeeId)?.name ??
    "this special fee";
  const assignN = (state.specialFeeAssignments ?? []).filter(
    (a) => a.specialFeeId === specialFeeId,
  ).length;
  if (assignN > 0) {
    return {
      canRemove: false,
      blockers: [`${assignN} assignment(s)`],
      suggestion: `${assignN} assignment(s) still exist. Remove assignments first, or use Inactivate.`,
      confirmMessage: `Remove special fee “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Prefer Inactivate if this fee may run again. Removal cannot be undone.",
    confirmMessage: `Remove special fee “${name}”?`,
  };
}

export function checkConcessionRemoval(
  state: MastersState,
  concessionId: string,
): RemovalCheck {
  const name =
    (state.concessions ?? []).find((c) => c.id === concessionId)?.name ??
    "this concession";
  const grantN = (state.concessionGrants ?? []).filter(
    (g) =>
      g.concessionId === concessionId &&
      (g.status === "pending" || g.status === "approved"),
  ).length;
  if (grantN > 0) {
    return {
      canRemove: false,
      blockers: [`${grantN} student grant(s)`],
      suggestion: `${grantN} pending/approved grant(s) still exist. Clear grants in Fee Take / SIS first, or use Inactivate.`,
      confirmMessage: `Remove concession “${name}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "Prefer Inactivate if this policy may apply again. Removal cannot be undone.",
    confirmMessage: `Remove concession “${name}”?`,
  };
}

export function checkConcessionKindRemoval(
  state: MastersState,
  kindId: string,
): RemovalCheck {
  const kinds = resolveConcessionKinds(state);
  const kind = kinds.find((k) => k.id === kindId);
  const label = kind?.label ?? "this kind";
  if (kind?.isSystem) {
    return {
      canRemove: false,
      blockers: ["system kind"],
      suggestion: "Built-in kinds cannot be removed. Create a custom kind instead.",
      confirmMessage: `Remove kind “${label}”?`,
    };
  }
  const usedN = (state.concessions ?? []).filter(
    (c) => c.kind === kind?.code,
  ).length;
  if (usedN > 0) {
    return {
      canRemove: false,
      blockers: [`${usedN} concession rule(s)`],
      suggestion: `${usedN} concession rule(s) use this kind. Change or remove those policies first.`,
      confirmMessage: `Remove kind “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Custom kinds with no policies can be removed.",
    confirmMessage: `Remove kind “${label}”?`,
  };
}

export function checkStructureLineRemoval(
  headName: string,
  amountLabel: string,
): RemovalCheck {
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This only removes the amount from the structure for that month.",
    confirmMessage: `Remove “${headName}” (${amountLabel}) from this month?`,
  };
}

/**
 * Clear every structure line on a fee group (all months / class scopes).
 * Allowed only when no active students are assigned to the group.
 */
export function checkClearFeeGroupStructure(
  studentCount: number,
  lineCount: number,
): RemovalCheck {
  if (lineCount <= 0) {
    return {
      canRemove: false,
      blockers: ["No fee lines"],
      suggestion: "This group has no fee amounts to clear.",
      confirmMessage: "Nothing to clear.",
    };
  }
  if (studentCount > 0) {
    return {
      canRemove: false,
      blockers: [`${studentCount} student(s) on this group`],
      suggestion: `Cannot clear — ${studentCount} student(s) are on this fee group. Move or unassign them first (or they will lose billed heads).`,
      confirmMessage: "Clear blocked",
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "No students are on this fee group, so clearing is safe. Publishes status will also reset.",
    confirmMessage: `Remove all ${lineCount} fee amount line(s) from this group?`,
  };
}

/** Remove all fee structure lines for a group; resets publish flag. */
export function clearFeeGroupStructure(
  state: MastersState,
  feeGroupId: string,
  studentCount: number,
): { ok: true; state: MastersState; removed: number } | { ok: false; reason: string } {
  const lineCount = state.feeStructureLines.filter(
    (l) => l.feeGroupId === feeGroupId,
  ).length;
  const check = checkClearFeeGroupStructure(studentCount, lineCount);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    removed: lineCount,
    state: {
      ...state,
      feeStructureLines: state.feeStructureLines.filter(
        (l) => l.feeGroupId !== feeGroupId,
      ),
      feeGroups: state.feeGroups.map((g) =>
        g.id === feeGroupId
          ? {
              ...g,
              structurePublishedAt: null,
              structurePublishedBy: "",
            }
          : g,
      ),
    },
  };
}

export function checkAssignmentRemoval(studentCount: number): RemovalCheck {
  if (studentCount > 0) {
    return {
      canRemove: true,
      blockers: [],
      suggestion: `This assignment covers ${studentCount} student(s). They will no longer be charged this special fee.`,
      confirmMessage: `Remove this assignment (${studentCount} student(s))?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This assignment has no resolved students.",
    confirmMessage: "Remove this assignment?",
  };
}

export function removeFeeHead(
  state: MastersState,
  feeHeadId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkFeeHeadRemoval(state, feeHeadId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      feeHeads: state.feeHeads.filter((h) => h.id !== feeHeadId),
    },
  };
}

export function removeFeeGroup(
  state: MastersState,
  feeGroupId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkFeeGroupRemoval(state, feeGroupId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      feeGroups: state.feeGroups.filter((g) => g.id !== feeGroupId),
    },
  };
}

export function removeCampus(
  state: MastersState,
  campusId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkCampusRemoval(state, campusId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      campuses: state.campuses.filter((c) => c.id !== campusId),
    },
  };
}

export function removeClass(
  state: MastersState,
  classId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkClassRemoval(state, classId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      classes: state.classes.filter((c) => c.id !== classId),
    },
  };
}

export function removeSection(
  state: MastersState,
  sectionId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkSectionRemoval(state, sectionId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      sections: state.sections.filter((s) => s.id !== sectionId),
    },
  };
}

export function removeSpecialFee(
  state: MastersState,
  specialFeeId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkSpecialFeeRemoval(state, specialFeeId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      specialFees: (state.specialFees ?? []).filter((f) => f.id !== specialFeeId),
    },
  };
}

export function removeConcession(
  state: MastersState,
  concessionId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkConcessionRemoval(state, concessionId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      concessions: (state.concessions ?? []).filter((c) => c.id !== concessionId),
    },
  };
}

export function removeConcessionKind(
  state: MastersState,
  kindId: string,
): { ok: true; state: MastersState } | { ok: false; reason: string } {
  const check = checkConcessionKindRemoval(state, kindId);
  if (!check.canRemove) {
    return { ok: false, reason: check.suggestion };
  }
  return {
    ok: true,
    state: {
      ...state,
      concessionKinds: resolveConcessionKinds(state).filter(
        (k) => k.id !== kindId,
      ),
    },
  };
}

export function formatConcessionValue(rule: ConcessionRule): string {
  if (rule.kind === "sibling" && (rule.siblingTiers?.length ?? 0) > 0) {
    const tiers = [...rule.siblingTiers].sort((a, b) => a.childNo - b.childNo);
    return tiers
      .map((t, i) => {
        const last = i === tiers.length - 1;
        const label = last
          ? ordinalChildLabel(t.childNo) + (t.childNo >= 4 ? "+" : "")
          : ordinalChildLabel(t.childNo);
        const val =
          t.mode === "percent" ? `${t.value}%` : formatInr(t.value);
        return `${label} ${val}`;
      })
      .join(" · ");
  }
  if (rule.mode === "percent") return `${rule.value}%`;
  return formatInr(rule.value);
}

export function ordinalChildLabel(childNo: number): string {
  if (childNo === 1) return "1st";
  if (childNo === 2) return "2nd";
  if (childNo === 3) return "3rd";
  return `${childNo}th`;
}

export function defaultSiblingTiers(): SiblingConcessionTier[] {
  return [
    { childNo: 2, mode: "percent", value: 10 },
    { childNo: 3, mode: "percent", value: 15 },
    { childNo: 4, mode: "percent", value: 20 },
  ];
}

export function normalizeSiblingTier(
  t: Partial<SiblingConcessionTier>,
): SiblingConcessionTier {
  const childNo = Math.max(2, Math.floor(Number(t.childNo) || 2));
  const mode: ConcessionValueMode = t.mode === "fixed" ? "fixed" : "percent";
  const value =
    mode === "percent"
      ? Math.max(0, Math.min(100, Math.floor(Number(t.value) || 0)))
      : Math.max(0, Math.floor(Number(t.value) || 0));
  return { childNo, mode, value };
}

export function normalizeConcessionRule(
  c: Partial<ConcessionRule> & { id: string },
): ConcessionRule {
  const kind = c.kind ?? "other";
  const mode: ConcessionValueMode = c.mode === "fixed" ? "fixed" : "percent";
  let siblingTiers = Array.isArray(c.siblingTiers)
    ? c.siblingTiers.map(normalizeSiblingTier)
    : [];
  if (kind === "sibling" && siblingTiers.length === 0 && (c.value ?? 0) > 0) {
    siblingTiers = [
      { childNo: 2, mode, value: c.value ?? 10 },
      {
        childNo: 3,
        mode,
        value: mode === "percent" ? Math.min(100, (c.value ?? 10) + 5) : c.value ?? 0,
      },
      {
        childNo: 4,
        mode,
        value: mode === "percent" ? Math.min(100, (c.value ?? 10) + 10) : c.value ?? 0,
      },
    ];
  }
  siblingTiers = [...siblingTiers]
    .sort((a, b) => a.childNo - b.childNo)
    .filter(
      (t, i, arr) => arr.findIndex((x) => x.childNo === t.childNo) === i,
    );
  return {
    id: c.id,
    code: c.code ?? "",
    name: c.name ?? "",
    kind,
    academicYearCode: CONCESSION_ALL_SESSIONS,
    mode,
    value:
      mode === "percent"
        ? Math.max(0, Math.min(100, Math.floor(Number(c.value) || 0)))
        : Math.max(0, Math.floor(Number(c.value) || 0)),
    siblingTiers: kind === "sibling" ? siblingTiers : [],
    feeHeadIds: Array.isArray(c.feeHeadIds) ? c.feeHeadIds : [],
    autoApproveMaxPaise:
      c.autoApproveMaxPaise == null
        ? null
        : Math.max(0, Math.floor(c.autoApproveMaxPaise)),
    documentationRequired: !!c.documentationRequired,
    incompatibleCodes: Array.isArray(c.incompatibleCodes)
      ? c.incompatibleCodes
      : [],
    notes: c.notes ?? "",
    isActive: c.isActive !== false,
  };
}

export function normalizeConcessionGrant(
  g: Partial<ConcessionGrant> & { id: string },
): ConcessionGrant {
  const childNo = g.siblingChildNo;
  return {
    id: g.id,
    concessionId: g.concessionId ?? "",
    studentId: g.studentId ?? "",
    status:
      g.status === "approved" || g.status === "rejected"
        ? g.status
        : "pending",
    reason: g.reason ?? "",
    effectiveFrom: g.effectiveFrom ?? "",
    effectiveTo: g.effectiveTo ?? null,
    createdAt: g.createdAt ?? new Date().toISOString(),
    siblingChildNo:
      childNo == null || Number.isNaN(Number(childNo))
        ? null
        : Math.max(1, Math.floor(Number(childNo))),
  };
}

/**
 * Resolve discount for a sibling child number.
 * Last tier applies to that child and higher (e.g. 4th+).
 * 1st child → null (no sibling discount).
 */
export function resolveSiblingTierValue(
  rule: ConcessionRule,
  childNo: number,
): { mode: ConcessionValueMode; value: number } | null {
  if (childNo < 2) return null;
  const tiers = [...(rule.siblingTiers ?? [])].sort(
    (a, b) => a.childNo - b.childNo,
  );
  if (tiers.length === 0) {
    return { mode: rule.mode, value: rule.value };
  }
  if (childNo < tiers[0]!.childNo) return null;
  let match = tiers[0]!;
  for (const t of tiers) {
    if (t.childNo <= childNo) match = t;
  }
  return { mode: match.mode, value: match.value };
}

export function concessionAmountFromValue(
  mode: ConcessionValueMode,
  value: number,
  billedPaise: number,
): number {
  if (mode === "percent") {
    return Math.round((billedPaise * value) / 100);
  }
  return value;
}

export function concessionApprovalHint(rule: ConcessionRule): string {
  if (rule.autoApproveMaxPaise == null) {
    return "Principal approval always";
  }
  return `Auto ≤ ${formatInr(rule.autoApproveMaxPaise)} · else Principal`;
}

/** Concession policies apply across every academic session. */
export const CONCESSION_ALL_SESSIONS = "*";

export function normalizeAcademicYearCode(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export function isAllSessionsConcession(rule: ConcessionRule): boolean {
  const scope = (rule.academicYearCode || "").trim();
  return !scope || scope === CONCESSION_ALL_SESSIONS;
}

/** One row per policy code — grants aggregate across duplicate session copies. */
export function listConcessionPolicies(
  masters: MastersState,
  options?: { preferAy?: string },
): ConcessionRule[] {
  const all = masters.concessions ?? [];
  const preferAy = options?.preferAy;
  const byCode = new Map<string, ConcessionRule>();

  const rank = (rule: ConcessionRule): number => {
    let score = 0;
    if (isAllSessionsConcession(rule)) score += 200;
    if (
      preferAy &&
      normalizeAcademicYearCode(rule.academicYearCode) ===
        normalizeAcademicYearCode(preferAy)
    ) {
      score += 100;
    }
    if (rule.isActive) score += 50;
    return score;
  };

  for (const rule of all) {
    const key = (rule.code || "").trim().toUpperCase();
    if (!key) continue;
    const prev = byCode.get(key);
    if (!prev || rank(rule) > rank(prev)) byCode.set(key, rule);
  }

  return [...byCode.values()].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function concessionIdsForCode(
  masters: MastersState,
  code: string,
): string[] {
  const key = code.trim().toUpperCase();
  return (masters.concessions ?? [])
    .filter((c) => c.code.trim().toUpperCase() === key)
    .map((c) => c.id);
}

export function grantsForConcessionPolicy(
  masters: MastersState,
  rule: ConcessionRule,
): ConcessionGrant[] {
  const ids = new Set(concessionIdsForCode(masters, rule.code));
  return (masters.concessionGrants ?? []).filter((g) => ids.has(g.concessionId));
}

export function resolveConcessionRule(
  masters: MastersState,
  concessionId: string,
): ConcessionRule | undefined {
  return masters.concessions.find((c) => c.id === concessionId);
}

/** Resolve grant → active policy (same code if an old session id was stored). */
export function resolveConcessionRuleForGrant(
  masters: MastersState,
  grant: ConcessionGrant,
  options?: { preferAy?: string },
): ConcessionRule | undefined {
  const direct = resolveConcessionRule(masters, grant.concessionId);
  if (direct?.isActive) return direct;
  const code = direct?.code ?? masters.concessions.find((c) => c.id === grant.concessionId)?.code;
  if (!code) return direct;
  return listConcessionPolicies(masters, options).find(
    (c) => c.code.toUpperCase() === code.toUpperCase() && c.isActive,
  );
}

/**
 * Fee group for dues: current session structure wins over a stale group id
 * from a previous academic year.
 */
export function resolveStudentFeeGroupId(
  masters: MastersState,
  student: {
    feeGroupId?: string | null;
    studentType: FeeStudentType;
    classId: string;
    academicYearCode?: string;
  },
): string | null {
  const ay = student.academicYearCode || DEFAULT_AY;
  const assigned = student.feeGroupId
    ? masters.feeGroups.find((g) => g.id === student.feeGroupId)
    : null;
  if (
    assigned?.isActive &&
    assigned.academicYearCode === ay &&
    (assigned.classIds.length === 0 ||
      !student.classId ||
      assigned.classIds.includes(student.classId))
  ) {
    return assigned.id;
  }
  return (
    resolveFeeGroupId(masters, {
      studentType: student.studentType,
      classId: student.classId,
      academicYearCode: ay,
      preferPublished: true,
    }) ??
    student.feeGroupId ??
    null
  );
}

export function normalizeFeeGroup(
  g: Partial<FeeGroup> & { id: string },
): FeeGroup {
  return {
    id: g.id,
    code: g.code ?? "",
    name: g.name ?? "",
    academicYearCode: g.academicYearCode ?? DEFAULT_AY,
    studentType: (g.studentType as FeeStudentType) ?? "NEW",
    classIds: Array.isArray(g.classIds) ? g.classIds : [],
    isActive: g.isActive !== false,
    structurePublishedAt: g.structurePublishedAt ?? null,
    structurePublishedBy: g.structurePublishedBy ?? "",
  };
}

/**
 * Infer class names from fee-group code/name when stored classIds
 * no longer match the live class roster (re-seed / ID churn).
 */
export function inferFeeGroupClassNames(group: FeeGroup): string[] | null {
  const code = (group.code || "").toUpperCase();
  const name = (group.name || "").toLowerCase();

  if (
    code.includes("SR") ||
    /xi\s*[–-]\s*xii|senior/.test(name) ||
    code.includes("SENIOR")
  ) {
    return ["XI", "XII"];
  }
  if (
    code.includes("SEC") ||
    /ix\s*[–-]\s*x\b|secondary/.test(name)
  ) {
    return ["IX", "X"];
  }
  if (code.includes("MIDDLE") || /vi\s*[–-]\s*viii/.test(name)) {
    return ["VI", "VII", "VIII"];
  }
  if (
    code.includes("PRE") ||
    /nur\s*[–-]\s*ukg|pre-?primary/.test(name)
  ) {
    return ["Nursery", "LKG", "UKG"];
  }
  if (
    code.includes("PRIMARY") ||
    /nursery\s*[–-]\s*v\b|nur\s*[–-]\s*v\b|i\s*[–-]\s*v\b/.test(name)
  ) {
    return ["Nursery", "LKG", "UKG", "I", "II", "III", "IV", "V"];
  }
  return null;
}

/**
 * Remap orphaned fee-group classIds onto the current class roster
 * and keep them in CLASS_GROUPS serial order.
 */
export function repairFeeGroupClassIds(state: MastersState): MastersState {
  const byId = new Map(state.classes.map((c) => [c.id, c]));
  const byName = new Map(
    state.classes.map((c) => [c.name.trim().toLowerCase(), c]),
  );

  let changed = false;
  const feeGroups = state.feeGroups.map((g) => {
    const resolved = g.classIds.filter((id) => byId.has(id));
    if (resolved.length === g.classIds.length && g.classIds.length > 0) {
      const sorted = sortClassIdsByClassBand(state, resolved);
      if (sorted.join("\0") !== g.classIds.join("\0")) {
        changed = true;
        return { ...g, classIds: sorted };
      }
      return g;
    }
    if (g.classIds.length === 0) return g;

    const names = inferFeeGroupClassNames(g);
    if (names?.length) {
      const nextIds = names
        .map((n) => byName.get(n.toLowerCase())?.id)
        .filter((id): id is string => !!id);
      if (nextIds.length) {
        changed = true;
        return {
          ...g,
          classIds: sortClassIdsByClassBand(state, nextIds),
        };
      }
    }

    if (resolved.length !== g.classIds.length) {
      changed = true;
      return {
        ...g,
        classIds: sortClassIdsByClassBand(state, resolved),
      };
    }
    return g;
  });

  if (!changed) return state;

  // Remap structure-line class overrides when class ids were remapped
  const idMap = new Map<string, string>();
  for (let i = 0; i < state.feeGroups.length; i++) {
    const prev = state.feeGroups[i]!;
    const next = feeGroups[i]!;
    if (prev.classIds.length !== next.classIds.length) continue;
    // Best-effort: map by position after sort is unreliable; map via names
    const names = inferFeeGroupClassNames(next);
    if (!names) continue;
    for (let j = 0; j < prev.classIds.length; j++) {
      const oldId = prev.classIds[j]!;
      if (byId.has(oldId)) continue;
      // try match old orphan to a name in the inferred set by index in unsorted —
      // instead map orphan → current class when counts match seed patterns
    }
    // Build orphan→current from inferred names if lengths equal
    if (prev.classIds.length === names.length) {
      for (let j = 0; j < prev.classIds.length; j++) {
        const oldId = prev.classIds[j]!;
        const newId = byName.get(names[j]!.toLowerCase())?.id;
        if (newId && !byId.has(oldId)) idMap.set(oldId, newId);
      }
    }
  }

  const feeStructureLines =
    idMap.size === 0
      ? state.feeStructureLines
      : state.feeStructureLines.map((l) => {
          if (!l.classId || !idMap.has(l.classId)) return l;
          return { ...l, classId: idMap.get(l.classId)! };
        });

  return { ...state, feeGroups, feeStructureLines };
}

/**
 * Structure lines for a student class: class-specific overrides beat
 * group-default (classId null) for the same head + installment.
 */
export function resolveStructureLinesForClass(
  state: MastersState,
  feeGroupId: string,
  classId: string,
): FeeStructureLine[] {
  const candidates = state.feeStructureLines.filter(
    (l) =>
      l.feeGroupId === feeGroupId &&
      l.amountPaise > 0 &&
      (l.classId == null || l.classId === classId),
  );
  const map = new Map<string, FeeStructureLine>();
  for (const l of candidates) {
    const key = `${l.feeHeadId}::${l.installmentId ?? ""}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, l);
      continue;
    }
    if (prev.classId == null && l.classId === classId) {
      map.set(key, l);
    }
  }
  return [...map.values()];
}

export function annualTotalForGroup(
  state: MastersState,
  feeGroupId: string,
  classId?: string | null,
): number {
  const lines =
    classId === undefined
      ? state.feeStructureLines.filter((l) => l.feeGroupId === feeGroupId)
      : classId === null || classId === ""
        ? state.feeStructureLines.filter(
            (l) => l.feeGroupId === feeGroupId && l.classId == null,
          )
        : resolveStructureLinesForClass(state, feeGroupId, classId);
  return lines.reduce((s, l) => s + l.amountPaise, 0);
}

export function publishFeeGroupStructure(
  state: MastersState,
  feeGroupId: string,
  publishedBy: string,
):
  | { ok: true; state: MastersState }
  | { ok: false; error: string } {
  const group = state.feeGroups.find((g) => g.id === feeGroupId);
  if (!group) return { ok: false, error: "Fee group not found" };
  const lines = state.feeStructureLines.filter(
    (l) => l.feeGroupId === feeGroupId && l.amountPaise > 0,
  );
  if (lines.length === 0) {
    return { ok: false, error: "Add fee heads and amounts before publishing" };
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    state: {
      ...state,
      feeGroups: state.feeGroups.map((g) =>
        g.id === feeGroupId
          ? {
              ...normalizeFeeGroup(g),
              structurePublishedAt: now,
              structurePublishedBy: publishedBy.trim() || "Staff",
            }
          : normalizeFeeGroup(g),
      ),
    },
  };
}

export function classesForFeeGroup(
  state: MastersState,
  group: FeeGroup,
): SchoolClass[] {
  const active = state.classes.filter((c) => c.isActive);
  const pool =
    group.classIds.length === 0
      ? active
      : active.filter((c) => group.classIds.includes(c.id));
  const orderedIds = sortClassIdsByClassBand(
    state,
    pool.map((c) => c.id),
  );
  const byId = new Map(pool.map((c) => [c.id, c]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is SchoolClass => !!c);
}

export const FEE_FREQUENCIES: { value: FeeFrequency; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
  { value: "as_needed", label: "As needed" },
];

/**
 * Which session month codes (APR…MAR) a fee head should bill on
 * when spreading / “copy to months” by frequency.
 * Empty = keep only the source month (as_needed).
 */
export function installmentCodesForFeeFrequency(
  frequency: FeeFrequency | string | undefined | null,
): string[] {
  switch (frequency) {
    case "monthly":
      return SESSION_MONTHS.map((m) => m.code);
    case "quarterly":
      return ["APR", "JUL", "OCT", "JAN"];
    case "half_yearly":
      return ["APR", "OCT"];
    case "annual":
    case "one_time":
      return ["APR"];
    case "as_needed":
      return [];
    default:
      return SESSION_MONTHS.map((m) => m.code);
  }
}

export function feeFrequencyScheduleLabel(
  frequency: FeeFrequency | string | undefined | null,
): string {
  switch (frequency) {
    case "monthly":
      return "all 12 months";
    case "quarterly":
      return "Apr · Jul · Oct · Jan";
    case "half_yearly":
      return "Apr · Oct";
    case "annual":
      return "April only (annual)";
    case "one_time":
      return "April only (one-time)";
    case "as_needed":
      return "this month only";
    default:
      return "scheduled months";
  }
}

export const STUDENT_TYPES: { value: FeeStudentType; label: string }[] = [
  { value: "NEW", label: "New admission" },
  { value: "PROMOTE", label: "Promoted / continuing" },
  { value: "MID_YEAR", label: "Mid-year join" },
  { value: "RTE", label: "RTE / EWS" },
];

export const STUDENT_TYPE_HINTS: Record<FeeStudentType, string> = {
  NEW: "Admission + annual + tuition from session start (Apr), including April tuition.",
  PROMOTE: "Continuing students — no admission fee; tuition & annual only.",
  MID_YEAR:
    "Uses class fee group; default: April academic (no transport) + skip months before join — editable in Masters → Mid-year.",
  RTE: "RTE / EWS fee group when configured; otherwise falls back to new admission.",
};

/** Academic session start (1 Apr of AY start year). */
export function sessionStartDate(academicYearCode = DEFAULT_AY): string {
  const y = academicYearCode.slice(0, 4);
  return `${y}-04-01`;
}

/**
 * Suggest NEW vs MID_YEAR from joining date (after mid-May → mid-year).
 * Does not override PROMOTE / RTE.
 */
export function suggestFeeStudentType(
  joinedOn: string,
  academicYearCode = DEFAULT_AY,
  current?: FeeStudentType,
): FeeStudentType {
  if (current === "PROMOTE" || current === "RTE") return current;
  if (!joinedOn) return current ?? "NEW";
  const y = academicYearCode.slice(0, 4);
  const midCutoff = `${y}-05-15`;
  return joinedOn > midCutoff ? "MID_YEAR" : "NEW";
}

/**
 * Pick the best fee group for a student type + class.
 * MID_YEAR falls back to NEW class-group; RTE falls back to NEW.
 */
export function resolveFeeGroupId(
  masters: MastersState,
  input: {
    studentType: FeeStudentType;
    classId: string;
    academicYearCode?: string;
    preferPublished?: boolean;
  },
): string | null {
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const tryTypes: FeeStudentType[] =
    input.studentType === "MID_YEAR"
      ? ["MID_YEAR", "NEW"]
      : input.studentType === "RTE"
        ? ["RTE", "NEW"]
        : [input.studentType];

  for (const type of tryTypes) {
    const candidates = masters.feeGroups.filter(
      (g) =>
        g.isActive &&
        g.academicYearCode === ay &&
        g.studentType === type &&
        (g.classIds.length === 0 ||
          !input.classId ||
          g.classIds.includes(input.classId)),
    );
    if (candidates.length === 0) continue;

    const ranked = [...candidates].sort((a, b) => {
      const aSpec =
        input.classId && a.classIds.includes(input.classId) ? 0 : 1;
      const bSpec =
        input.classId && b.classIds.includes(input.classId) ? 0 : 1;
      if (aSpec !== bSpec) return aSpec - bSpec;
      if (input.preferPublished) {
        const aPub = a.structurePublishedAt ? 0 : 1;
        const bPub = b.structurePublishedAt ? 0 : 1;
        if (aPub !== bPub) return aPub - bPub;
      }
      return a.code.localeCompare(b.code);
    });
    return ranked[0]?.id ?? null;
  }
  return null;
}

/**
 * Copy fee groups + structure lines + Apr–Mar installments from one AY
 * onto another when the target year has no groups yet (for arrears transfer).
 */
export function cloneFeeSetupToAcademicYear(
  state: MastersState,
  fromAy: string,
  toAy: string,
): MastersState {
  if (fromAy === toAy) return state;
  const hasTarget = state.feeGroups.some(
    (g) => g.isActive && g.academicYearCode === toAy,
  );
  if (hasTarget) return state;

  let next = ensureAprToMarInstallments(state, toAy);
  const sourceInstallments = new Map(
    next.installments
      .filter((i) => i.academicYearCode === fromAy)
      .map((i) => [i.code, i] as const),
  );
  next = {
    ...next,
    installments: next.installments.map((i) => {
      if (i.academicYearCode !== toAy) return i;
      const source = sourceInstallments.get(i.code);
      if (!source) return i;
      const sourceDay = source.dueOn.match(/-(\d{2})$/)?.[1];
      return {
        ...i,
        isActive: source.isActive,
        dueOn: sourceDay
          ? i.dueOn.replace(/-\d{2}$/, `-${sourceDay}`)
          : i.dueOn,
      };
    }),
  };
  const sourceGroups = next.feeGroups.filter(
    (g) => g.isActive && g.academicYearCode === fromAy,
  );
  if (!sourceGroups.length) return next;

  const idMap = new Map<string, string>();
  const newGroups: FeeGroup[] = sourceGroups.map((g) => {
    const nid = id("fg");
    idMap.set(g.id, nid);
    return {
      ...g,
      id: nid,
      academicYearCode: toAy,
      structurePublishedAt: null,
      structurePublishedBy: "",
    };
  });

  const newLines: FeeStructureLine[] = next.feeStructureLines
    .filter((l) => idMap.has(l.feeGroupId))
    .map((l) => {
      const oldInst = l.installmentId
        ? next.installments.find((i) => i.id === l.installmentId)
        : null;
      let newInstId = l.installmentId;
      if (oldInst) {
        const match = next.installments.find(
          (i) =>
            i.academicYearCode === toAy && i.code === oldInst.code,
        );
        newInstId = match?.id ?? null;
      }
      return {
        ...l,
        id: id("fsl"),
        feeGroupId: idMap.get(l.feeGroupId)!,
        installmentId: newInstId,
      };
    });

  return {
    ...next,
    feeGroups: [...next.feeGroups, ...newGroups],
    feeStructureLines: [...next.feeStructureLines, ...newLines],
  };
}

export function isTransportFeeHead(head: {
  category?: string;
  code?: string;
} | null | undefined): boolean {
  if (!head) return false;
  return head.category === "transport" || head.code === "TRANSPORT";
}

/**
 * Mid-year billing gate — school policy decides April catch-up, skips, transport.
 */
export function shouldBillMidYearLine(input: {
  studentType: FeeStudentType;
  joinedOn?: string;
  academicYearCode?: string;
  dueOn: string;
  feeHead?: {
    category?: string;
    code?: string;
    frequency?: FeeFrequency;
  } | null;
  policy?: MidYearFeePolicy | null;
  isTransportDue?: boolean;
}): boolean {
  if (input.studentType !== "MID_YEAR" || !input.joinedOn) return true;

  const policy = normalizeMidYearFeePolicy(input.policy);
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const dueMonth = input.dueOn.slice(0, 7);
  const joinMonth = input.joinedOn.slice(0, 7);
  const aprilMonth = `${sessionStartYear(ay)}-04`;
  const isTransport =
    input.isTransportDue === true || isTransportFeeHead(input.feeHead);

  if (dueMonth >= joinMonth) return true;

  if (isTransport) {
    return !policy.transportFromJoinMonthOnly;
  }

  if (policy.alwaysBillAprilAcademic && dueMonth === aprilMonth) {
    return true;
  }

  const freq = input.feeHead?.frequency;
  if (
    policy.includeOneTimeBeforeJoin &&
    (freq === "one_time" ||
      freq === "annual" ||
      freq === "half_yearly" ||
      freq === "as_needed")
  ) {
    return true;
  }

  if (policy.skipMonthsBeforeJoin) return false;
  return true;
}

export function midYearFeePolicySummary(policy: MidYearFeePolicy): string {
  const bits: string[] = [];
  if (policy.skipMonthsBeforeJoin) bits.push("skip months before join");
  else bits.push("bill all months before join");
  if (policy.alwaysBillAprilAcademic) bits.push("April academic always");
  if (policy.transportFromJoinMonthOnly) bits.push("transport from join only");
  if (policy.includeOneTimeBeforeJoin) bits.push("one-time/annual kept");
  return bits.join(" · ");
}
