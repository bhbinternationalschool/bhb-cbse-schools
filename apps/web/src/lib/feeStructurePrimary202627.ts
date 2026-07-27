/**
 * BHB Primary (Classes I–V) fee structure — session 2026-27.
 * Source: school fee PDF (new ₹27,800 · old/promoted ₹23,800; transport extra).
 */

import type {
  FeeGroup,
  FeeHead,
  FeeStructureLine,
  MastersState,
} from "@/lib/masters";
import { ensureAprToMarInstallments } from "@/lib/masters";
import type { AcademicYearMaster } from "@/lib/foundationMasters";

export const PRIMARY_FEE_AY = "2026-27";

const NEW_GROUP_CODE = "NEW_PRIMARY_2627";
const PROMOTE_GROUP_CODE = "PROMOTE_PRIMARY_2627";

const PRIMARY_CLASS_NAMES = ["I", "II", "III", "IV", "V"];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureHead(
  heads: FeeHead[],
  spec: Omit<FeeHead, "id">,
): { heads: FeeHead[]; id: string } {
  const code = spec.code.toUpperCase();
  const existing = heads.find((h) => h.code.toUpperCase() === code);
  if (existing) return { heads, id: existing.id };
  const headId = nid("fh");
  return {
    heads: [...heads, { ...spec, id: headId }],
    id: headId,
  };
}

function ensurePrimaryFeeHeads(heads: FeeHead[]): FeeHead[] {
  let next = [...heads];
  const add = (spec: Omit<FeeHead, "id">) => {
    const r = ensureHead(next, spec);
    next = r.heads;
  };
  add({
    code: "AMENITY",
    nameEn: "Amenity Fees",
    nameHi: "सुविधा शुल्क",
    category: "annual",
    frequency: "annual",
    isOptional: false,
    isRefundable: false,
    isActive: true,
    sortOrder: 32,
  });
  add({
    code: "COMMUNICATION",
    nameEn: "Communication Fee",
    nameHi: "संचार शुल्क",
    category: "annual",
    frequency: "annual",
    isOptional: false,
    isRefundable: false,
    isActive: true,
    sortOrder: 33,
  });
  add({
    code: "MISC",
    nameEn: "Miscellaneous Fee",
    nameHi: "विविध शुल्क",
    category: "misc",
    frequency: "annual",
    isOptional: false,
    isRefundable: false,
    isActive: true,
    sortOrder: 34,
  });
  return next;
}

function ensureAcademicYear202627(state: MastersState): MastersState {
  const years = state.academicYears ?? [];
  if (years.some((y) => y.code === PRIMARY_FEE_AY)) return state;
  const nextYear: AcademicYearMaster = {
    id: nid("ay"),
    code: PRIMARY_FEE_AY,
    label: PRIMARY_FEE_AY,
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
    status: "upcoming",
    isActive: true,
  };
  return { ...state, academicYears: [...years, nextYear] };
}

function classIdsForPrimary(state: MastersState): string[] {
  const names = new Set(PRIMARY_CLASS_NAMES.map((n) => n.toLowerCase()));
  return (state.classes ?? [])
    .filter((c) => names.has(c.name.trim().toLowerCase()))
    .map((c) => c.id);
}

type HeadCode =
  | "AMENITY"
  | "COMMUNICATION"
  | "MISC"
  | "TUITION"
  | "SECURITY"
  | "EXAM";

type MonthCharges = Partial<Record<HeadCode, number>>;

function buildPrimaryLines(
  groupId: string,
  headId: Record<string, string>,
  instId: Record<string, string>,
  plan: Record<string, MonthCharges>,
): FeeStructureLine[] {
  const lines: FeeStructureLine[] = [];
  for (const [month, charges] of Object.entries(plan)) {
    const installmentId = instId[month];
    if (!installmentId) continue;
    for (const [code, rupees] of Object.entries(charges)) {
      if (!rupees) continue;
      const feeHeadId = headId[code];
      if (!feeHeadId) continue;
      lines.push({
        id: nid("fsl"),
        feeGroupId: groupId,
        feeHeadId,
        classId: null,
        amountPaise: rupees * 100,
        installmentId,
      });
    }
  }
  return lines;
}

function monthlyTuition(): MonthCharges {
  return { TUITION: 1650 };
}

