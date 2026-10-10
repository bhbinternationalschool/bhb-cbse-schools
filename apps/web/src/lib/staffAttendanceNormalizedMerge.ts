import type {
  OutdoorDutySession,
  StaffAttendanceRegister,
  StaffAttendanceState,
} from "@/lib/staffAttendance";
import type { StaffAttendanceDeskAncillary } from "@/lib/staffAttendanceDeskAncillary.server";
import { staffAttendanceReadFromDbEnabled } from "@/lib/staffAttendanceDbConfig";

export function staffAttendanceReadFromDbFlag(): boolean {
  return staffAttendanceReadFromDbEnabled();
}

function preferRemoteDb(
  localLen: number,
  remoteLen: number,
  preferDb?: boolean,
): boolean {
  return (
    !!preferDb ||
    staffAttendanceReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

export function mergeDbRegistersIntoStaffAttendanceState<
  T extends { registers: StaffAttendanceRegister[] },
>(
  state: T,
  dbRegisters: StaffAttendanceRegister[],
  opts?: { preferDb?: boolean },
): T {
  if (!dbRegisters.length) return state;
  const local = state.registers ?? [];
  if (!preferRemoteDb(local.length, dbRegisters.length, opts?.preferDb)) {
    return state;
  }

  const byId = new Map<string, StaffAttendanceRegister>();
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

export function mergeDbSettingsIntoStaffAttendanceState<
  T extends StaffAttendanceDeskAncillary,
>(
  state: T,
  ancillary: StaffAttendanceDeskAncillary,
  opts?: { preferDb?: boolean },
): T {
  const prefer = opts?.preferDb ?? staffAttendanceReadFromDbFlag();
  if (!prefer) return state;
  return { ...state, settings: ancillary.settings };
}

/**
 * Union by id — this merge never drops a session.
 *
 * Two rules earn their keep here:
 *
 * 1. A session the DB reports "ended" wins over a local copy still marked
 *    active, whatever the preferDb flag says. Otherwise a tab left open on
 *    one machine keeps showing someone as out of campus after they checked
 *    back in somewhere else, and "who is out right now" is the whole point
 *    of the panel.
 * 2. A session held locally but absent from the DB survives. It is a push
 *    that has not landed yet, not a deletion — treating it as one is how
 *    the transport desk got wiped.
 */
export function mergeDbOutdoorDutyIntoStaffAttendanceState<
  T extends { outdoorDuty: OutdoorDutySession[] },
>(
  state: T,
  dbSessions: OutdoorDutySession[],
  opts?: { preferDb?: boolean },
): T {
  if (!dbSessions.length) return state;
  const local = state.outdoorDuty ?? [];
  const prefer = preferRemoteDb(local.length, dbSessions.length, opts?.preferDb);

  const byId = new Map<string, OutdoorDutySession>();
  for (const s of local) byId.set(s.id, s);
  for (const remote of dbSessions) {
    const mine = byId.get(remote.id);
    if (!mine) {
      byId.set(remote.id, remote);
      continue;
    }
    // Closure is one-way: whoever saw the check-in is right.
    if (mine.status === "active" && remote.status === "ended") {
      byId.set(remote.id, remote);
      continue;
    }
    if (prefer && !(remote.status === "active" && mine.status === "ended")) {
      byId.set(remote.id, remote);
    }
  }

  const merged = [...byId.values()].sort((a, b) =>
    (b.startedAt || "").localeCompare(a.startedAt || ""),
  );
  return { ...state, outdoorDuty: merged };
}

export function mergeDbDeskIntoStaffAttendanceState(
  state: StaffAttendanceState,
  desk: {
    registers: StaffAttendanceRegister[];
    ancillary: StaffAttendanceDeskAncillary;
  },
  opts?: { preferDb?: boolean },
): StaffAttendanceState {
  let next = mergeDbRegistersIntoStaffAttendanceState(
    state,
    desk.registers,
    opts,
  );
  next = mergeDbSettingsIntoStaffAttendanceState(next, desk.ancillary, opts);
  next = mergeDbOutdoorDutyIntoStaffAttendanceState(
    next,
    desk.ancillary.outdoorDuty ?? [],
    opts,
  );
  return next;
}
