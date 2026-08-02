import type { AttendanceRegister, AttendanceState } from "@/lib/attendance";
import type { AttendanceDeskAncillary } from "@/lib/attendanceDeskAncillary.server";

export function attendanceReadFromDbFlag(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_ATTENDANCE_READ_FROM_DB === "true";
  }
  return process.env.ATTENDANCE_READ_FROM_DB === "true";
}

function preferRemoteDb(
  localLen: number,
  remoteLen: number,
  preferDb?: boolean,
): boolean {
  return (
    !!preferDb ||
    attendanceReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

/** Merge DB registers into attendance state (registers slice). */
export function mergeDbRegistersIntoAttendanceState<
  T extends { registers: AttendanceRegister[] },
>(state: T, dbRegisters: AttendanceRegister[], opts?: { preferDb?: boolean }): T {
  if (!dbRegisters.length) return state;
  const local = state.registers ?? [];
  if (!preferRemoteDb(local.length, dbRegisters.length, opts?.preferDb)) {
    return state;
  }

  const byId = new Map<string, AttendanceRegister>();
  for (const r of dbRegisters) byId.set(r.id, r);
  for (const r of local) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const merged = [...byId.values()].sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (b.markedAt || "").localeCompare(a.markedAt || ""),
  );
  return { ...state, registers: merged };
}

function mergeSlice<T extends { id: string }>(
  local: T[],
  remote: T[],
  preferDb?: boolean,
): T[] {
  if (!remote.length) return local;
  if (!preferRemoteDb(local.length, remote.length, preferDb)) return local;
  const byId = new Map<string, T>();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    if (!byId.has(l.id)) byId.set(l.id, l);
  }
  return [...byId.values()];
}

/** Merge ancillary attendance desk slices from DB. */
export function mergeDbAncillaryIntoAttendanceState<T extends AttendanceDeskAncillary>(
  state: T,
  ancillary: AttendanceDeskAncillary,
  opts?: { preferDb?: boolean },
): T {
  const prefer = opts?.preferDb ?? attendanceReadFromDbFlag();
  if (
    !prefer &&
    !ancillary.absentNudges.length &&
    !ancillary.exceptions.length
  ) {
    return state;
  }

  return {
    ...state,
    policy: prefer ? ancillary.policy : state.policy,
    absentNudges: mergeSlice(
      state.absentNudges ?? [],
      ancillary.absentNudges,
      prefer,
    ),
    exceptions: mergeSlice(
      state.exceptions ?? [],
      ancillary.exceptions,
      prefer,
    ),
  };
}

/** Merge full attendance desk snapshot (registers + ancillary). */
export function mergeDbDeskIntoAttendanceState(
  state: AttendanceState,
  desk: { registers: AttendanceRegister[]; ancillary: AttendanceDeskAncillary },
  opts?: { preferDb?: boolean },
): AttendanceState {
  let next = mergeDbRegistersIntoAttendanceState(state, desk.registers, opts);
  next = mergeDbAncillaryIntoAttendanceState(next, desk.ancillary, opts);
  return next;
}
