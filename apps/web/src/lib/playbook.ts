import type { HoldCode, OverdueStage } from "./types";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { activePlanForStudent } from "@/lib/installmentPlans";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

export type PlaybookAction = {
  id: string;
  label: string;
  cta: string;
};

export type PlaybookHold = {
  code: HoldCode;
  label: string;
  active: boolean;
  mode: "auto" | "suggest";
};

export type PlaybookResult = {
  stage: OverdueStage;
  stageLabel: string;
  overdueDays: number;
  amountPaise: number;
  doNow: PlaybookAction[];
  holds: PlaybookHold[];
  stillAllowed: string[];
};

/** One row on the live defaulters ledger. */
export type LiveDefaulter = {
  studentId: string;
  householdId: string;
  admissionNo: string;
  fullName: string;
  classLabel: string;
  academicYearCode: string;
  /** Calendar days past earliest overdue dueOn (0 = due today). */
  overdueDays: number;
  overdueAmountPaise: number;
  /** All open balances (includes not-yet-due). */
  openAmountPaise: number;
  earliestDueOn: string;
  overdueDues: FeeDueLine[];
  openDues: FeeDueLine[];
  stage: OverdueStage;
  stageLabel: string;
  student: SisStudent;
  /** Active recovery plan code, if any */
  planCode: string | null;
  planId: string | null;
};

const STAGE_LABEL: Record<OverdueStage, string> = {
  S0: "S0 Soft",
  S1: "S1 Due",
  S2: "S2 Overdue",
  S3: "S3 Serious",
  S4: "S4 Hard",
};

/** Resolve overdue stage from days past due (tenant defaults). */
export function resolveStage(overdueDays: number): OverdueStage {
  if (overdueDays < 0) return "S0";
  if (overdueDays <= 7) return "S1";
  if (overdueDays <= 15) return "S2";
  if (overdueDays <= 30) return "S3";
  return "S4";
}

export function stageLabel(stage: OverdueStage): string {
  return STAGE_LABEL[stage];
}

