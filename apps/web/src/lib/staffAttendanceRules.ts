/**
 * Staff attendance adjustment rules — school timing, composable steps,
 * and per-staff assignment. localStorage dual-mode (demo).
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import {
  defaultSchoolWeekTiming,
  expectedWindowForTiming,
  hoursBetween as hoursBetweenTiming,
  normalizeSchoolTimingConfig,
  normalizeSchoolWeekTiming,
  resolveSchoolTiming,
  type SchoolWeekTiming,
} from "@/lib/schoolTiming";
import { loadMasters, saveMasters } from "@/lib/masters";
import { getGracePeriodMinutes } from "@/lib/staffHr";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
export type { SchoolWeekTiming };

export type RuleStepKind =
  | "use_school_timing"
  | "buffer_late"
  | "buffer_early"
  | "half_day_by_time"
  | "half_day_by_hours"
  | "sunday_exceptional";

export type RuleStep = {
  id: string;
  kind: RuleStepKind;
  enabled: boolean;
  /** Late / early grace minutes */
  bufferMinutes: number;
  /** Half-day if punch-in after this (HH:mm) */
  halfDayInAfter: string;
  /** Half-day if punch-out before this (HH:mm) */
  halfDayOutBefore: string;
  /** Below this worked hours → half day (when half_day_by_hours) */
  minFullDayHours: number;
  /** Below this worked hours → absent (optional; 0 = unused) */
  absentBelowHours: number;
};

export type AttendanceRule = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  /** When true, expected hours come from school timing (+ Sunday if exceptional) */
  followSchoolTiming: boolean;
  steps: RuleStep[];
  createdAt: string;
  updatedAt: string;
};

export type StaffRuleAssignment = {
  staffId: string;
  ruleId: string;
};

export type StaffAttendanceRulesState = {
  version: 1;
  /** @deprecated Prefer Masters schoolTiming — kept for one-time migrate */
  schoolTiming?: SchoolWeekTiming;
  rules: AttendanceRule[];
  assignments: StaffRuleAssignment[];
};

export type PunchEvaluation = {
  status: "P" | "HD" | "A" | "L" | "LE";
  label: string;
  expectedHours: number;
  workedHours: number;
  notes: string[];
};

const STORAGE_KEY = "bhb_staff_attendance_rules_v1";

/** School default timing from Masters (migrates legacy staff-rules timing once). */
export function schoolTimingFromMasters(): SchoolWeekTiming {
  migrateLegacyTimingIntoMasters();
  const m = loadMasters();
  return resolveSchoolTiming(
    normalizeSchoolTimingConfig(m.schoolTiming),
  ).timing;
}

export function migrateLegacyTimingIntoMasters() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StaffAttendanceRulesState;
    if (!parsed?.schoolTiming) return;
    const masters = loadMasters();
    const cfg = normalizeSchoolTimingConfig(masters.schoolTiming);
    const hasCustomOverrides =
      cfg.groupOverrides.length > 0 || cfg.classOverrides.length > 0;
    const d = cfg.default;
    const legacy = normalizeSchoolWeekTiming(parsed.schoolTiming);
    const stillDefault =
      d.startTime === "09:00" &&
      d.endTime === "15:30" &&
      !d.sundayExceptional &&
      !hasCustomOverrides;
    if (stillDefault) {
      saveMasters({
        ...masters,
        schoolTiming: normalizeSchoolTimingConfig({
          default: legacy,
          groupOverrides: [],
          classOverrides: [],
        }),
      });
    }
    // Drop legacy copy from rules store
    const { schoolTiming: _drop, ...rest } = parsed;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...rest, version: 1 }),
    );
  } catch {
    /* ignore */
  }
}


