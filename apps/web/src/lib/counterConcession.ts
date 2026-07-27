/**
 * When a counter discount is given on a recurring fee head, optionally create
 * a Masters concession rule + student grant for future installments.
 */

import { isStudentAlreadyGranted } from "@/lib/concessionSuggest";
import type { CounterDiscountSlice } from "@/lib/feeAdjustments";
import { FEE_ADJUST_AUTO_LIMIT_PAISE } from "@/lib/feeAdjustments";
import type { FeeDueLine } from "@/lib/fees";
import {
  formatInr,
  loadMasters,
  newId,
  saveMasters,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";

export type FutureConcessionCandidate = {
  /** Stable key for UI selection */
  key: string;
  dueKey: string;
  studentId: string;
  studentName: string;
  feeHeadId: string;
  feeHeadName: string;
  discountPaise: number;
  billedPaise: number;
  installmentCount: number;
  currentDueOn: string;
  futureEffectiveFrom: string;
  dueLabel: string;
};

function candidateKey(
  studentId: string,
  feeHeadId: string,
  discountPaise: number,
): string {
  return `${studentId}:${feeHeadId}:${discountPaise}`;
}

/** How many structure lines bill this head for the student's fee group. */
export function structureLineCountForHead(
  masters: MastersState,
  feeGroupId: string | null | undefined,
  feeHeadId: string,
  academicYearCode: string,
): number {
  if (!feeGroupId || !feeHeadId) return 0;
  return masters.feeStructureLines.filter((sl) => {
    if (sl.feeGroupId !== feeGroupId || sl.feeHeadId !== feeHeadId) return false;
    if (!sl.installmentId) return true;
    const inst = masters.installments.find((i) => i.id === sl.installmentId);
    return (
      !!inst &&
      inst.isActive &&
      inst.academicYearCode === academicYearCode
    );
  }).length;
}

export function isRecurringAcademicFeeHead(
  masters: MastersState,
  student: SisStudent,
  feeHeadId: string,
  academicYearCode: string,
): boolean {
  return (
    structureLineCountForHead(
      masters,
      student.feeGroupId,
      feeHeadId,
      academicYearCode,
    ) >= 2
  );
}

function nextInstallmentDueOn(
  masters: MastersState,
  student: SisStudent,
  feeHeadId: string,
  afterDueOn: string,
): string {
  const dates = masters.feeStructureLines
    .filter(
      (sl) =>
        sl.feeGroupId === student.feeGroupId && sl.feeHeadId === feeHeadId,
    )
    .map((sl) => {
      if (!sl.installmentId) return afterDueOn;
      return (
        masters.installments.find((i) => i.id === sl.installmentId)?.dueOn ??
        afterDueOn
      );
    })
    .filter((d) => d > afterDueOn)
    .sort();
  if (dates.length > 0) return dates[0]!;
  const y = afterDueOn.slice(0, 4);
  return `${y}-12-31`;
}

export function listFutureConcessionCandidates(
  slices: CounterDiscountSlice[],
  dues: FeeDueLine[],
  masters: MastersState,
  students: SisStudent[],
  academicYearCode: string,
): FutureConcessionCandidate[] {
  const dueByKey = new Map(dues.map((d) => [d.dueKey, d]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const out: FutureConcessionCandidate[] = [];
  const seen = new Set<string>();

  for (const slice of slices) {
    const due = dueByKey.get(slice.dueKey);
    if (!due || due.kind !== "academic" || !due.feeHeadId) continue;
    const student = studentById.get(slice.studentId);
    if (!student) continue;

    const key = candidateKey(slice.studentId, due.feeHeadId, slice.amountPaise);
    if (seen.has(key)) continue;

    const installmentCount = structureLineCountForHead(
      masters,
      student.feeGroupId,
      due.feeHeadId,
      academicYearCode,
    );
    if (installmentCount < 2) continue;

    seen.add(key);
    out.push({
      key,
      dueKey: slice.dueKey,
      studentId: slice.studentId,
      studentName: student.fullName,
      feeHeadId: due.feeHeadId,
      feeHeadName: due.feeHeadName,
      discountPaise: slice.amountPaise,
      billedPaise: due.billedPaise,
      installmentCount,
      currentDueOn: due.dueOn,
      futureEffectiveFrom: nextInstallmentDueOn(
        masters,
        student,
        due.feeHeadId,
        due.dueOn,
      ),
      dueLabel: due.label,
    });
  }
  return out;
}

function counterRuleCode(feeHeadCode: string, discountPaise: number): string {
  const safe = (feeHeadCode || "HEAD").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `CTR-${safe}-${discountPaise}`;
}

function findMatchingCounterRule(
  masters: MastersState,
  academicYearCode: string,
  feeHeadId: string,
  discountPaise: number,
  feeHeadCode: string,
): ConcessionRule | undefined {
  const code = counterRuleCode(feeHeadCode, discountPaise);
  return masters.concessions.find(
    (c) =>
      c.isActive &&
      c.academicYearCode === academicYearCode &&
      (c.code === code ||
        (c.mode === "fixed" &&
          c.value === discountPaise &&
          c.feeHeadIds.length === 1 &&
          c.feeHeadIds[0] === feeHeadId &&
          c.kind === "other" &&
          c.notes.includes("Fee Take counter"))),
  );
}

function ensureCounterConcessionRule(
  masters: MastersState,
  input: {
    academicYearCode: string;
    feeHeadId: string;
    feeHeadCode: string;
    feeHeadName: string;
    discountPaise: number;
    reason: string;
  },
): { state: MastersState; rule: ConcessionRule; created: boolean } {
  const existing = findMatchingCounterRule(
    masters,
    input.academicYearCode,
    input.feeHeadId,
    input.discountPaise,
    input.feeHeadCode,
  );
  if (existing) {
    return { state: masters, rule: existing, created: false };
  }

  const rule: ConcessionRule = {
    id: newId("cnc"),
    code: counterRuleCode(input.feeHeadCode, input.discountPaise),
    name: `${input.feeHeadName} · ${formatInr(input.discountPaise)} off`,
    kind: "other",
    academicYearCode: input.academicYearCode,
    mode: "fixed",
    value: input.discountPaise,
    siblingTiers: [],
    feeHeadIds: [input.feeHeadId],
    autoApproveMaxPaise: FEE_ADJUST_AUTO_LIMIT_PAISE,
    documentationRequired: false,
    incompatibleCodes: [],
    notes: `Fee Take counter · recurring discount · ${input.reason.trim() || "Management approval"}`,
    isActive: true,
  };

  return {
    state: {
      ...masters,
      concessions: [...masters.concessions, rule],
    },
    rule,
    created: true,
  };
}

function grantNeedsPrincipal(rule: ConcessionRule, discountPaise: number): boolean {
  if (rule.autoApproveMaxPaise == null) return true;
  return discountPaise > rule.autoApproveMaxPaise;
}

export function applyFutureConcessionsFromCounter(input: {
  candidates: FutureConcessionCandidate[];
  applyKeys: Set<string>;
  reason: string;
  academicYearCode: string;
}):
  | {
      ok: true;
      granted: number;
      skipped: number;
      pending: number;
      ruleLabels: string[];
    }
  | { ok: false; error: string } {
  if (input.applyKeys.size === 0) {
    return { ok: true, granted: 0, skipped: 0, pending: 0, ruleLabels: [] };
  }

  let masters = loadMasters();
  const grants = [...(masters.concessionGrants ?? [])];
  const reason = input.reason.trim() || "Counter discount at Fee Take";
  let granted = 0;
  let skipped = 0;
  let pending = 0;
  const ruleLabels: string[] = [];

  for (const item of input.candidates) {
    if (!input.applyKeys.has(item.key)) continue;

    const head = masters.feeHeads.find((h) => h.id === item.feeHeadId);
    const ensured = ensureCounterConcessionRule(masters, {
      academicYearCode: input.academicYearCode,
      feeHeadId: item.feeHeadId,
      feeHeadCode: head?.code ?? item.feeHeadName,
      feeHeadName: item.feeHeadName,
      discountPaise: item.discountPaise,
      reason,
    });
    masters = ensured.state;
    const rule = ensured.rule;
    if (ensured.created) {
      ruleLabels.push(rule.name);
    }

    if (isStudentAlreadyGranted(item.studentId, rule, grants, masters)) {
      skipped += 1;
      continue;
    }

    const needsPrincipal = grantNeedsPrincipal(rule, item.discountPaise);
    const now = new Date().toISOString();
    const row: ConcessionGrant = {
      id: newId("cg"),
      concessionId: rule.id,
      studentId: item.studentId,
      status: needsPrincipal ? "pending" : "approved",
      reason: `Fee Take · ${reason} · from ${item.dueLabel}`,
      effectiveFrom: item.futureEffectiveFrom,
      effectiveTo: null,
      createdAt: now,
      siblingChildNo: null,
    };
    grants.push(row);
    if (needsPrincipal) pending += 1;
    else granted += 1;
  }

  saveMasters({ ...masters, concessionGrants: grants });

  return { ok: true, granted, skipped, pending, ruleLabels };
}
