/**
 * Hand-corrected attendance on a result (director, 8 Oct 2026: "show present
 * day and working day in result also and option to edit"). The computed
 * figure (lib/studentWorkingDays) is the default; an override is a person's
 * deliberate correction for ONE exam term's result, kept with who made it
 * and why, and shown as edited. Clearing it returns to the computed figure.
 *
 * module_local_state "attendance_result_overrides" (rbac: exams).
 */

import { writeCacheOrInvalidate, readCache } from "@/lib/browserStorage";
import { trackServerWork } from "@/lib/serverWork";

const STORAGE_KEY = "bhb_attendance_result_overrides_v1";

export type AttendanceResultOverride = {
  academicYearCode: string;
  examTermId: string;
  studentId: string;
  presentDays: number;
  workingDays: number;
  note: string;
  by: string;
  at: string;
};

export type AttendanceResultOverridesState = {
  version: 1;
  overrides: AttendanceResultOverride[];
};

export function emptyAttendanceResultOverrides(): AttendanceResultOverridesState {
  return { version: 1, overrides: [] };
}

const half = (n: unknown) => Math.round((Number(n) || 0) * 2) / 2;

export function normalizeAttendanceResultOverrides(raw: unknown): AttendanceResultOverridesState {
  const r = (raw ?? {}) as Partial<AttendanceResultOverridesState>;
  const overrides = Array.isArray(r.overrides)
    ? r.overrides
        .filter((o) => o && o.studentId && o.examTermId && o.academicYearCode)
        .map((o) => ({
          academicYearCode: String(o.academicYearCode),
          examTermId: String(o.examTermId),
          studentId: String(o.studentId),
          presentDays: half(o.presentDays),
          workingDays: half(o.workingDays),
          note: String(o.note || ""),
          by: String(o.by || ""),
          at: String(o.at || ""),
        }))
        .filter((o) => o.workingDays > 0 && o.presentDays >= 0 && o.presentDays <= o.workingDays)
    : [];
  return { version: 1, overrides };
}

export function loadAttendanceResultOverrides(): AttendanceResultOverridesState {
  if (typeof window === "undefined") return serverCopy ?? emptyAttendanceResultOverrides();
  try {
    const raw = readCache(STORAGE_KEY);
    return raw ? normalizeAttendanceResultOverrides(JSON.parse(raw)) : emptyAttendanceResultOverrides();
  } catch {
    return emptyAttendanceResultOverrides();
  }
}

let serverCopy: AttendanceResultOverridesState | null = null;
/** Server callers that read module_local_state themselves hand the row in here. */
export function setServerAttendanceResultOverrides(state: unknown): void {
  serverCopy = normalizeAttendanceResultOverrides(state);
}

/** Hydrate path — cache write only, no push. */
export function writeAttendanceResultOverridesLocalRaw(state: AttendanceResultOverridesState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
  window.dispatchEvent(new CustomEvent("bhb-attendance-overrides"));
}

function save(next: AttendanceResultOverridesState): AttendanceResultOverridesState {
  const clean = normalizeAttendanceResultOverrides(next);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(clean));
    void trackServerWork(
      import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("attendance_result_overrides", clean)),
    );
    window.dispatchEvent(new CustomEvent("bhb-attendance-overrides"));
  }
  return clean;
}

export function findAttendanceOverride(
  state: AttendanceResultOverridesState,
  ay: string,
  examTermId: string,
  studentId: string,
): AttendanceResultOverride | null {
  return (
    state.overrides.find(
      (o) => o.academicYearCode === ay && o.examTermId === examTermId && o.studentId === studentId,
    ) ?? null
  );
}

/** Set (or, with `clear`, remove) one student's corrected figure for one exam term. */
export function setAttendanceOverride(input: {
  academicYearCode: string;
  examTermId: string;
  studentId: string;
  presentDays: number;
  workingDays: number;
  note: string;
  by: string;
  clear?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const state = loadAttendanceResultOverrides();
  const rest = state.overrides.filter(
    (o) => !(o.academicYearCode === input.academicYearCode && o.examTermId === input.examTermId && o.studentId === input.studentId),
  );
  if (input.clear) {
    save({ version: 1, overrides: rest });
    return { ok: true };
  }
  const w = half(input.workingDays);
  const p = half(input.presentDays);
  if (!(w > 0)) return { ok: false, error: "Working days must be more than 0" };
  if (p < 0 || p > w) return { ok: false, error: "Present days must be between 0 and the working days" };
  if (Math.round(Number(input.workingDays) * 2) !== Number(input.workingDays) * 2 || Math.round(Number(input.presentDays) * 2) !== Number(input.presentDays) * 2) {
    return { ok: false, error: "Use whole or half days (e.g. 120 or 118.5)" };
  }
  if (!input.note.trim()) return { ok: false, error: "Write why it is being changed — it is kept with the result" };
  save({
    version: 1,
    overrides: [
      ...rest,
      {
        academicYearCode: input.academicYearCode,
        examTermId: input.examTermId,
        studentId: input.studentId,
        presentDays: p,
        workingDays: w,
        note: input.note.trim(),
        by: input.by,
        at: new Date().toISOString(),
      },
    ],
  });
  return { ok: true };
}
