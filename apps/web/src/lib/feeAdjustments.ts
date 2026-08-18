/**
 * §6b.1 Fee adjustments — waive / write-off / stop future / change group / ad-hoc.
 * Posted adjustments reduce Fee Take balances; over-limit items need Principal approve.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  DEFAULT_AY,
  cloneFeeSetupToAcademicYear,
  currentAcademicYearCode,
  formatInr,
  loadMasters,
  saveMasters,
  type MastersState,
} from "@/lib/masters";
import { openFeeDues, type FeeDueLine } from "@/lib/fees";
import { loadSis, saveSis, type SisStudent } from "@/lib/sis";

export type FeeAdjustmentType =
  | "waiver"
  | "write_off"
  | "stop_future"
  | "amount_edit"
  | "adhoc"
  | "change_group";

export type FeeAdjustmentReason =
  | "error_correction"
  | "hardship"
  | "left_school"
  | "rte"
  | "management"
  | "counter_discount"
  | "duplicate"
  | "other";

export type FeeAdjustmentStatus =
  | "pending_approval"
  | "posted"
  | "rejected"
  | "voided";

export type FeeAdjustment = {
  id: string;
  studentId: string;
  academicYearCode: string;
  type: FeeAdjustmentType;
  /** Target dueKey for waiver / write_off / amount_edit; null for stop_future / change_group */
  dueKey: string | null;
  label: string;
  /** Paise waived / written off / adhoc billed / new amount for edit */
  amountPaise: number;
  reasonCode: FeeAdjustmentReason;
  reason: string;
  status: FeeAdjustmentStatus;
  /** For stop_future — cancel dues with dueOn > this date */
  stopAfterDate: string | null;
  /** For change_group */
  fromFeeGroupId: string | null;
  toFeeGroupId: string | null;
  /** For adhoc */
  feeHeadId: string | null;
  dueOn: string | null;
  createdAt: string;
  createdBy: string;
  decidedAt: string | null;
  decidedBy: string;
  decisionNote: string;
};

/** Accounts may post without Principal up to this (₹10,000). */
export const FEE_ADJUST_AUTO_LIMIT_PAISE = 10_000_00;

const ADJUST_KEY = "bhb_fee_adjustments_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadFeeAdjustments(): FeeAdjustment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ADJUST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeeAdjustment[];
    return Array.isArray(parsed) ? parsed.map(normalizeAdjustment) : [];
  } catch {
    return [];
  }
}

export function saveFeeAdjustments(rows: FeeAdjustment[]) {
  if (!assertModulePermission("fees", "edit", "saveFeeAdjustments")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(ADJUST_KEY, JSON.stringify(rows));
  void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("fee_adjustments", { rows: rows }));
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeFeeAdjustmentsLocalRaw(state: { rows: FeeAdjustment[] }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ADJUST_KEY, JSON.stringify(state.rows));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

function normalizeAdjustment(a: Partial<FeeAdjustment>): FeeAdjustment {
  return {
    id: a.id || id("fadj"),
    studentId: a.studentId || "",
    academicYearCode: a.academicYearCode || DEFAULT_AY,
    type: (a.type as FeeAdjustmentType) || "waiver",
    dueKey: a.dueKey ?? null,
    label: a.label || "",
    amountPaise: Math.max(0, Math.round(a.amountPaise || 0)),
    reasonCode: (a.reasonCode as FeeAdjustmentReason) || "other",
    reason: a.reason || "",
    status: (a.status as FeeAdjustmentStatus) || "posted",
    stopAfterDate: a.stopAfterDate ?? null,
    fromFeeGroupId: a.fromFeeGroupId ?? null,
    toFeeGroupId: a.toFeeGroupId ?? null,
    feeHeadId: a.feeHeadId ?? null,
    dueOn: a.dueOn ?? null,
    createdAt: a.createdAt || new Date().toISOString(),
    createdBy: a.createdBy || "",
    decidedAt: a.decidedAt ?? null,
    decidedBy: a.decidedBy || "",
    decisionNote: a.decisionNote || "",
  };
}

export const FEE_ADJUST_REASONS: {
  value: FeeAdjustmentReason;
  label: string;
}[] = [
  { value: "error_correction", label: "Error correction" },
  { value: "hardship", label: "Hardship / goodwill" },
  { value: "left_school", label: "Left school / TC" },
  { value: "rte", label: "RTE / EWS" },
  { value: "management", label: "Management decision" },
  { value: "counter_discount", label: "Counter discount" },
  { value: "duplicate", label: "Duplicate charge" },
  { value: "other", label: "Other" },
];

function needsApproval(amountPaise: number, type: FeeAdjustmentType): boolean {
  if (type === "write_off" && amountPaise > FEE_ADJUST_AUTO_LIMIT_PAISE) {
    return true;
  }
  if (
    (type === "waiver" || type === "write_off" || type === "amount_edit") &&
    amountPaise > FEE_ADJUST_AUTO_LIMIT_PAISE
  ) {
    return true;
  }
  return false;
}

export function postedWaiversByDueKey(
  studentId?: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of loadFeeAdjustments()) {
    if (a.status !== "posted") continue;
    if (studentId && a.studentId !== studentId) continue;
    if (
      (a.type === "waiver" || a.type === "write_off") &&
      a.dueKey
    ) {
      map.set(a.dueKey, (map.get(a.dueKey) ?? 0) + a.amountPaise);
    }
  }
  return map;
}

