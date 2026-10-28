/**
 * Server read / write of the staff broadcast log (lib/staffBroadcastLog).
 */

import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import {
  emptyStaffBroadcastLog,
  normalizeStaffBroadcastLog,
  withBroadcastEntry,
  type StaffBroadcastEntry,
  type StaffBroadcastLog,
} from "@/lib/staffBroadcastLog";

const KEY = "staff_broadcasts" as const;

/** null = could not read (never treated as "nothing sent"). */
export async function readStaffBroadcastLog(): Promise<StaffBroadcastLog | null> {
  const row = await readModuleLocalState<unknown>(KEY);
  if (!row) return null;
  return row.state ? normalizeStaffBroadcastLog(row.state) : emptyStaffBroadcastLog();
}

/**
 * Append one live send. An unreadable log is left alone rather than
 * overwritten with this single entry (that would wipe everyone's history).
 */
export async function appendStaffBroadcast(entry: StaffBroadcastEntry): Promise<boolean> {
  const log = await readStaffBroadcastLog();
  if (!log) return false;
  const w = await writeModuleLocalState(KEY, withBroadcastEntry(log, entry));
  if (!w.ok) console.warn("[staff-broadcast] log write failed", w.error);
  return w.ok;
}