export const RULE_STEP_DEFS: {
  kind: RuleStepKind;
  label: string;
  hint: string;
}[] = [
  {
    kind: "use_school_timing",
    label: "Follow school timing",
    hint: "Expected hours = school end − start (Sunday uses Sunday times when exceptional)",
  },
  {
    kind: "buffer_late",
    label: "Buffer — late punch-in",
    hint: "Grace minutes after start before counting late / half-day pressure",
  },
  {
    kind: "buffer_early",
    label: "Buffer — early punch-out",
    hint: "Grace minutes before end before counting early leave",
  },
  {
    kind: "half_day_by_time",
    label: "Half day by entered time",
    hint: "If in-time after cutoff or out-time before cutoff → Half Day",
  },
  {
    kind: "half_day_by_hours",
    label: "Half day by hours",
    hint: "If worked hours < full-day minimum → Half Day (or Absent below floor)",
  },
  {
    kind: "sunday_exceptional",
    label: "Sunday exceptional",
    hint: "Treat Sunday as a working day under this rule (uses Sunday school times)",
  },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}


export function emptyRuleStep(
  kind: RuleStepKind,
  partial?: Partial<RuleStep>,
): RuleStep {
  return {
    id: partial?.id || nid("rst"),
    kind,
    enabled: partial?.enabled ?? true,
    bufferMinutes: partial?.bufferMinutes ?? 15,
    halfDayInAfter: partial?.halfDayInAfter ?? "11:00",
    halfDayOutBefore: partial?.halfDayOutBefore ?? "14:00",
    minFullDayHours: partial?.minFullDayHours ?? 4,
    absentBelowHours: partial?.absentBelowHours ?? 0,
  };
}

export function defaultRuleSteps(): RuleStep[] {
  return [
    emptyRuleStep("use_school_timing"),
    emptyRuleStep("buffer_late", { bufferMinutes: 15 }),
    emptyRuleStep("buffer_early", { bufferMinutes: 15, enabled: false }),
    emptyRuleStep("half_day_by_time", {
      halfDayInAfter: "11:00",
      halfDayOutBefore: "14:00",
    }),
    emptyRuleStep("half_day_by_hours", {
      enabled: false,
      minFullDayHours: 4,
      absentBelowHours: 2,
    }),
    emptyRuleStep("sunday_exceptional", { enabled: false }),
  ];
}

