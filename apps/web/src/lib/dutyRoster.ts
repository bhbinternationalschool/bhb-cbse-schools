/**
 * Dated staff duty roster — assembly, gate, lunch, bus escort, event duty.
 *
 * lib/foundationMasters.ts's StaffDutyLink is a static year-long role tag
 * (e.g. "Lab in-charge") set once per staff member — nothing in the
 * codebase assigns *which* staff cover a recurring daily duty on *which*
 * date. This fills that gap with rotation templates (a duty type + the
 * weekdays it recurs on + a pool of staff to cycle through) that generate
 * dated DutyAssignment rows, mirroring the substitution engine's auto-run +
 * WA notify pattern (lib/timetableSubstitutionAuto.ts) and its fairness
 * ranking (lib/examInvigilation.ts's dutyLoadToday).
 *
 * Storage: localStorage only for now, no server dual-write — the same
 * deliberate scope limit as lib/examInvigilation.ts; wiring this into the
 * desk-slice sync pattern needs a new Supabase migration.
 */

import { isoDateWeekday } from "@/lib/examTimetable";
import type { MastersState } from "@/lib/masters";
import { teacherLabel } from "@/lib/timetable";

export type DutyType = "assembly" | "gate" | "lunch" | "bus_escort" | "event";

export const DUTY_TYPES: { value: DutyType; label: string }[] = [
  { value: "assembly", label: "Morning assembly" },
  { value: "gate", label: "Gate duty" },
  { value: "lunch", label: "Lunch / recess duty" },
  { value: "bus_escort", label: "Bus escort" },
  { value: "event", label: "Event duty" },
];

export function dutyTypeLabel(t: DutyType): string {
  return DUTY_TYPES.find((d) => d.value === t)?.label || t;
}

export type DutyRotationTemplate = {
  id: string;
  dutyType: DutyType;
  label: string;
  /** 0=Sun..6=Sat — which days this duty recurs on. */
  weekdays: number[];
  /** Rotation pool, ranked by recent load each time a week is generated. */
  staffPool: string[];
  /** How many staff are needed per occurrence (e.g. 2 gate guards/day). */
  slotsPerDay: number;
  active: boolean;
};

export type DutyAssignment = {
  id: string;
  date: string;
  dutyType: DutyType;
  staffId: string;
  templateId: string | null;
  source: "auto" | "manual";
  note: string;
  createdAt: string;
};

export type DutyRosterState = {
  version: 1;
  templates: DutyRotationTemplate[];
  assignments: DutyAssignment[];
};

const STORAGE_KEY = "bhb_duty_roster_v1";
const DUTY_TYPE_SET = new Set<DutyType>(DUTY_TYPES.map((d) => d.value));

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function emptyDutyRosterState(): DutyRosterState {
  return { version: 1, templates: [], assignments: [] };
}

function isDutyType(v: unknown): v is DutyType {
  return typeof v === "string" && DUTY_TYPE_SET.has(v as DutyType);
}

