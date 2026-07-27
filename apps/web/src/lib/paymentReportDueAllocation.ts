/**
 * Map imported payment report lines onto live Fee Take due keys.
 *
 * PDF rules:
 * - Previous Due-2025 column → arrears dues only (ignore month in receipt note)
 * - Tuition / Amenity / etc. → session month dues from ReceiptNote
 * - Head column = cash collected; Concession column = discount (not fee structure)
 */

import {
  normAdmissionNo,
  parseReceiptScope,
  scopeForImportedHead,
} from "@/lib/dailyCollectionReportImport";
import type { ParsedReceiptScope } from "@/lib/dailyCollectionReportImport";
import {
  computeStudentDues,
  type DueKind,
  type FeeDueLine,
  type FeesState,
  type VoucherLine,
} from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";
import type { ParsedReceiptLine } from "@/lib/inventoryPaymentReportImport";

export type AllocatedPaymentLine = Pick<
  VoucherLine,
  | "dueKey"
  | "label"
  | "kind"
  | "amountPaise"
  | "billedPaise"
  | "concessionPaise"
>;

function headCodeForDue(
  masters: MastersState,
  due: FeeDueLine,
): string | null {
  if (due.kind === "arrears") return "ARREARS";
  if (due.kind === "transport") return "TRANSPORT";
  const head = masters.feeHeads.find((h) => h.id === due.feeHeadId);
  return head?.code.toUpperCase() ?? null;
}

function dueMatchesInstallmentScope(
  due: FeeDueLine,
  masters: MastersState,
  scope: ParsedReceiptScope,
  headCode: string,
): boolean {
  if (headCode === "ARREARS") return due.kind === "arrears";
  if (!scope.installmentCodes.length) return true;
  if (due.kind === "arrears") return false;
  if (!due.installmentId) {
    return due.kind === "transport" || scope.installmentCodes.includes("APR");
  }
  const inst = masters.installments.find((i) => i.id === due.installmentId);
  if (!inst) return true;
  return scope.installmentCodes.includes(inst.code.toUpperCase());
}

function openDuesForImportedHead(
  student: SisStudent,
  masters: MastersState,
  fees: FeesState,
  headCode: string,
  scope: ParsedReceiptScope,
): FeeDueLine[] {
  const dues = computeStudentDues(student, masters, fees, {
    includeFuture: true,
    includePaid: false,
  }).filter((d) => d.balancePaise > 0);

  return dues
    .filter((d) => headCodeForDue(masters, d) === headCode)
    .filter((d) => dueMatchesInstallmentScope(d, masters, scope, headCode))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** Post collected amount onto open student dues for this head. */
export function allocateImportedLineToDueKeys(input: {
  student: SisStudent;
  masters: MastersState;
  fees: FeesState;
  headCode: string;
  headLabel: string;
  amountPaise: number;
  billedPaise: number;
  concessionPaise: number;
  scope: ParsedReceiptScope;
}): AllocatedPaymentLine[] {
  const {
    student,
    masters,
    fees,
    headCode,
    headLabel,
    amountPaise,
    billedPaise,
    concessionPaise,
    scope,
  } = input;

  if (amountPaise <= 0) return [];

  const candidates = openDuesForImportedHead(
    student,
    masters,
    fees,
    headCode,
    scope,
  );

  const out: AllocatedPaymentLine[] = [];
  let remaining = amountPaise;
  let concRemaining = concessionPaise;

  for (const due of candidates) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, due.balancePaise);
    if (slice <= 0) continue;
    const concSlice =
      concessionPaise > 0
        ? Math.min(
            concRemaining,
            Math.round((concessionPaise * slice) / amountPaise),
          )
        : 0;
    concRemaining -= concSlice;
    out.push({
      dueKey: due.dueKey,
      label: due.label,
      kind: due.kind as DueKind,
      amountPaise: slice,
      billedPaise: slice + concSlice,
      concessionPaise: concSlice,
    });
    remaining -= slice;
  }

  if (remaining > 0 && candidates.length > 0) {
    const last = candidates[candidates.length - 1]!;
    const prev = out.find((l) => l.dueKey === last.dueKey);
    if (prev) {
      prev.amountPaise += remaining;
      prev.billedPaise = (prev.billedPaise ?? 0) + remaining + concRemaining;
      prev.concessionPaise = (prev.concessionPaise ?? 0) + concRemaining;
    } else {
      out.push({
        dueKey: last.dueKey,
        label: last.label,
        kind: last.kind as DueKind,
        amountPaise: remaining,
        billedPaise: remaining + concRemaining,
        concessionPaise: concRemaining,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      dueKey: `legacy:unposted:${student.id}:${headCode}:${scope.installmentCodes.join("-") || "GEN"}`,
      label: headLabel,
      kind:
        headCode === "ARREARS"
          ? "arrears"
          : headCode === "TRANSPORT"
            ? "transport"
            : "academic",
      amountPaise,
      billedPaise,
      concessionPaise,
    });
  }

  return out;
}

function findStudentByAdmission(
  sis: SisState,
  admissionNo: string,
  ay?: string,
): SisStudent | undefined {
  const key = normAdmissionNo(admissionNo);
  if (!key) return undefined;
  const pool = sis.students.filter((s) => !ay || s.academicYearCode === ay);
  return (
    pool.find((s) => normAdmissionNo(s.admissionNo) === key) ??
    pool.find((s) =>
      normAdmissionNo(s.admissionNo).endsWith(key.replace(/^BHB-/, "")),
    )
  );
}