function seedRules(): AttendanceRule[] {
  const now = new Date().toISOString();
  return [
    {
      id: nid("arl"),
      code: "HD-TIME",
      name: "Half day by time",
      description: "School timing + late buffer + half day from punch-in/out cutoffs",
      isActive: true,
      followSchoolTiming: true,
      steps: [
        emptyRuleStep("use_school_timing"),
        emptyRuleStep("buffer_late", { bufferMinutes: 15 }),
        emptyRuleStep("half_day_by_time", {
          halfDayInAfter: "11:00",
          halfDayOutBefore: "14:00",
        }),
        emptyRuleStep("sunday_exceptional", { enabled: false }),
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nid("arl"),
      code: "HD-HRS",
      name: "Half day by hours",
      description: "School timing + buffer + half day when worked hours are short",
      isActive: true,
      followSchoolTiming: true,
      steps: [
        emptyRuleStep("use_school_timing"),
        emptyRuleStep("buffer_late", { bufferMinutes: 10 }),
        emptyRuleStep("half_day_by_hours", {
          minFullDayHours: 4,
          absentBelowHours: 2,
        }),
        emptyRuleStep("sunday_exceptional", { enabled: false }),
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function normalizeHhmm(v: string, fallback: string): string {
  const t = (v || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return fallback;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function normalizeStep(s: Partial<RuleStep> & { kind?: string }): RuleStep | null {
  const kind = s.kind as RuleStepKind;
  if (!RULE_STEP_DEFS.some((d) => d.kind === kind)) return null;
  return emptyRuleStep(kind, {
    id: s.id,
    enabled: s.enabled !== false,
    bufferMinutes:
      typeof s.bufferMinutes === "number" ? Math.max(0, s.bufferMinutes) : 15,
    halfDayInAfter: normalizeHhmm(s.halfDayInAfter || "", "11:00"),
    halfDayOutBefore: normalizeHhmm(s.halfDayOutBefore || "", "14:00"),
    minFullDayHours:
      typeof s.minFullDayHours === "number"
        ? Math.max(0, s.minFullDayHours)
        : 4,
    absentBelowHours:
      typeof s.absentBelowHours === "number"
        ? Math.max(0, s.absentBelowHours)
        : 0,
  });
}

function normalizeRule(r: Partial<AttendanceRule>): AttendanceRule | null {
  const code = (r.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const name = (r.name || "").trim();
  if (!code || !name) return null;
  const stepsRaw = Array.isArray(r.steps) ? r.steps : [];
  let steps = stepsRaw
    .map((s) => normalizeStep(s))
    .filter((s): s is RuleStep => !!s);
  if (steps.length === 0) steps = defaultRuleSteps();
  // Ensure all known kinds exist once (disabled if missing)
  for (const def of RULE_STEP_DEFS) {
    if (!steps.some((s) => s.kind === def.kind)) {
      steps.push(emptyRuleStep(def.kind, { enabled: false }));
    }
  }
  const now = new Date().toISOString();
  return {
    id: r.id || nid("arl"),
    code,
    name,
    description: (r.description || "").trim(),
    isActive: r.isActive !== false,
    followSchoolTiming: r.followSchoolTiming !== false,
    steps,
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
  };
}

export function emptyAttendanceRulesState(): StaffAttendanceRulesState {
  return {
    version: 1,
    rules: seedRules(),
    assignments: [],
  };
}

function normalizeState(
  raw: Partial<StaffAttendanceRulesState>,
): StaffAttendanceRulesState {
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(normalizeRule).filter((r): r is AttendanceRule => !!r)
    : [];
  return {
    version: 1,
    schoolTiming: raw.schoolTiming
      ? normalizeSchoolWeekTiming(raw.schoolTiming)
      : undefined,
    rules: rules.length > 0 ? rules : seedRules(),
    assignments: Array.isArray(raw.assignments)
      ? raw.assignments
          .filter((a) => a?.staffId && a?.ruleId)
          .map((a) => ({ staffId: a.staffId, ruleId: a.ruleId }))
      : [],
  };
}

export function loadAttendanceRules(): StaffAttendanceRulesState {
  if (typeof window === "undefined") return emptyAttendanceRulesState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAttendanceRulesState();
    const parsed = JSON.parse(raw) as StaffAttendanceRulesState;
    if (!parsed || parsed.version !== 1) return emptyAttendanceRulesState();
    return normalizeState(parsed);
  } catch {
    return emptyAttendanceRulesState();
  }
}

export function saveAttendanceRules(state: StaffAttendanceRulesState) {
  if (!assertModulePermission("staff", "edit", "saveAttendanceRules")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function upsertAttendanceRule(
  input: Partial<AttendanceRule> & { code: string; name: string },
): { ok: true; state: StaffAttendanceRulesState; rule: AttendanceRule } | { ok: false; error: string } {
  const state = loadAttendanceRules();
  const row = normalizeRule({
    ...input,
    updatedAt: new Date().toISOString(),
    createdAt: input.createdAt || new Date().toISOString(),
  });
  if (!row) return { ok: false, error: "Code and name are required" };

  const dup = state.rules.find(
    (r) => r.code === row.code && r.id !== row.id,
  );
  if (dup) return { ok: false, error: `Rule code ${row.code} already exists` };

  const exists = state.rules.some((r) => r.id === row.id);
  const rules = exists
    ? state.rules.map((r) => (r.id === row.id ? row : r))
    : [row, ...state.rules];
  const next = { ...state, rules };
  saveAttendanceRules(next);
  return { ok: true, state: next, rule: row };
}

export function checkAttendanceRuleRemoval(
  state: StaffAttendanceRulesState,
  ruleId: string,
): {
  canRemove: boolean;
  blockers: string[];
  suggestion: string;
  confirmMessage: string;
} {
  const rule = state.rules.find((r) => r.id === ruleId);
  const confirmMessage = `Remove rule “${rule?.name || ruleId}”?`;
  if (!rule) {
    return {
      canRemove: false,
      blockers: ["not found"],
      suggestion: "Refresh and try again",
      confirmMessage,
    };
  }
  const assigned = state.assignments.filter((a) => a.ruleId === ruleId).length;
  if (assigned > 0) {
    return {
      canRemove: false,
      blockers: [`${assigned} staff assignment(s)`],
      suggestion: `Unassign ${assigned} staff first, then delete`,
      confirmMessage,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Rule will be permanently removed.",
    confirmMessage,
  };
}

export function removeAttendanceRule(
  ruleId: string,
): { ok: true; state: StaffAttendanceRulesState } | { ok: false; error: string } {
  const state = loadAttendanceRules();
  const check = checkAttendanceRuleRemoval(state, ruleId);
  if (!check.canRemove) return { ok: false, error: check.suggestion };
  const next = {
    ...state,
    rules: state.rules.filter((r) => r.id !== ruleId),
  };
  saveAttendanceRules(next);
  return { ok: true, state: next };
}

export function assignRuleToStaff(
  staffIds: string[],
  ruleId: string,
): { ok: true; state: StaffAttendanceRulesState } | { ok: false; error: string } {
  if (staffIds.length === 0) return { ok: false, error: "Select at least one staff" };
  const state = loadAttendanceRules();
  const rule = state.rules.find((r) => r.id === ruleId && r.isActive);
  if (!rule) return { ok: false, error: "Select an active rule" };

  const map = new Map(state.assignments.map((a) => [a.staffId, a.ruleId]));
  for (const id of staffIds) map.set(id, ruleId);
  const next = {
    ...state,
    assignments: [...map.entries()].map(([staffId, rid]) => ({
      staffId,
      ruleId: rid,
    })),
  };
  saveAttendanceRules(next);
  return { ok: true, state: next };
}

export function clearStaffRuleAssignments(
  staffIds: string[],
): StaffAttendanceRulesState {
  const state = loadAttendanceRules();
  const drop = new Set(staffIds);
  const next = {
    ...state,
    assignments: state.assignments.filter((a) => !drop.has(a.staffId)),
  };
  saveAttendanceRules(next);
  return next;
}

export function ruleForStaff(
  state: StaffAttendanceRulesState,
  staffId: string,
): AttendanceRule | null {
  const asg = state.assignments.find((a) => a.staffId === staffId);
  if (!asg) return null;
  return state.rules.find((r) => r.id === asg.ruleId && r.isActive) ?? null;
}

export function describeRule(rule: AttendanceRule): string {
  const on = rule.steps.filter((s) => s.enabled).map((s) => {
    const def = RULE_STEP_DEFS.find((d) => d.kind === s.kind);
    return def?.label ?? s.kind;
  });
  return on.length ? on.join(" → ") : "No steps enabled";
}

function step(
  rule: AttendanceRule,
  kind: RuleStepKind,
): RuleStep | undefined {
  return rule.steps.find((s) => s.kind === kind && s.enabled);
}

/** Expected window for a date under school timing + rule Sunday flag. */
export function expectedWindowForDate(
  timing: SchoolWeekTiming,
  rule: AttendanceRule,
  dateIso: string,
): { start: string; end: string; isWorking: boolean; reason: string } {
  const sundayOn =
    !!step(rule, "sunday_exceptional") || timing.sundayExceptional;
  return expectedWindowForTiming(timing, dateIso, sundayOn);
}

/**
 * Evaluate punches against assigned rule (and school timing).
 * inTime/outTime = HH:mm; empty outTime treated as still present at end.
 */
export function evaluatePunchAgainstRule(
  state: StaffAttendanceRulesState,
  rule: AttendanceRule,
  dateIso: string,
  inTime: string,
  outTime: string,
): PunchEvaluation {
  const notes: string[] = [];
  const timing =
    state.schoolTiming
      ? normalizeSchoolWeekTiming(state.schoolTiming)
      : schoolTimingFromMasters();
  const window = expectedWindowForDate(timing, rule, dateIso);

  if (!window.isWorking) {
    return {
      status: "LE",
      label: "Non-working day",
      expectedHours: 0,
      workedHours: 0,
      notes: [window.reason],
    };
  }

  const useSchool = rule.followSchoolTiming || !!step(rule, "use_school_timing");
  const start = useSchool ? window.start : timing.startTime;
  const end = useSchool ? window.end : timing.endTime;
  const expectedHours = hoursBetweenTiming(start, end);
  notes.push(`Expected ${start}–${end} (${expectedHours}h)`);

  const inRaw = (inTime || "").trim();
  if (!inRaw || !/^\d{1,2}:\d{2}$/.test(inRaw)) {
    return {
      status: "A",
      label: "Absent — no in-time",
      expectedHours,
      workedHours: 0,
      notes,
    };
  }
  const inT = normalizeHhmm(inRaw, "09:00");
  const outRaw = (outTime || "").trim();
  const outT = outRaw ? normalizeHhmm(outRaw, end) : end;
  const workedHours = hoursBetweenTiming(inT, outT);
  notes.push(`Worked ${inT}–${outT} (${workedHours}h)`);

  const earlyBuf = step(rule, "buffer_early");
  /** Campus grace from Leave settings (minutes). */
  const campusGrace = getGracePeriodMinutes();
  const lateGrace = campusGrace;
  const earlyGrace = campusGrace;

  const inMin = minutesOf(inT);
  const outMin = minutesOf(outT);
  const startMin = minutesOf(start);
  const endMin = minutesOf(end);

  const lateBy = Math.max(0, inMin - startMin - lateGrace);
  const earlyBy = Math.max(0, endMin - earlyGrace - outMin);
  if (campusGrace > 0) {
    notes.push(`Late threshold ${campusGrace} min after start`);
  }
  if (lateBy > 0) {
    notes.push(`Late by ${lateBy} min (threshold ${lateGrace}m)`);
  }
  if (earlyBuf && earlyBy > 0) {
    notes.push(`Early by ${earlyBy} min (threshold ${earlyGrace}m)`);
  }

  // Half day by hours
  const byHours = step(rule, "half_day_by_hours");
  if (byHours) {
    if (
      byHours.absentBelowHours > 0 &&
      workedHours < byHours.absentBelowHours - 0.001
    ) {
      return {
        status: "A",
        label: `Absent — under ${byHours.absentBelowHours}h`,
        expectedHours,
        workedHours,
        notes,
      };
    }
    if (workedHours < byHours.minFullDayHours - 0.001) {
      return {
        status: "HD",
        label: `Half day — under ${byHours.minFullDayHours}h`,
        expectedHours,
        workedHours,
        notes,
      };
    }
  }

  // Half day by time (grace softens cutoffs)
  const byTime = step(rule, "half_day_by_time");
  if (byTime) {
    const inAfter = minutesOf(byTime.halfDayInAfter) + campusGrace;
    const outBefore = minutesOf(byTime.halfDayOutBefore) - campusGrace;
    if (inMin > inAfter) {
      return {
        status: "HD",
        label: `Half day — in after ${byTime.halfDayInAfter}${
          campusGrace > 0 ? ` (+${campusGrace}m grace)` : ""
        }`,
        expectedHours,
        workedHours,
        notes,
      };
    }
    if (outMin < outBefore) {
      return {
        status: "HD",
        label: `Half day — out before ${byTime.halfDayOutBefore}${
          campusGrace > 0 ? ` (−${campusGrace}m grace)` : ""
        }`,
        expectedHours,
        workedHours,
        notes,
      };
    }
  }

  if (lateBy > 0) {
    return {
      status: "L",
      label: "Late",
      expectedHours,
      workedHours,
      notes,
    };
  }

  return {
    status: "P",
    label: "Present",
    expectedHours,
    workedHours,
    notes,
  };
}

export function activeStaffSorted(staff: StaffRecord[]): StaffRecord[] {
  return staff
    .filter((s) => s.status === "active")
    .sort((a, b) => a.empCode.localeCompare(b.empCode));
}

export function newAttendanceRuleDraft(): AttendanceRule {
  const now = new Date().toISOString();
  return {
    id: nid("arl"),
    code: "",
    name: "",
    description: "",
    isActive: true,
    followSchoolTiming: true,
    steps: defaultRuleSteps(),
    createdAt: now,
    updatedAt: now,
  };
}