/** Due keys fully cancelled by stop_future (dueOn after stop date). */
export function stopFutureBlocks(
  studentId: string,
  dueOn: string,
): boolean {
  for (const a of loadFeeAdjustments()) {
    if (a.status !== "posted") continue;
    if (a.studentId !== studentId || a.type !== "stop_future") continue;
    if (!a.stopAfterDate) continue;
    if (dueOn > a.stopAfterDate) return true;
  }
  return false;
}

export function listAdhocDuesForStudent(
  studentId: string,
  feesPaidMap: Map<string, number>,
): FeeDueLine[] {
  const lines: FeeDueLine[] = [];
  const masters = loadMasters();
  for (const a of loadFeeAdjustments()) {
    if (a.status !== "posted") continue;
    if (a.studentId !== studentId || a.type !== "adhoc") continue;
    const dueKey = `adj:${a.id}`;
    const paid = feesPaidMap.get(dueKey) ?? 0;
    const balance = Math.max(0, a.amountPaise - paid);
    if (balance <= 0 && paid <= 0) continue;
    const head =
      masters.feeHeads.find((h) => h.id === a.feeHeadId)?.nameEn ?? "Ad-hoc";
    lines.push({
      dueKey,
      kind: "special",
      studentId,
      feeHeadId: a.feeHeadId || "",
      feeHeadName: head,
      installmentId: null,
      installmentLabel: "Adjustment",
      specialFeeId: null,
      structureLineId: null,
      storeIssueId: null,
      storeIssueNo: "",
      storeItems: [],
      transport: null,
      dueOn: a.dueOn || a.createdAt.slice(0, 10),
      billedPaise: a.amountPaise,
      concessionPaise: 0,
      concessionDetails: [],
      paidPaise: paid,
      balancePaise: balance,
      label: a.label || `${head} · Adjustment`,
    });
  }
  return lines;
}

export function createFeeAdjustment(input: {
  studentId: string;
  type: FeeAdjustmentType;
  dueKey?: string | null;
  label: string;
  amountPaise: number;
  reasonCode: FeeAdjustmentReason;
  reason: string;
  createdBy: string;
  stopAfterDate?: string | null;
  fromFeeGroupId?: string | null;
  toFeeGroupId?: string | null;
  feeHeadId?: string | null;
  dueOn?: string | null;
  academicYearCode?: string;
  /** Force Principal queue even under limit */
  forceApproval?: boolean;
}):
  | { ok: true; adjustment: FeeAdjustment }
  | { ok: false; error: string } {
  if (!input.studentId) return { ok: false, error: "Student required" };
  if (!input.reason.trim()) return { ok: false, error: "Reason is required" };

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const ay =
    input.academicYearCode ||
    student.academicYearCode ||
    currentAcademicYearCode();

  if (
    (input.type === "waiver" || input.type === "write_off") &&
    !input.dueKey
  ) {
    return { ok: false, error: "Select a due line to waive" };
  }
  if (input.type === "stop_future" && !input.stopAfterDate) {
    return { ok: false, error: "Stop-after date required" };
  }
  if (input.type === "change_group" && !input.toFeeGroupId) {
    return { ok: false, error: "Target fee group required" };
  }
  if (input.type === "adhoc" && input.amountPaise <= 0) {
    return { ok: false, error: "Ad-hoc amount must be > 0" };
  }

  const pending = needsApproval(input.amountPaise, input.type) || !!input.forceApproval;
  const row: FeeAdjustment = {
    id: id("fadj"),
    studentId: input.studentId,
    academicYearCode: ay,
    type: input.type,
    dueKey: input.dueKey ?? null,
    label: input.label,
    amountPaise: Math.max(0, Math.round(input.amountPaise)),
    reasonCode: input.reasonCode,
    reason: input.reason.trim(),
    status: pending ? "pending_approval" : "posted",
    stopAfterDate: input.stopAfterDate ?? null,
    fromFeeGroupId: input.fromFeeGroupId ?? student.feeGroupId,
    toFeeGroupId: input.toFeeGroupId ?? null,
    feeHeadId: input.feeHeadId ?? null,
    dueOn: input.dueOn ?? null,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    decidedAt: pending ? null : new Date().toISOString(),
    decidedBy: pending ? "" : input.createdBy,
    decisionNote: pending ? "" : "Auto-posted within Accounts limit",
  };

  const rows = loadFeeAdjustments();
  rows.unshift(row);
  saveFeeAdjustments(rows);

  if (row.status === "posted" && row.type === "change_group" && row.toFeeGroupId) {
    applyChangeGroup(student, row.toFeeGroupId);
  }

  return { ok: true, adjustment: row };
}

