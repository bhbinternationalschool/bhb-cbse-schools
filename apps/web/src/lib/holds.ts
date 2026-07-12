/**
 * Fee hold enforcement — playbook stages → hard blocks + Principal PIN overrides.
 */

import type { HoldCode, OverdueStage } from "@/lib/types";
import {
  calendarDaysPastDue,
  resolveStage,
  stageLabel,
} from "@/lib/playbook";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";

const STORAGE_KEY = "bhb_holds_v1";
/** Demo Principal PIN — changeable in local storage via setPrincipalPin. */
export const DEFAULT_PRINCIPAL_PIN = "2468";

export const HOLD_LABELS: Record<HoldCode, string> = {
  HOLD_STORE_CREDIT: "Store credit sales",
  HOLD_REPORT_CARD: "Report card print",
  HOLD_LIBRARY: "Library issue",
  HOLD_TRANSPORT: "Transport boarding / new route assign",
  HOLD_ADMIT_CARD: "Admit card print",
  HOLD_CERT: "Certificates (bonafide, character, fees paid)",
  HOLD_TC: "TC / transfer certificate",
  HOLD_NEXT_AY: "Next AY promo without clearance",
  HOLD_TRIP: "Paid trip enrollment",
};

/** Stage at which each hold becomes active (mirrors playbook). */
export const HOLD_FROM_STAGE: Record<HoldCode, OverdueStage> = {
  HOLD_STORE_CREDIT: "S1",
  HOLD_REPORT_CARD: "S2",
  HOLD_LIBRARY: "S2",
  HOLD_TRANSPORT: "S3",
  HOLD_ADMIT_CARD: "S3",
  HOLD_CERT: "S3",
  HOLD_TRIP: "S3",
  HOLD_TC: "S4",
  HOLD_NEXT_AY: "S4",
};

/** Holds enforced in the live demo modules. */
export const ENFORCED_HOLDS: HoldCode[] = [
  "HOLD_STORE_CREDIT",
  "HOLD_REPORT_CARD",
  "HOLD_TRANSPORT",
  "HOLD_CERT",
  "HOLD_TC",
];

export type HoldOverride = {
  id: string;
  studentId: string;
  holdCode: HoldCode;
  reason: string;
  overriddenBy: string;
  createdAt: string;
  /** Inclusive calendar end date */
  expiresOn: string;
  revokedAt: string | null;
};

export type HoldsState = {
  version: 1;
  principalPin: string;
  overrides: HoldOverride[];
  /** Synced from exam policy — when HOLD_REPORT_CARD starts */
  reportCardHoldFromStage: OverdueStage;
};

export type StudentHoldContext = {
  studentId: string;
  stage: OverdueStage;
  stageLabel: string;
  overdueDays: number;
  overdueAmountPaise: number;
  earliestDueOn: string | null;
  activeHolds: {
    code: HoldCode;
    label: string;
    fromStage: OverdueStage;
    overridden: boolean;
  }[];
};

export type HoldCheck =
  | {
      allowed: true;
      stage: OverdueStage;
      overdueDays: number;
      overdueAmountPaise: number;
      override?: HoldOverride;
    }
  | {
      allowed: false;
      code: HoldCode;
      label: string;
      stage: OverdueStage;
      overdueDays: number;
      overdueAmountPaise: number;
      message: string;
    };

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function stageRank(s: OverdueStage): number {
  return { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 }[s];
}

function emptyState(): HoldsState {
  return {
    version: 1,
    principalPin: DEFAULT_PRINCIPAL_PIN,
    overrides: [],
    reportCardHoldFromStage: "S2",
  };
}

function normalizeReportCardHoldStage(
  value: unknown,
): OverdueStage {
  if (value === "S1" || value === "S2" || value === "S3" || value === "S4") {
    return value;
  }
  return "S2";
}

export function loadHolds(): HoldsState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as HoldsState;
    return {
      version: 1,
      principalPin:
        typeof parsed.principalPin === "string" && parsed.principalPin.length >= 4
          ? parsed.principalPin
          : DEFAULT_PRINCIPAL_PIN,
      overrides: Array.isArray(parsed.overrides)
        ? parsed.overrides.map(normalizeOverride)
        : [],
      reportCardHoldFromStage: normalizeReportCardHoldStage(
        parsed.reportCardHoldFromStage,
      ),
    };
  } catch {
    return emptyState();
  }
}

