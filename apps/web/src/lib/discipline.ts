/**
 * Discipline / behavior tracking — incident log, merit/demerit points
 * (a derived rollup, not a separate ledger), and a staff-triggered
 * WhatsApp parent notify. Greenfield module — nothing in SIS previously
 * tracked conduct.
 *
 * Storage: localStorage only for now, same deliberate scope limit as
 * lib/dutyRoster.ts/lib/examInvigilation.ts — wiring into the desk-slice
 * sync pattern needs a new Supabase migration, not done this round.
 *
 * Unlike lib/dutyRoster.ts's saveDutyRoster (which has no real permission
 * guard), saveDiscipline follows lib/holds.ts's saveHolds pattern and
 * calls assertModulePermission — the actual server/session-enforced check.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { householdOf, householdWhatsApp, type SisState } from "@/lib/sis";

export type DisciplineCategory =
  | "uniform"
  | "late"
  | "disruption"
  | "bullying"
  | "academic_dishonesty"
  | "other";

export const DISCIPLINE_CATEGORIES: { value: DisciplineCategory; label: string }[] = [
  { value: "uniform", label: "Uniform / grooming" },
  { value: "late", label: "Late to school/class" },
  { value: "disruption", label: "Class disruption" },
  { value: "bullying", label: "Bullying / conflict" },
  { value: "academic_dishonesty", label: "Academic dishonesty" },
  { value: "other", label: "Other" },
];

export type EscalationLevel =
  | "none"
  | "warning"
  | "parent_meeting"
  | "suspension_recommendation";

export const ESCALATION_LEVELS: { value: EscalationLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "warning", label: "Warning" },
  { value: "parent_meeting", label: "Parent meeting" },
  { value: "suspension_recommendation", label: "Suspension recommendation" },
];

export type IncidentStatus = "open" | "reviewed" | "resolved";

export type DisciplineIncident = {
  id: string;
  studentId: string;
  academicYearCode: string;
  /** YYYY-MM-DD */
  date: string;
  category: DisciplineCategory;
  /** Negative = demerit, positive = merit. */
  pointsDelta: number;
  description: string;
  reportedByStaffId: string;
  escalationLevel: EscalationLevel;
  status: IncidentStatus;
  /** ISO timestamp of the last "Notify parent" send, or null. */
  notifiedParentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DisciplineState = {
  version: 1;
  incidents: DisciplineIncident[];
};

const STORAGE_KEY = "bhb_discipline_v1";
const CATEGORY_SET = new Set<DisciplineCategory>(
  DISCIPLINE_CATEGORIES.map((c) => c.value),
);
const ESCALATION_SET = new Set<EscalationLevel>(
  ESCALATION_LEVELS.map((e) => e.value),
);
const STATUS_SET = new Set<IncidentStatus>(["open", "reviewed", "resolved"]);

/** Rolling lookback window for suggestEscalationLevel's "recent" count —
 * a named constant so a school can tune it later without hunting for a
 * magic number inline. */
export const DISCIPLINE_RECENT_WINDOW_DAYS = 90;

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function disciplineCategoryLabel(category: DisciplineCategory): string {
  return DISCIPLINE_CATEGORIES.find((c) => c.value === category)?.label || category;
}

export function escalationLevelLabel(level: EscalationLevel): string {
  return ESCALATION_LEVELS.find((e) => e.value === level)?.label || level;
}

