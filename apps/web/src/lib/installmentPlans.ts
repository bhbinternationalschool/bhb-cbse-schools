/**
 * Fee recovery installment plans (Accounts / Defaulters).
 * Splits overdue open dues into a dated EMI schedule for Fee Take.
 */

import { DEFAULT_AY, formatInr } from "@/lib/masters";
import type { FeeDueLine } from "@/lib/fees";

export type InstallmentPlanStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "broken";

export type InstallmentPlanInterval = "weekly" | "fortnightly" | "monthly";

export type InstallmentPlanCoveredLine = {
  dueKey: string;
  label: string;
  amountPaise: number;
};

export type InstallmentPlanSlice = {
  id: string;
  seq: number;
  dueOn: string;
  amountPaise: number;
  label: string;
};

export type InstallmentPlan = {
  id: string;
  code: string;
  studentId: string;
  householdId: string;
  academicYearCode: string;
  status: InstallmentPlanStatus;
  coveredLines: InstallmentPlanCoveredLine[];
  totalPaise: number;
  slices: InstallmentPlanSlice[];
  interval: InstallmentPlanInterval;
  note: string;
  createdAt: string;
  createdBy: string;
  cancelledAt: string | null;
  completedAt: string | null;
  brokenAt: string | null;
};

/** FIFO allocation from plan EMI payments onto original covered dues. */
export type PlanAllocation = {
  id: string;
  planId: string;
  voucherId: string;
  dueKey: string;
  amountPaise: number;
  createdAt: string;
};

export const PLAN_INTERVALS: {
  value: InstallmentPlanInterval;
  label: string;
  days: number;
}[] = [
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "fortnightly", label: "Fortnightly", days: 14 },
  { value: "monthly", label: "Monthly", days: 30 },
];

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function planSliceDueKey(planId: string, sliceId: string): string {
  return `plan:${planId}:${sliceId}`;
}

export function parsePlanSliceDueKey(
  dueKey: string,
): { planId: string; sliceId: string } | null {
  const m = /^plan:([^:]+):(.+)$/.exec(dueKey);
  if (!m) return null;
  return { planId: m[1]!, sliceId: m[2]! };
}

export function normalizeInstallmentPlan(
  p: Partial<InstallmentPlan>,
): InstallmentPlan {
  const status: InstallmentPlanStatus =
    p.status === "completed" ||
    p.status === "cancelled" ||
    p.status === "broken" ||
    p.status === "active"
      ? p.status
      : "active";
  const interval: InstallmentPlanInterval =
    p.interval === "weekly" ||
    p.interval === "fortnightly" ||
    p.interval === "monthly"
      ? p.interval
      : "monthly";
  return {
    id: p.id ?? id("ip"),
    code: p.code ?? "IP-000",
    studentId: p.studentId ?? "",
    householdId: p.householdId ?? "",
    academicYearCode: p.academicYearCode ?? DEFAULT_AY,
    status,
    coveredLines: Array.isArray(p.coveredLines)
      ? p.coveredLines.map((c) => ({
          dueKey: c.dueKey,
          label: c.label,
          amountPaise: Math.max(0, Math.floor(c.amountPaise ?? 0)),
        }))
      : [],
    totalPaise: Math.max(0, Math.floor(p.totalPaise ?? 0)),
    slices: Array.isArray(p.slices)
      ? p.slices.map((s, i) => ({
          id: s.id ?? id("isl"),
          seq: s.seq ?? i + 1,
          dueOn: s.dueOn ?? "",
          amountPaise: Math.max(0, Math.floor(s.amountPaise ?? 0)),
          label: s.label ?? `Part ${i + 1}`,
        }))
      : [],
    interval,
    note: p.note ?? "",
    createdAt: p.createdAt ?? new Date().toISOString(),
    createdBy: p.createdBy ?? "",
    cancelledAt: p.cancelledAt ?? null,
    completedAt: p.completedAt ?? null,
    brokenAt: p.brokenAt ?? null,
  };
}

export function normalizePlanAllocation(
  a: Partial<PlanAllocation>,
): PlanAllocation {
  return {
    id: a.id ?? id("ipa"),
    planId: a.planId ?? "",
    voucherId: a.voucherId ?? "",
    dueKey: a.dueKey ?? "",
    amountPaise: Math.max(0, Math.floor(a.amountPaise ?? 0)),
    createdAt: a.createdAt ?? new Date().toISOString(),
  };
}