function primaryNewPlan(): Record<string, MonthCharges> {
  const plan: Record<string, MonthCharges> = {
    APR: {
      AMENITY: 1500,
      COMMUNICATION: 500,
      MISC: 1500,
      TUITION: 1650,
      SECURITY: 3500,
    },
    SEP: { TUITION: 1650, EXAM: 500 },
    FEB: { TUITION: 1650, EXAM: 500 },
  };
  for (const m of ["MAY", "JUN", "JUL", "AUG", "OCT", "NOV", "DEC", "JAN", "MAR"]) {
    plan[m] = monthlyTuition();
  }
  return plan;
}

function primaryPromotePlan(): Record<string, MonthCharges> {
  const plan: Record<string, MonthCharges> = {
    APR: {
      AMENITY: 1500,
      COMMUNICATION: 500,
      MISC: 1000,
      TUITION: 1650,
    },
    SEP: { TUITION: 1650, EXAM: 500 },
    FEB: { TUITION: 1650, EXAM: 500 },
  };
  for (const m of ["MAY", "JUN", "JUL", "AUG", "OCT", "NOV", "DEC", "JAN", "MAR"]) {
    plan[m] = monthlyTuition();
  }
  return plan;
}

/** Idempotent — adds Primary I–V 2026-27 groups + lines when missing. */
export function ensurePrimaryFeeStructure202627(
  state: MastersState,
): MastersState {
  const hasGroups = (state.feeGroups ?? []).some(
    (g) =>
      g.academicYearCode === PRIMARY_FEE_AY &&
      (g.code === NEW_GROUP_CODE || g.code === PROMOTE_GROUP_CODE),
  );
  if (hasGroups) return state;

  const classIds = classIdsForPrimary(state);
  if (!classIds.length) return state;

  let next = ensureAcademicYear202627(state);
  next = ensureAprToMarInstallments(next, PRIMARY_FEE_AY);
  next = {
    ...next,
    feeHeads: ensurePrimaryFeeHeads(next.feeHeads ?? []),
  };

  const headId: Record<string, string> = {};
  for (const h of next.feeHeads) {
    headId[h.code.toUpperCase()] = h.id;
  }

  const instId: Record<string, string> = {};
  for (const i of next.installments) {
    if (i.academicYearCode === PRIMARY_FEE_AY) {
      instId[i.code] = i.id;
    }
  }

  const newGroupId = nid("fg");
  const promoteGroupId = nid("fg");

  const newGroup: FeeGroup = {
    id: newGroupId,
    code: NEW_GROUP_CODE,
    name: "New admission · Primary (I–V)",
    academicYearCode: PRIMARY_FEE_AY,
    studentType: "NEW",
    classIds,
    isActive: true,
    structurePublishedAt: null,
    structurePublishedBy: "",
  };

  const promoteGroup: FeeGroup = {
    id: promoteGroupId,
    code: PROMOTE_GROUP_CODE,
    name: "Promoted · Primary (I–V)",
    academicYearCode: PRIMARY_FEE_AY,
    studentType: "PROMOTE",
    classIds,
    isActive: true,
    structurePublishedAt: null,
    structurePublishedBy: "",
  };

  const newLines = buildPrimaryLines(
    newGroupId,
    headId,
    instId,
    primaryNewPlan(),
  );
  const promoteLines = buildPrimaryLines(
    promoteGroupId,
    headId,
    instId,
    primaryPromotePlan(),
  );

  return {
    ...next,
    feeGroups: [...(next.feeGroups ?? []), newGroup, promoteGroup],
    feeStructureLines: [
      ...(next.feeStructureLines ?? []),
      ...newLines,
      ...promoteLines,
    ],
  };
}

export function sumFeeGroupStructureRupees(
  state: MastersState,
  groupId: string,
): number {
  const paise = (state.feeStructureLines ?? [])
    .filter((l) => l.feeGroupId === groupId)
    .reduce((s, l) => s + l.amountPaise, 0);
  return Math.round(paise / 100);
}

export function primaryFeeStructureTotals(state: MastersState): {
  newRupees: number;
  promoteRupees: number;
} | null {
  const newG = (state.feeGroups ?? []).find((g) => g.code === NEW_GROUP_CODE);
  const promG = (state.feeGroups ?? []).find(
    (g) => g.code === PROMOTE_GROUP_CODE,
  );
  if (!newG || !promG) return null;
  return {
    newRupees: sumFeeGroupStructureRupees(state, newG.id),
    promoteRupees: sumFeeGroupStructureRupees(state, promG.id),
  };
}