export type CounterDiscountSlice = {
  dueKey: string;
  studentId: string;
  label: string;
  amountPaise: number;
};

/** Build waiver slices from per–fee-head counter discounts (dueKey → rupees). */
export function buildPerLineDiscountSlices(
  dues: FeeDueLine[],
  lineDiscountRupees: Record<string, string>,
): CounterDiscountSlice[] {
  const slices: CounterDiscountSlice[] = [];
  for (const d of openFeeDues(dues)) {
    const raw = lineDiscountRupees[d.dueKey];
    if (!raw?.trim()) continue;
    const n = Math.round((Number(raw) || 0) * 100);
    if (n <= 0) continue;
    slices.push({
      dueKey: d.dueKey,
      studentId: d.studentId,
      label: d.label,
      amountPaise: Math.min(n, d.balancePaise),
    });
  }
  return slices;
}

/**
 * Post counter-time waivers before collection. Each slice must be within the
 * auto-approve limit or the whole operation is rejected.
 */
export function postCounterDiscountWaivers(input: {
  slices: CounterDiscountSlice[];
  reason: string;
  createdBy: string;
  academicYearCode: string;
}):
  | { ok: true; totalPaise: number }
  | { ok: false; error: string } {
  if (input.slices.length === 0) {
    return { ok: true, totalPaise: 0 };
  }
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: "Enter a reason for the counter discount" };
  }
  for (const slice of input.slices) {
    if (needsApproval(slice.amountPaise, "waiver")) {
      return {
        ok: false,
        error: `Discount on ${slice.label} (${formatInr(slice.amountPaise)}) needs Principal approval — use Adjustments tab or keep each line under ${formatInr(FEE_ADJUST_AUTO_LIMIT_PAISE)}`,
      };
    }
  }
  let total = 0;
  for (const slice of input.slices) {
    const result = createFeeAdjustment({
      studentId: slice.studentId,
      type: "waiver",
      dueKey: slice.dueKey,
      label: slice.label,
      amountPaise: slice.amountPaise,
      reasonCode: "counter_discount",
      reason: `Counter discount · ${reason}`,
      createdBy: input.createdBy,
      academicYearCode: input.academicYearCode,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (result.adjustment.status === "pending_approval") {
      return {
        ok: false,
        error: `Discount on ${slice.label} needs Principal approval`,
      };
    }
    total += slice.amountPaise;
  }
  return { ok: true, totalPaise: total };
}

function applyChangeGroup(student: SisStudent, toFeeGroupId: string) {
  const sis = loadSis();
  saveSis({
    ...sis,
    students: sis.students.map((s) =>
      s.id === student.id ? { ...s, feeGroupId: toFeeGroupId } : s,
    ),
  });
}

export function decideFeeAdjustment(input: {
  adjustmentId: string;
  approve: boolean;
  decidedBy: string;
  note?: string;
}):
  | { ok: true; adjustment: FeeAdjustment }
  | { ok: false; error: string } {
  const rows = loadFeeAdjustments();
  const idx = rows.findIndex((r) => r.id === input.adjustmentId);
  if (idx < 0) return { ok: false, error: "Adjustment not found" };
  const row = rows[idx]!;
  if (row.status !== "pending_approval") {
    return { ok: false, error: "Not awaiting approval" };
  }
  const next: FeeAdjustment = {
    ...row,
    status: input.approve ? "posted" : "rejected",
    decidedAt: new Date().toISOString(),
    decidedBy: input.decidedBy,
    decisionNote: input.note?.trim() || (input.approve ? "Approved" : "Rejected"),
  };
  rows[idx] = next;
  saveFeeAdjustments(rows);

  if (
    next.status === "posted" &&
    next.type === "change_group" &&
    next.toFeeGroupId
  ) {
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === next.studentId);
    if (student) applyChangeGroup(student, next.toFeeGroupId);
  }

  return { ok: true, adjustment: next };
}