export function relinkImportedPaymentsToStudentDues(input: {
  fees: FeesState;
  sis: SisState;
  masters: MastersState;
  academicYearCode?: string;
}): {
  fees: FeesState;
  relinkedVouchers: number;
  relinkedLines: number;
  stillLegacy: number;
} {
  const ay = input.academicYearCode ?? "";
  let relinkedVouchers = 0;
  let relinkedLines = 0;
  let stillLegacy = 0;

  const vouchers = input.fees.vouchers.map((v) => {
    if (v.voidedAt) return v;
    const isLegacy = v.lines.some(
      (l) =>
        l.dueKey.startsWith("legacy:") ||
        !l.studentId ||
        l.dueKey.startsWith("legacy:unposted:"),
    );
    if (!isLegacy) return v;

    const admMatch = v.note.match(/Adm\s+(BHB-\S+)/i);
    const admissionNo = admMatch?.[1] ?? "";
    const noteMatch = v.note.match(/Note:\s*(.+?)(?:\s·|$)/);
    const receiptNote = noteMatch?.[1] ?? "";
    const student =
      findStudentByAdmission(input.sis, admissionNo, ay) ??
      (v.lines[0]?.studentId
        ? input.sis.students.find((s) => s.id === v.lines[0]!.studentId)
        : undefined);

    if (!student?.feeGroupId) {
      stillLegacy += v.lines.length;
      return v;
    }

    const newLines: VoucherLine[] = [];
    let changed = false;

    for (const line of v.lines) {
      if (!line.dueKey.startsWith("legacy:")) {
        newLines.push(line);
        continue;
      }

      const headCode = inferHeadCodeFromLabel(line.label);
      const scope = scopeForImportedHead(headCode, receiptNote);

      const allocated = allocateImportedLineToDueKeys({
        student,
        masters: input.masters,
        fees: input.fees,
        headCode,
        headLabel: line.label.split(" · ")[0] ?? line.label,
        amountPaise: line.amountPaise,
        billedPaise: line.billedPaise ?? line.amountPaise,
        concessionPaise: line.concessionPaise ?? 0,
        scope,
      });

      for (const a of allocated) {
        newLines.push({
          ...line,
          dueKey: a.dueKey,
          studentId: student.id,
          studentName: student.fullName,
          label: a.label,
          kind: a.kind,
          amountPaise: a.amountPaise,
          billedPaise: a.billedPaise,
          concessionPaise: a.concessionPaise,
        });
        relinkedLines += 1;
        if (a.dueKey.startsWith("legacy:")) stillLegacy += 1;
      }
      changed = true;
    }

    if (!changed) return v;
    relinkedVouchers += 1;
    return { ...v, lines: newLines, householdId: student.householdId };
  });

  return {
    fees: { ...input.fees, vouchers },
    relinkedVouchers,
    relinkedLines,
    stillLegacy,
  };
}

function inferHeadCodeFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("previous due")) return "ARREARS";
  if (l.includes("tuition")) return "TUITION";
  if (l.includes("transport")) return "TRANSPORT";
  if (l.includes("amenity")) return "AMENITY";
  if (l.includes("misc")) return "MISC";
  if (l.includes("communication")) return "COMMUNICATION";
  if (l.includes("exam")) return "EXAM";
  if (l.includes("registration") || l.includes("admission")) return "ADMISSION";
  if (l.includes("security")) return "SECURITY";
  return "TUITION";
}

export function buildVoucherLinesFromImport(input: {
  student: SisStudent | undefined;
  masters: MastersState;
  fees: FeesState;
  lines: ParsedReceiptLine[];
  receiptNote: string;
  fallback: (line: ParsedReceiptLine, idx: number) => VoucherLine;
}): VoucherLine[] {
  if (!input.student?.feeGroupId) {
    return input.lines.map((l, idx) => input.fallback(l, idx));
  }

  const out: VoucherLine[] = [];
  for (let idx = 0; idx < input.lines.length; idx++) {
    const l = input.lines[idx]!;
    const scope = scopeForImportedHead(l.headCode, input.receiptNote);
    const concRupees = l.concessionRupees ?? 0;
    const amountPaise = Math.round(l.amountRupees * 100);
    const concessionPaise = Math.round(concRupees * 100);
    const billedPaise = Math.round(
      (l.billedRupees ?? l.amountRupees + concRupees) * 100,
    );

    const allocated = allocateImportedLineToDueKeys({
      student: input.student,
      masters: input.masters,
      fees: input.fees,
      headCode: l.headCode,
      headLabel: l.headLabel,
      amountPaise,
      billedPaise,
      concessionPaise,
      scope,
    });

    for (const a of allocated) {
      out.push({
        dueKey: a.dueKey,
        studentId: input.student.id,
        studentName: input.student.fullName,
        label: a.label,
        kind: a.kind,
        amountPaise: a.amountPaise,
        billedPaise: a.billedPaise,
        concessionPaise: a.concessionPaise ?? 0,
        concessionDetails:
          (a.concessionPaise ?? 0) > 0
            ? [
                {
                  grantId: "",
                  concessionId: "",
                  code: "pdf_concession",
                  name: "Concession (PDF)",
                  kind: "import",
                  rateLabel: scope.label,
                  siblingLabel: "",
                  amountPaise: a.concessionPaise ?? 0,
                },
              ]
            : [],
      });
    }
  }
  return out;
}
