import type {
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
  return next;
}