export function nextInstallmentPlanCode(plans: InstallmentPlan[]): string {
  let max = 0;
  for (const p of plans) {
    const m = /^IP-(\d+)$/i.exec(p.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `IP-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Build equal(ish) EMI schedule. Remainder paise goes on the last slice.
 */
export function proposeInstallmentSchedule(input: {
  totalPaise: number;
  parts: number;
  firstDueOn: string;
  interval: InstallmentPlanInterval;
}): { dueOn: string; amountPaise: number; label: string }[] {
  const parts = Math.min(12, Math.max(2, Math.floor(input.parts) || 2));
  const total = Math.max(0, Math.floor(input.totalPaise));
  if (total <= 0) return [];

  const step =
    PLAN_INTERVALS.find((x) => x.value === input.interval)?.days ?? 30;
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  const out: { dueOn: string; amountPaise: number; label: string }[] = [];
  let dueOn = input.firstDueOn;
  for (let i = 0; i < parts; i++) {
    const amountPaise = i === parts - 1 ? base + rem : base;
    out.push({
      dueOn,
      amountPaise,
      label: `Part ${i + 1}/${parts}`,
    });
    dueOn = addCalendarDays(dueOn, step);
  }
  return out;
}

export function activePlanForStudent(
  plans: InstallmentPlan[] | undefined,
  studentId: string,
): InstallmentPlan | undefined {
  return (plans ?? []).find(
    (p) => p.studentId === studentId && p.status === "active",
  );
}

export function coveredDueKeySet(plan: InstallmentPlan): Set<string> {
  return new Set(plan.coveredLines.map((c) => c.dueKey));
}

/** Merge FIFO plan allocations into the voucher paid map. */
export function mergePlanAllocationsIntoPaidMap(
  map: Map<string, number>,
  allocations: PlanAllocation[] | undefined,
): Map<string, number> {
  for (const a of allocations ?? []) {
    if (a.amountPaise <= 0 || !a.dueKey) continue;
    map.set(a.dueKey, (map.get(a.dueKey) ?? 0) + a.amountPaise);
  }
  return map;
}

/**
 * Allocate an EMI payment across remaining covered line balances (FIFO).
 */
export function allocatePlanPayment(input: {
  plan: InstallmentPlan;
  amountPaise: number;
  alreadyAllocatedByDueKey: Map<string, number>;
  voucherId: string;
}): PlanAllocation[] {
  let remaining = Math.max(0, Math.floor(input.amountPaise));
  if (remaining <= 0) return [];
  const out: PlanAllocation[] = [];
  const now = new Date().toISOString();

  for (const line of input.plan.coveredLines) {
    if (remaining <= 0) break;
    const already = input.alreadyAllocatedByDueKey.get(line.dueKey) ?? 0;
    const open = Math.max(0, line.amountPaise - already);
    if (open <= 0) continue;
    const take = Math.min(open, remaining);
    out.push({
      id: id("ipa"),
      planId: input.plan.id,
      voucherId: input.voucherId,
      dueKey: line.dueKey,
      amountPaise: take,
      createdAt: now,
    });
    input.alreadyAllocatedByDueKey.set(line.dueKey, already + take);
    remaining -= take;
  }
  return out;
}

export function planSliceDues(
  plan: InstallmentPlan,
  paidMap: Map<string, number>,
  options?: { includePaid?: boolean; asOf?: string; includeFuture?: boolean },
): FeeDueLine[] {
  const includePaid = options?.includePaid ?? true;
  const includeFuture = options?.includeFuture ?? true;
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const lines: FeeDueLine[] = [];

  for (const slice of plan.slices) {
    if (!includeFuture && slice.dueOn > asOf) continue;
    const dueKey = planSliceDueKey(plan.id, slice.id);
    const paid = paidMap.get(dueKey) ?? 0;
    const balance = Math.max(0, slice.amountPaise - paid);
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }
    lines.push({
      dueKey,
      kind: "plan",
      studentId: plan.studentId,
      feeHeadId: "",
      feeHeadName: "Installment plan",
      installmentId: null,
      installmentLabel: plan.code,
      specialFeeId: null,
      structureLineId: null,
      storeIssueId: null,
      storeIssueNo: "",
      storeItems: [],
      transport: null,
      dueOn: slice.dueOn,
      billedPaise: slice.amountPaise,
      concessionPaise: 0,
      concessionDetails: [],
      paidPaise: paid,
      balancePaise: balance,
      label: `${plan.code} · ${slice.label} · ${formatInr(slice.amountPaise)}`,
    });
  }
  return lines;
}

export function planPaidTotal(
  plan: InstallmentPlan,
  paidMap: Map<string, number>,
): number {
  return plan.slices.reduce((s, slice) => {
    const dueKey = planSliceDueKey(plan.id, slice.id);
    return s + Math.min(slice.amountPaise, paidMap.get(dueKey) ?? 0);
  }, 0);
}

export function isPlanFullyPaid(
  plan: InstallmentPlan,
  paidMap: Map<string, number>,
): boolean {
  return plan.slices.every((slice) => {
    const dueKey = planSliceDueKey(plan.id, slice.id);
    return (paidMap.get(dueKey) ?? 0) >= slice.amountPaise;
  });
}

/** Earliest unpaid slice due date — used for defaulter stage while plan is active. */
export function nextOpenPlanDueOn(
  plan: InstallmentPlan,
  paidMap: Map<string, number>,
): string | null {
  for (const slice of [...plan.slices].sort((a, b) =>
    a.dueOn.localeCompare(b.dueOn),
  )) {
    const dueKey = planSliceDueKey(plan.id, slice.id);
    if ((paidMap.get(dueKey) ?? 0) < slice.amountPaise) return slice.dueOn;
  }
  return null;
}

export function composeWhatsAppInstallmentPlan(input: {
  schoolName: string;
  studentName: string;
  classLabel: string;
  plan: InstallmentPlan;
}): string {
  const lines = [
    `*${input.schoolName}*`,
    `Fee installment plan ${input.plan.code}`,
    "",
    `${input.studentName}${input.classLabel ? ` (${input.classLabel})` : ""}`,
    `Total: *${formatInr(input.plan.totalPaise)}* in ${input.plan.slices.length} parts`,
    "",
  ];
  for (const s of input.plan.slices) {
    lines.push(`• ${s.label}: ${formatInr(s.amountPaise)} by ${s.dueOn}`);
  }
  if (input.plan.note.trim()) {
    lines.push("", input.plan.note.trim());
  }
  lines.push("", "Please pay on or before each due date. Thank you.");
  return lines.join("\n");
}