function normalizeIncident(
  raw: Partial<DisciplineIncident> | null | undefined,
): DisciplineIncident | null {
  if (!raw?.studentId || !raw.date) return null;
  const category = CATEGORY_SET.has(raw.category as DisciplineCategory)
    ? (raw.category as DisciplineCategory)
    : "other";
  const escalationLevel = ESCALATION_SET.has(
    raw.escalationLevel as EscalationLevel,
  )
    ? (raw.escalationLevel as EscalationLevel)
    : "none";
  const status = STATUS_SET.has(raw.status as IncidentStatus)
    ? (raw.status as IncidentStatus)
    : "open";
  const now = nowIso();
  return {
    id: raw.id || nid("disc"),
    studentId: raw.studentId,
    academicYearCode: raw.academicYearCode || "",
    date: raw.date.slice(0, 10),
    category,
    pointsDelta: Number.isFinite(raw.pointsDelta) ? Number(raw.pointsDelta) : 0,
    description: String(raw.description || "").trim(),
    reportedByStaffId: raw.reportedByStaffId || "",
    escalationLevel,
    status,
    notifiedParentAt: raw.notifiedParentAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function emptyDisciplineState(): DisciplineState {
  return { version: 1, incidents: [] };
}

export function normalizeDisciplineState(raw: unknown): DisciplineState {
  if (!raw || typeof raw !== "object") return emptyDisciplineState();
  const r = raw as Partial<DisciplineState>;
  const incidents = Array.isArray(r.incidents)
    ? r.incidents
        .map((i) => normalizeIncident(i as Partial<DisciplineIncident>))
        .filter((x): x is DisciplineIncident => !!x)
    : [];
  return { version: 1, incidents };
}

export function loadDiscipline(): DisciplineState {
  if (typeof window === "undefined") return emptyDisciplineState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDisciplineState();
    return normalizeDisciplineState(JSON.parse(raw));
  } catch {
    return emptyDisciplineState();
  }
}

/** The real permission guard — see file header for why this differs from
 * lib/dutyRoster.ts's saveDutyRoster, which has no such check. */
export function saveDiscipline(state: DisciplineState): DisciplineState {
  if (!assertModulePermission("discipline", "edit", "saveDiscipline")) {
    return state;
  }
  const next = normalizeDisciplineState(state);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("discipline", next));
    window.dispatchEvent(new CustomEvent("bhb-discipline"));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeDisciplineLocalRaw(state: DisciplineState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
  window.dispatchEvent(new CustomEvent("bhb-discipline"));
}

export function upsertIncident(
  state: DisciplineState,
  input: Partial<DisciplineIncident> & {
    studentId: string;
    date: string;
    category: DisciplineCategory;
  },
): { state: DisciplineState; incident: DisciplineIncident } {
  const existing = input.id
    ? state.incidents.find((i) => i.id === input.id)
    : undefined;
  const incident = normalizeIncident({
    ...existing,
    ...input,
    id: existing?.id || input.id || nid("disc"),
    createdAt: existing?.createdAt,
  })!;
  const incidents = existing
    ? state.incidents.map((i) => (i.id === incident.id ? incident : i))
    : [incident, ...state.incidents];
  return { state: { ...state, incidents }, incident };
}

export function deleteIncident(
  state: DisciplineState,
  id: string,
): DisciplineState {
  return saveDiscipline({
    ...state,
    incidents: state.incidents.filter((i) => i.id !== id),
  });
}

export function listIncidentsForStudent(
  state: DisciplineState,
  studentId: string,
): DisciplineIncident[] {
  return state.incidents
    .filter((i) => i.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Derived sum — never a stored ledger, so it can't drift from the log. */
export function studentPointsTotal(
  state: DisciplineState,
  studentId: string,
  academicYearCode: string,
): number {
  return state.incidents
    .filter(
      (i) => i.studentId === studentId && i.academicYearCode === academicYearCode,
    )
    .reduce((sum, i) => sum + i.pointsDelta, 0);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return Infinity;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** Count of incidents for a student within the trailing
 * DISCIPLINE_RECENT_WINDOW_DAYS of `asOf` (inclusive). */
export function recentIncidentCount(
  state: DisciplineState,
  studentId: string,
  asOf = new Date().toISOString().slice(0, 10),
): number {
  return state.incidents.filter(
    (i) =>
      i.studentId === studentId &&
      daysBetween(i.date, asOf) >= 0 &&
      daysBetween(i.date, asOf) <= DISCIPLINE_RECENT_WINDOW_DAYS,
  ).length;
}

/**
 * Advisory only — mirrors lib/playbook.ts's resolveStage threshold shape.
 * Staff always sets escalationLevel manually; the UI must label this
 * "Suggested — adjust to your school's policy," never as a decided fact.
 * These threshold numbers are a reasonable placeholder, not a CBSE policy
 * fact from this school.
 */
export function suggestEscalationLevel(
  totalPoints: number,
  recentCount: number,
): EscalationLevel {
  if (totalPoints <= -15 || recentCount >= 5) return "suspension_recommendation";
  if (totalPoints <= -8 || recentCount >= 3) return "parent_meeting";
  if (totalPoints <= -3 || recentCount >= 1) return "warning";
  return "none";
}

/** WA parent notify — mirrors lib/dutyRoster.ts's notifyDutyStaff shape,
 * staff-triggered only, never automatic. */
export async function notifyDisciplineParent(
  incident: DisciplineIncident,
  sis: SisState,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const student = sis.students.find((s) => s.id === incident.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const household = householdOf(sis, student.householdId);
  const mobile = householdWhatsApp(household);
  if (!mobile) return { ok: false, error: "No WhatsApp number on file" };
  const body = `Discipline note for ${student.fullName}: ${disciplineCategoryLabel(incident.category)} on ${incident.date}. ${incident.description}`.trim();
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "discipline",
        dryRun: !!opts?.dryRun,
        messages: [{ mobile, body }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
