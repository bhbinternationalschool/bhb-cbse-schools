/**
 * BHB Foundation (Nursery–UKG) fee structure — session 2026-27.
 * Source: school fee PDF (new ₹25,500 · promoted ₹21,500; transport extra).
 */

import type {
  FeeGroup,
  FeeHead,
  FeeStructureLine,
  MastersState,
} from "@/lib/masters";
import { ensureAprToMarInstallments } from "@/lib/masters";
import type { AcademicYearMaster } from "@/lib/foundationMasters";

export const FOUNDATION_FEE_AY = "2026-27";

const NEW_GROUP_CODE = "NEW_FOUNDATION_2627";
const PROMOTE_GROUP_CODE = "PROMOTE_FOUNDATION_2627";

const FOUNDATION_CLASS_NAMES = ["Nursery", "LKG", "UKG"];

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

function ensureFoundationFeeHeads(heads: FeeHead[]): FeeHead[] {
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
  if (years.some((y) => y.code === FOUNDATION_FEE_AY)) return state;
  const nextYear: AcademicYearMaster = {
    id: nid("ay"),
    code: FOUNDATION_FEE_AY,
    label: FOUNDATION_FEE_AY,
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
    status: "upcoming",
    isActive: true,
  };
  return { ...state, academicYears: [...years, nextYear] };
}

function classIdsForFoundation(state: MastersState): string[] {
  const names = new Set(FOUNDATION_CLASS_NAMES.map((n) => n.toLowerCase()));
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

function buildFoundationLines(
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
  return { TUITION: 1500 };
}

function foundationNewPlan(): Record<string, MonthCharges> {
  const plan: Record<string, MonthCharges> = {
    APR: {
      AMENITY: 1500,
      COMMUNICATION: 500,
      MISC: 1500,
      TUITION: 1500,
      SECURITY: 3000,
    },
    SEP: { TUITION: 1500, EXAM: 500 },
    FEB: { TUITION: 1500, EXAM: 500 },
  };
  for (const m of ["MAY", "JUN", "JUL", "AUG", "OCT", "NOV", "DEC", "JAN", "MAR"]) {
    plan[m] = monthlyTuition();
  }
  return plan;
}

function foundationPromotePlan(): Record<string, MonthCharges> {
  const plan: Record<string, MonthCharges> = {
    APR: {
      AMENITY: 1000,
      COMMUNICATION: 500,
      MISC: 1000,
      TUITION: 1500,
    },
    SEP: { TUITION: 1500, EXAM: 500 },
    FEB: { TUITION: 1500, EXAM: 500 },
  };
  for (const m of ["MAY", "JUN", "JUL", "AUG", "OCT", "NOV", "DEC", "JAN", "MAR"]) {
    plan[m] = monthlyTuition();
  }
  return plan;
}

/** Idempotent — adds Foundation 2026-27 groups + lines when missing. */
export function ensureFoundationFeeStructure202627(
  state: MastersState,
): MastersState {
  const hasGroups = (state.feeGroups ?? []).some(
    (g) =>
      g.academicYearCode === FOUNDATION_FEE_AY &&
      (g.code === NEW_GROUP_CODE || g.code === PROMOTE_GROUP_CODE),
  );
  if (hasGroups) return state;

  const classIds = classIdsForFoundation(state);
  if (!classIds.length) return state;

  let next = ensureAcademicYear202627(state);
  next = ensureAprToMarInstallments(next, FOUNDATION_FEE_AY);
  next = {
    ...next,
    feeHeads: ensureFoundationFeeHeads(next.feeHeads ?? []),
  };

  const headId: Record<string, string> = {};
  for (const h of next.feeHeads) {
    headId[h.code.toUpperCase()] = h.id;
  }

  const instId: Record<string, string> = {};
  for (const i of next.installments) {
    if (i.academicYearCode === FOUNDATION_FEE_AY) {
      instId[i.code] = i.id;
    }
  }

  const newGroupId = nid("fg");
  const promoteGroupId = nid("fg");

  const newGroup: FeeGroup = {
    id: newGroupId,
    code: NEW_GROUP_CODE,
    name: "New admission · Foundation (Nur–UKG)",
    academicYearCode: FOUNDATION_FEE_AY,
    studentType: "NEW",
    classIds,
    isActive: true,
    structurePublishedAt: null,
    structurePublishedBy: "",
  };

  const promoteGroup: FeeGroup = {
    id: promoteGroupId,
    code: PROMOTE_GROUP_CODE,
    name: "Promoted · Foundation (Nur–UKG)",
    academicYearCode: FOUNDATION_FEE_AY,
    studentType: "PROMOTE",
    classIds,
    isActive: true,
    structurePublishedAt: null,
    structurePublishedBy: "",
  };

  const newLines = buildFoundationLines(
    newGroupId,
    headId,
    instId,
    foundationNewPlan(),
  );
  const promoteLines = buildFoundationLines(
    promoteGroupId,
    headId,
    instId,
    foundationPromotePlan(),
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

/** Sum annual structure for a fee group (rupees). */
export function sumFeeGroupStructureRupees(
  state: MastersState,
  groupId: string,
): number {
  const paise = (state.feeStructureLines ?? [])
    .filter((l) => l.feeGroupId === groupId)
    .reduce((s, l) => s + l.amountPaise, 0);
  return Math.round(paise / 100);
}

export function foundationFeeStructureTotals(state: MastersState): {
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