/** Inclusive calendar day difference: today − dueOn (positive = overdue). */
export function calendarDaysPastDue(dueOn: string, today: string): number {
  const a = new Date(`${dueOn}T12:00:00`);
  const b = new Date(`${today}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function buildPlaybook(input: {
  overdueDays: number;
  amountPaise: number;
  studentName: string;
}): PlaybookResult {
  const stage = resolveStage(input.overdueDays);
  const doNow: PlaybookAction[] = [];
  const holds: PlaybookHold[] = [];

  if (stage === "S0") {
    doNow.push({
      id: "remind",
      label: "Send soft reminder (due soon) + UPI link",
      cta: "Send",
    });
  }
  if (stage === "S1" || stage === "S2" || stage === "S3" || stage === "S4") {
    doNow.push(
      {
        id: "paylink",
        label: "Send UPI payment link (WhatsApp)",
        cta: "Link",
      },
      {
        id: "whatsapp",
        label: "Send WhatsApp fee reminder",
        cta: "Send",
      },
      {
        id: "call",
        label: "Call guardian · copy mobile",
        cta: "Call",
      },
    );
  }
  if (stage === "S2" || stage === "S3" || stage === "S4") {
    doNow.push({
      id: "escalate",
      label: "Copy escalation notice text",
      cta: "Copy",
    });
    doNow.push({
      id: "plan",
      label: "Create / manage installment plan",
      cta: "Plan",
    });
  }
  if (stage === "S3" || stage === "S4") {
    doNow.push({
      id: "meeting",
      label: "Book parent meeting",
      cta: "Note",
    });
  }

  const pushHold = (
    code: HoldCode,
    label: string,
    active: boolean,
    mode: "auto" | "suggest",
  ) => holds.push({ code, label, active, mode });

  pushHold("HOLD_STORE_CREDIT", "Store credit sales", stage >= "S1", "auto");
  pushHold("HOLD_REPORT_CARD", "Report card print", stage >= "S2", "auto");
  pushHold("HOLD_LIBRARY", "Library issue", stage >= "S2", "suggest");
  pushHold("HOLD_TRANSPORT", "Transport boarding", stage >= "S3", "auto");
  pushHold("HOLD_ADMIT_CARD", "Admit card print", stage >= "S3", "suggest");
  pushHold(
    "HOLD_CERT",
    "Certificates (bonafide etc.)",
    stage >= "S3",
    "auto",
  );
  pushHold("HOLD_TC", "TC / transfer certificate", stage >= "S4", "auto");
  pushHold(
    "HOLD_NEXT_AY",
    "Next AY promo without clearance",
    stage >= "S4",
    "suggest",
  );
  pushHold("HOLD_TRIP", "Paid trip enrollment", stage >= "S3", "suggest");

  return {
    stage,
    stageLabel: STAGE_LABEL[stage],
    overdueDays: input.overdueDays,
    amountPaise: input.amountPaise,
    doNow,
    holds,
    stillAllowed: [
      "Class attendance",
      "Homework / learning access",
      "Emergency medical",
      "Child pickup safety",
    ],
  };
}

export function formatInrFromPaise(paise: number): string {
  return formatInr(paise);
}

function classLabelOf(
  student: SisStudent,
  masters: MastersState,
): string {
  const c =
    masters.classes.find((x) => x.id === student.classId)?.name ?? "—";
  const sec =
    masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return sec ? `${c}-${sec}` : c;
}

/**
 * Live defaulters from Fee Take ledger — active students with open dues
 * whose dueOn is on/before today (plus optional upcoming-only rows).
 */
export function listLiveDefaulters(options?: {
  asOf?: string;
  includeUpcoming?: boolean;
  sis?: SisState;
  masters?: MastersState;
}): LiveDefaulter[] {
  const today = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const includeUpcoming = options?.includeUpcoming ?? false;
  const sis = options?.sis ?? loadSis();
  const masters = options?.masters ?? loadMasters();
  const fees = loadFees();
  const out: LiveDefaulter[] = [];

  for (const student of sis.students) {
    if (student.status !== "active") continue;
    const dues = computeStudentDues(student, masters, fees, {
      asOf: today,
      includeFuture: true,
    });
    const open = openFeeDues(dues);
    if (open.length === 0) continue;

    const plan = activePlanForStudent(fees.installmentPlans, student.id);
    const overdue = open.filter((d) => d.dueOn <= today);
    const upcoming = open.filter((d) => d.dueOn > today);

    if (overdue.length === 0 && !includeUpcoming && !plan) continue;
    if (overdue.length === 0 && upcoming.length === 0) continue;

    const focus = overdue.length > 0 ? overdue : upcoming;
    const earliestDueOn = focus.reduce(
      (min, d) => (d.dueOn < min ? d.dueOn : min),
      focus[0]!.dueOn,
    );
    const overdueDays = calendarDaysPastDue(earliestDueOn, today);
    const overdueAmountPaise = overdue.reduce(
      (s, d) => s + d.balancePaise,
      0,
    );
    const openAmountPaise = open.reduce((s, d) => s + d.balancePaise, 0);
    const stage = resolveStage(overdueDays);

    out.push({
      studentId: student.id,
      householdId: student.householdId,
      admissionNo: student.admissionNo,
      fullName: student.fullName,
      classLabel: classLabelOf(student, masters),
      academicYearCode: student.academicYearCode,
      overdueDays,
      overdueAmountPaise:
        overdueAmountPaise > 0 ? overdueAmountPaise : openAmountPaise,
      openAmountPaise,
      earliestDueOn,
      overdueDues: overdue.length > 0 ? overdue : upcoming,
      openDues: open,
      stage,
      stageLabel: STAGE_LABEL[stage],
      student,
      planCode: plan?.code ?? null,
      planId: plan?.id ?? null,
    });
  }

  return out.sort((a, b) => {
    if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
    return b.overdueAmountPaise - a.overdueAmountPaise;
  });
}

export function composeWhatsAppDefaulterReminder(input: {
  schoolName: string;
  studentName: string;
  classLabel: string;
  amountPaise: number;
  overdueDays: number;
  stageLabel: string;
  payUrl?: string;
}): string {
  const days =
    input.overdueDays < 0
      ? "upcoming"
      : input.overdueDays === 0
        ? "due today"
        : `${input.overdueDays} day(s) overdue`;
  const lines = [
    `*${input.schoolName}*`,
    `Fee reminder · ${input.stageLabel}`,
    "",
    `${input.studentName}${input.classLabel ? ` (${input.classLabel})` : ""}`,
    `Amount: *${formatInr(input.amountPaise)}* (${days})`,
    "",
  ];
  if (input.payUrl) {
    lines.push("Pay online:", input.payUrl, "");
  }
  lines.push(
    "Please clear dues at the school counter or via the link above.",
    "Ignore if already paid. Thank you.",
  );
  return lines.join("\n");
}

export function composeEscalationNotice(input: {
  schoolName: string;
  studentName: string;
  classLabel: string;
  admissionNo: string;
  amountPaise: number;
  overdueDays: number;
  earliestDueOn: string;
}): string {
  return [
    `${input.schoolName}`,
    `FEE OVERDUE NOTICE`,
    "",
    `Student: ${input.studentName} (${input.classLabel})`,
    `Admission No.: ${input.admissionNo}`,
    `Overdue amount: ${formatInr(input.amountPaise)}`,
    `Days overdue: ${input.overdueDays}`,
    `Earliest due date: ${input.earliestDueOn}`,
    "",
    "Kindly clear the outstanding dues at the earliest to avoid holds on report card / certificates / TC as per school policy.",
    "",
    "Accounts office",
  ].join("\n");
}

/** @deprecated Demo rows — live ledger uses listLiveDefaulters(). Kept for reference. */
export const DEMO_DEFAULTERS = [
  {
    id: "d1",
    admissionNo: "BHB-2024-118",
    fullName: "Rahul Singh",
    classLabel: "VI-B",
    overdueDays: 18,
    amountPaise: 420000,
    status: "active" as const,
  },
  {
    id: "d2",
    admissionNo: "BHB-2023-042",
    fullName: "Ananya Gupta",
    classLabel: "VIII-A",
    overdueDays: 5,
    amountPaise: 185000,
    status: "active" as const,
  },
  {
    id: "d3",
    admissionNo: "BHB-2025-009",
    fullName: "Kabir Ali",
    classLabel: "III-C",
    overdueDays: 32,
    amountPaise: 960000,
    status: "active" as const,
  },
  {
    id: "d4",
    admissionNo: "BHB-2022-201",
    fullName: "Meera Joshi",
    classLabel: "X-A",
    overdueDays: 0,
    amountPaise: 75000,
    status: "active" as const,
  },
];