function normalizeTemplate(
  raw: Partial<DutyRotationTemplate> | null | undefined,
): DutyRotationTemplate | null {
  if (!raw?.id || !isDutyType(raw.dutyType)) return null;
  const weekdays = Array.isArray(raw.weekdays)
    ? [
        ...new Set(
          raw.weekdays.filter(
            (n): n is number => typeof n === "number" && n >= 0 && n <= 6,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];
  const staffPool = Array.isArray(raw.staffPool)
    ? raw.staffPool.filter((s): s is string => typeof s === "string" && !!s)
    : [];
  return {
    id: raw.id,
    dutyType: raw.dutyType,
    label: String(raw.label || "").trim() || dutyTypeLabel(raw.dutyType),
    weekdays,
    staffPool,
    slotsPerDay: Math.max(1, Math.floor(Number(raw.slotsPerDay) || 1)),
    active: raw.active !== false,
  };
}

function normalizeAssignment(
  raw: Partial<DutyAssignment> | null | undefined,
): DutyAssignment | null {
  if (!raw?.id || !raw.date || !isDutyType(raw.dutyType) || !raw.staffId) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  return {
    id: raw.id,
    date: raw.date,
    dutyType: raw.dutyType,
    staffId: raw.staffId,
    templateId: raw.templateId ?? null,
    source: raw.source === "manual" ? "manual" : "auto",
    note: String(raw.note || ""),
    createdAt: raw.createdAt || nowIso(),
  };
}

export function normalizeDutyRosterState(raw: unknown): DutyRosterState {
  if (!raw || typeof raw !== "object") return emptyDutyRosterState();
  const r = raw as Partial<DutyRosterState>;
  const templates = Array.isArray(r.templates)
    ? r.templates
        .map((t) => normalizeTemplate(t as Partial<DutyRotationTemplate>))
        .filter((x): x is DutyRotationTemplate => !!x)
    : [];
  const assignments = Array.isArray(r.assignments)
    ? r.assignments
        .map((a) => normalizeAssignment(a as Partial<DutyAssignment>))
        .filter((x): x is DutyAssignment => !!x)
    : [];
  return { version: 1, templates, assignments };
}

export function loadDutyRoster(): DutyRosterState {
  if (typeof window === "undefined") return emptyDutyRosterState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDutyRosterState();
    return normalizeDutyRosterState(JSON.parse(raw));
  } catch {
    return emptyDutyRosterState();
  }
}

export function saveDutyRoster(state: DutyRosterState): DutyRosterState {
  const next = normalizeDutyRosterState(state);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("bhb-duty-roster"));
  }
  return next;
}

export function upsertTemplate(
  state: DutyRosterState,
  input: Partial<DutyRotationTemplate> & { dutyType: DutyType },
): { state: DutyRosterState; template: DutyRotationTemplate } {
  const existing = input.id
    ? state.templates.find((t) => t.id === input.id)
    : undefined;
  const template = normalizeTemplate({
    ...existing,
    ...input,
    id: existing?.id || input.id || nid("duty_tpl"),
  })!;
  const templates = existing
    ? state.templates.map((t) => (t.id === template.id ? template : t))
    : [...state.templates, template];
  return { state: saveDutyRoster({ ...state, templates }), template };
}

export function deleteTemplate(
  state: DutyRosterState,
  id: string,
): DutyRosterState {
  return saveDutyRoster({
    ...state,
    templates: state.templates.filter((t) => t.id !== id),
  });
}

export function listAssignmentsForDate(
  state: DutyRosterState,
  date: string,
): DutyAssignment[] {
  return state.assignments.filter((a) => a.date === date);
}