export function saveHolds(state: HoldsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** Effective from-stage for a hold (report card follows exam policy). */
export function holdFromStage(
  holdCode: HoldCode,
  state?: HoldsState,
): OverdueStage {
  if (holdCode === "HOLD_REPORT_CARD") {
    return (state ?? loadHolds()).reportCardHoldFromStage;
  }
  return HOLD_FROM_STAGE[holdCode];
}

export function setReportCardHoldFromStage(
  stage: "S1" | "S2" | "S3" | "S4",
): void {
  const state = loadHolds();
  saveHolds({
    ...state,
    reportCardHoldFromStage: normalizeReportCardHoldStage(stage),
  });
}

function normalizeOverride(o: Partial<HoldOverride>): HoldOverride {
  return {
    id: o.id ?? id("hov"),
    studentId: o.studentId ?? "",
    holdCode: (o.holdCode as HoldCode) ?? "HOLD_STORE_CREDIT",
    reason: o.reason ?? "",
    overriddenBy: o.overriddenBy ?? "",
    createdAt: o.createdAt ?? new Date().toISOString(),
    expiresOn: o.expiresOn ?? new Date().toISOString().slice(0, 10),
    revokedAt: o.revokedAt ?? null,
  };
}

export function verifyPrincipalPin(pin: string): boolean {
  const digits = pin.replace(/\D/g, "");
  return digits === loadHolds().principalPin;
}

export function setPrincipalPin(
  currentPin: string,
  nextPin: string,
): { ok: true } | { ok: false; error: string } {
  if (!verifyPrincipalPin(currentPin)) {
    return { ok: false, error: "Current Principal PIN is incorrect" };
  }
  const next = nextPin.replace(/\D/g, "");
  if (next.length < 4 || next.length > 8) {
    return { ok: false, error: "New PIN must be 4–8 digits" };
  }
  const state = loadHolds();
  saveHolds({ ...state, principalPin: next });
  return { ok: true };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Overdue stage for a student from live Fee Take dues (incl. plan EMIs). */
export function studentHoldContext(
  studentId: string,
  asOf = todayIso(),
): StudentHoldContext | null {
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return null;

  const masters = loadMasters();
  const fees = loadFees();
  const dues = computeStudentDues(student, masters, fees, {
    asOf,
    includeFuture: true,
  });
  const open = openFeeDues(dues);
  const overdue = open.filter((d) => d.dueOn <= asOf);

  let overdueDays = -3;
  let earliestDueOn: string | null = null;
  let overdueAmountPaise = 0;

  if (overdue.length > 0) {
    earliestDueOn = overdue.reduce(
      (min, d) => (d.dueOn < min ? d.dueOn : min),
      overdue[0]!.dueOn,
    );
    overdueDays = calendarDaysPastDue(earliestDueOn, asOf);
    overdueAmountPaise = overdue.reduce((s, d) => s + d.balancePaise, 0);
  } else if (open.length > 0) {
    earliestDueOn = open.reduce(
      (min, d) => (d.dueOn < min ? d.dueOn : min),
      open[0]!.dueOn,
    );
    overdueDays = calendarDaysPastDue(earliestDueOn, asOf);
    overdueAmountPaise = open.reduce((s, d) => s + d.balancePaise, 0);
  }

  const stage = resolveStage(overdueDays);
  const holds = loadHolds();
  const activeHolds = (Object.keys(HOLD_FROM_STAGE) as HoldCode[])
    .filter(
      (code) => stageRank(stage) >= stageRank(holdFromStage(code, holds)),
    )
    .map((code) => ({
      code,
      label: HOLD_LABELS[code],
      fromStage: holdFromStage(code, holds),
      overridden: !!findActiveOverride(holds, studentId, code, asOf),
    }));

  return {
    studentId,
    stage,
    stageLabel: stageLabel(stage),
    overdueDays,
    overdueAmountPaise,
    earliestDueOn,
    activeHolds,
  };
}

function findActiveOverride(
  state: HoldsState,
  studentId: string,
  holdCode: HoldCode,
  asOf: string,
): HoldOverride | undefined {
  return state.overrides.find(
    (o) =>
      o.studentId === studentId &&
      o.holdCode === holdCode &&
      !o.revokedAt &&
      o.expiresOn >= asOf,
  );
}

/**
 * Check whether an action blocked by `holdCode` may proceed for this student.
 */
export function checkHold(
  studentId: string,
  holdCode: HoldCode,
  asOf = todayIso(),
): HoldCheck {
  const ctx = studentHoldContext(studentId, asOf);
  if (!ctx) {
    return {
      allowed: false,
      code: holdCode,
      label: HOLD_LABELS[holdCode],
      stage: "S0",
      overdueDays: 0,
      overdueAmountPaise: 0,
      message: "Student not found",
    };
  }

  const from = holdFromStage(holdCode);
  const triggered = stageRank(ctx.stage) >= stageRank(from);
  if (!triggered) {
    return {
      allowed: true,
      stage: ctx.stage,
      overdueDays: ctx.overdueDays,
      overdueAmountPaise: ctx.overdueAmountPaise,
    };
  }

  const override = findActiveOverride(
    loadHolds(),
    studentId,
    holdCode,
    asOf,
  );
  if (override) {
    return {
      allowed: true,
      stage: ctx.stage,
      overdueDays: ctx.overdueDays,
      overdueAmountPaise: ctx.overdueAmountPaise,
      override,
    };
  }

  const amount =
    ctx.overdueAmountPaise > 0
      ? ` · ${formatInr(ctx.overdueAmountPaise)} overdue`
      : "";
  return {
    allowed: false,
    code: holdCode,
    label: HOLD_LABELS[holdCode],
    stage: ctx.stage,
    overdueDays: ctx.overdueDays,
    overdueAmountPaise: ctx.overdueAmountPaise,
    message: `${HOLD_LABELS[holdCode]} held at ${ctx.stageLabel} (${ctx.overdueDays < 0 ? "upcoming" : `${ctx.overdueDays}d overdue`}${amount}). Principal PIN override required.`,
  };
}

export function grantHoldOverride(input: {
  studentId: string;
  holdCode: HoldCode;
  reason: string;
  overriddenBy: string;
  pin: string;
  /** Validity in days from today (default 7). */
  daysValid?: number;
}):
  | { ok: true; override: HoldOverride }
  | { ok: false; error: string } {
  if (!verifyPrincipalPin(input.pin)) {
    return { ok: false, error: "Incorrect Principal PIN" };
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Enter a short reason for the override" };
  }
  const days = Math.min(30, Math.max(1, input.daysValid ?? 7));
  const asOf = todayIso();
  const state = loadHolds();
  // Revoke prior active override for same student+code
  const overrides = state.overrides.map((o) =>
    o.studentId === input.studentId &&
    o.holdCode === input.holdCode &&
    !o.revokedAt
      ? { ...o, revokedAt: new Date().toISOString() }
      : o,
  );
  const override = normalizeOverride({
    id: id("hov"),
    studentId: input.studentId,
    holdCode: input.holdCode,
    reason,
    overriddenBy: input.overriddenBy,
    createdAt: new Date().toISOString(),
    expiresOn: addCalendarDays(asOf, days),
  });
  saveHolds({ ...state, overrides: [override, ...overrides] });
  return { ok: true, override };
}

export function revokeHoldOverride(
  overrideId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadHolds();
  const found = state.overrides.find((o) => o.id === overrideId);
  if (!found) return { ok: false, error: "Override not found" };
  saveHolds({
    ...state,
    overrides: state.overrides.map((o) =>
      o.id === overrideId
        ? { ...o, revokedAt: new Date().toISOString() }
        : o,
    ),
  });
  return { ok: true };
}

/** Re-apply hold by revoking an active override (Principal PIN required). */
export function revokeHoldOverrideWithPin(input: {
  studentId: string;
  holdCode: HoldCode;
  pin: string;
  reason?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!verifyPrincipalPin(input.pin)) {
    return { ok: false, error: "Incorrect Principal PIN" };
  }
  const asOf = todayIso();
  const state = loadHolds();
  const active = findActiveOverride(
    state,
    input.studentId,
    input.holdCode,
    asOf,
  );
  if (!active) {
    return { ok: false, error: "No active unhold to revoke for this policy" };
  }
  const note = input.reason?.trim();
  saveHolds({
    ...state,
    overrides: state.overrides.map((o) =>
      o.id === active.id
        ? {
            ...o,
            revokedAt: new Date().toISOString(),
            reason: note
              ? `${o.reason} · Re-held: ${note}`
              : o.reason,
          }
        : o,
    ),
  });
  return { ok: true };
}

export type PolicyHoldRow = {
  code: HoldCode;
  label: string;
  mode: "auto" | "suggest";
  /** Policy applies at this overdue stage */
  stageActive: boolean;
  /** held = blocked; unheld = PIN override active; clear = stage not reached */
  status: "clear" | "held" | "unheld";
  override: HoldOverride | null;
};

/** Per-policy hold/unhold rows for Defaulters coach. */
export function listPolicyHoldRows(
  studentId: string,
  holds: { code: HoldCode; label: string; active: boolean; mode: "auto" | "suggest" }[],
  asOf = todayIso(),
): PolicyHoldRow[] {
  const state = loadHolds();
  return holds.map((h) => {
    const override =
      findActiveOverride(state, studentId, h.code, asOf) ?? null;
    let status: PolicyHoldRow["status"] = "clear";
    if (h.active) {
      status = override ? "unheld" : "held";
    } else if (override) {
      status = "unheld";
    }
    return {
      code: h.code,
      label: h.label,
      mode: h.mode,
      stageActive: h.active,
      status,
      override,
    };
  });
}

export function listActiveOverrides(
  studentId?: string,
  asOf = todayIso(),
): HoldOverride[] {
  return loadHolds().overrides.filter(
    (o) =>
      !o.revokedAt &&
      o.expiresOn >= asOf &&
      (!studentId || o.studentId === studentId),
  );
}

/** Hold code for a certificate kind (fee_clearance uses dues-clear, not hold). */
export function holdCodeForCertificate(
  kind: "tc" | "bonafide" | "character" | "fees_paid" | "fee_clearance",
): HoldCode | null {
  if (kind === "tc") return "HOLD_TC";
  if (kind === "fee_clearance") return null;
  if (kind === "bonafide" || kind === "character" || kind === "fees_paid") {
    return "HOLD_CERT";
  }
  return null;
}