export function voidFeeAdjustment(
  adjustmentId: string,
  by: string,
): { ok: true } | { ok: false; error: string } {
  const rows = loadFeeAdjustments();
  const idx = rows.findIndex((r) => r.id === adjustmentId);
  if (idx < 0) return { ok: false, error: "Not found" };
  const row = rows[idx]!;
  if (row.status === "voided") return { ok: false, error: "Already voided" };
  rows[idx] = {
    ...row,
    status: "voided",
    decidedAt: new Date().toISOString(),
    decidedBy: by,
    decisionNote: row.decisionNote
      ? `${row.decisionNote} · voided`
      : "Voided",
  };
  saveFeeAdjustments(rows);
  return { ok: true };
}

/** Waive all open dues (or stop future + waive remaining) for mid-year leave. */
export function settleLeavingStudent(input: {
  studentId: string;
  leavingDate: string;
  createdBy: string;
  waiveRemaining: boolean;
  reason?: string;
  /** Open dues to write off (caller supplies from computeStudentDues). */
  openDueLines?: { dueKey: string; label: string; balancePaise: number }[];
}):
  | { ok: true; created: number }
  | { ok: false; error: string } {
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  let created = 0;
  const stop = createFeeAdjustment({
    studentId: input.studentId,
    type: "stop_future",
    label: `Stop future from ${input.leavingDate}`,
    amountPaise: 0,
    reasonCode: "left_school",
    reason: input.reason || `Left school / TC from ${input.leavingDate}`,
    createdBy: input.createdBy,
    stopAfterDate: input.leavingDate,
  });
  if (stop.ok) created += 1;
  else return stop;

  if (input.waiveRemaining) {
    const dues = (input.openDueLines ?? []).filter(
      (d) => d.balancePaise > 0,
    );
    for (const d of dues) {
      const r = createFeeAdjustment({
        studentId: input.studentId,
        type: "write_off",
        dueKey: d.dueKey,
        label: `Write-off · ${d.label}`,
        amountPaise: d.balancePaise,
        reasonCode: "left_school",
        reason: input.reason || "Left school — settle remaining",
        createdBy: input.createdBy,
      });
      if (r.ok) created += 1;
    }
  }

  saveSis({
    ...sis,
    students: sis.students.map((s) =>
      s.id === input.studentId ? { ...s, status: "inactive" as const } : s,
    ),
  });

  return { ok: true, created };
}

export function pendingApprovalCount(): number {
  return loadFeeAdjustments().filter((a) => a.status === "pending_approval")
    .length;
}

export function feeAdjustmentTypeLabel(t: FeeAdjustmentType): string {
  switch (t) {
    case "waiver":
      return "Waive";
    case "write_off":
      return "Write-off";
    case "stop_future":
      return "Stop future";
    case "amount_edit":
      return "Edit amount";
    case "adhoc":
      return "Ad-hoc charge";
    case "change_group":
      return "Change fee group";
    default:
      return t;
  }
}

export function formatAdjustLimitHint(): string {
  return `Accounts can post up to ${formatInr(FEE_ADJUST_AUTO_LIMIT_PAISE)} without Principal approval.`;
}

/** Ensure previous AY has fee groups cloned from current (for arrears / rollover). */
export function preparePreviousSessionFeeSetup(
  masters?: MastersState,
): { ok: true; state: MastersState; cloned: boolean; fromAy: string } | { ok: false; error: string } {
  const m = masters ?? loadMasters();
  const toAy = currentAcademicYearCode(m);
  const years = (m.academicYears ?? [])
    .map((y) => y.code)
    .filter((c) => c && c < toAy)
    .sort((a, b) => b.localeCompare(a));
  const fromAy = years[0];
  if (!fromAy) {
    return { ok: false, error: "No previous academic year in Masters" };
  }
  const before = m.feeGroups.filter((g) => g.academicYearCode === fromAy).length;
  const next = cloneFeeSetupToAcademicYear(m, toAy, fromAy);
  const after = next.feeGroups.filter((g) => g.academicYearCode === fromAy).length;
  saveMasters(next);
  return { ok: true, state: next, cloned: after > before, fromAy };
}