function weekDates(weekStartIso: string): string[] {
  const start = new Date(`${weekStartIso}T12:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function listAssignmentsForWeek(
  state: DutyRosterState,
  weekStartIso: string,
): DutyAssignment[] {
  const dates = new Set(weekDates(weekStartIso));
  return state.assignments.filter((a) => dates.has(a.date));
}

export function upsertAssignment(
  state: DutyRosterState,
  input: {
    id?: string;
    date: string;
    dutyType: DutyType;
    staffId: string;
    templateId?: string | null;
    source?: "auto" | "manual";
    note?: string;
  },
): { state: DutyRosterState; assignment: DutyAssignment } {
  const existing = input.id
    ? state.assignments.find((a) => a.id === input.id)
    : undefined;
  const assignment = normalizeAssignment({
    id: existing?.id || input.id || nid("duty"),
    date: input.date,
    dutyType: input.dutyType,
    staffId: input.staffId,
    templateId: input.templateId ?? existing?.templateId ?? null,
    source: input.source || "manual",
    note: input.note ?? existing?.note ?? "",
    createdAt: existing?.createdAt,
  })!;
  const assignments = existing
    ? state.assignments.map((a) => (a.id === assignment.id ? assignment : a))
    : [...state.assignments, assignment];
  return { state: saveDutyRoster({ ...state, assignments }), assignment };
}

export function deleteAssignment(
  state: DutyRosterState,
  id: string,
): DutyRosterState {
  return saveDutyRoster({
    ...state,
    assignments: state.assignments.filter((a) => a.id !== id),
  });
}

/** How many times each staff id has served any duty in the trailing 60 days
 * up to (and including) asOfDate — used to rotate fairly rather than always
 * picking the first name in the pool. */
function recentLoad(
  state: DutyRosterState,
  asOfDate: string,
): Map<string, number> {
  const cutoff = new Date(`${asOfDate}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const load = new Map<string, number>();
  for (const a of state.assignments) {
    if (a.date < cutoffIso || a.date > asOfDate) continue;
    load.set(a.staffId, (load.get(a.staffId) ?? 0) + 1);
  }
  return load;
}

export type DutyGenerationOutcome = {
  created: DutyAssignment[];
  skippedExisting: number;
};

/** Fill in a week's duty assignments from active templates — additive only,
 * never touches a date+template slot that's already been filled, so
 * re-running it after manually editing one day is safe. */
export function generateWeekFromTemplates(
  state: DutyRosterState,
  weekStartIso: string,
): { state: DutyRosterState; outcome: DutyGenerationOutcome } {
  const dates = weekDates(weekStartIso);
  const assignments = [...state.assignments];
  const created: DutyAssignment[] = [];
  let skippedExisting = 0;

  for (const date of dates) {
    const weekday = isoDateWeekday(date);
    if (weekday == null) continue;
    for (const tpl of state.templates) {
      if (!tpl.active || !tpl.weekdays.includes(weekday)) continue;
      if (!tpl.staffPool.length) continue;

      const already = assignments.filter(
        (a) => a.date === date && a.templateId === tpl.id,
      );
      const need = tpl.slotsPerDay - already.length;
      if (need <= 0) {
        skippedExisting += already.length;
        continue;
      }

      const load = recentLoad({ ...state, assignments }, date);
      const takenToday = new Set(already.map((a) => a.staffId));
      const ranked = [...tpl.staffPool]
        .filter((id) => !takenToday.has(id))
        .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));

      for (const staffId of ranked.slice(0, need)) {
        const assignment: DutyAssignment = {
          id: nid("duty"),
          date,
          dutyType: tpl.dutyType,
          staffId,
          templateId: tpl.id,
          source: "auto",
          note: "Auto — rotation",
          createdAt: nowIso(),
        };
        assignments.push(assignment);
        created.push(assignment);
        load.set(staffId, (load.get(staffId) ?? 0) + 1);
      }
    }
  }

  return {
    state: saveDutyRoster({ ...state, assignments }),
    outcome: { created, skippedExisting },
  };
}

export type DutyNotifyMessage = { mobile: string; body: string };

/** One WhatsApp text per staff member, listing every duty just assigned to
 * them for that date (a teacher covering assembly + gate gets one message,
 * not two). */
export function buildDutyNotifyMessages(
  created: DutyAssignment[],
  masters: MastersState,
  date: string,
): DutyNotifyMessage[] {
  const byStaff = new Map<string, DutyAssignment[]>();
  for (const a of created) {
    const list = byStaff.get(a.staffId) ?? [];
    list.push(a);
    byStaff.set(a.staffId, list);
  }

  const out: DutyNotifyMessage[] = [];
  for (const [staffId, duties] of byStaff) {
    const staff = masters.staff.find((s) => s.id === staffId);
    const mobile = staff?.mobile?.trim();
    if (!mobile) continue;
    const lines = duties.map((d) => `• ${dutyTypeLabel(d.dutyType)}`);
    out.push({
      mobile,
      body: `You're on duty on ${date}:\n${lines.join("\n")}`,
    });
  }
  return out;
}

/** Send duty-assignment WhatsApp notices via the shared dispatch route. Set
 * `dryRun: true` to validate the request without sending. */
export async function notifyDutyStaff(
  created: DutyAssignment[],
  masters: MastersState,
  date: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; sent: number; error?: string }> {
  const messages = buildDutyNotifyMessages(created, masters, date);
  if (!messages.length) return { ok: true, sent: 0 };
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "staff",
        dryRun: !!opts?.dryRun,
        messages: messages.map((m) => ({ mobile: m.mobile, body: m.body })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      accepted?: number;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, sent: 0, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, sent: data.accepted ?? messages.length };
  } catch (e) {
    return { ok: false, sent: 0, error: String(e) };
  }
}

export function dutyStaffLabel(masters: MastersState, staffId: string): string {
  return teacherLabel(masters, staffId);
}
