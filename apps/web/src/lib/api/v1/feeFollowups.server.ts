import "server-only";

import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";
import type {
  FeeRecoveryMeeting,
  FeeRecoveryMeetingStatus,
  FeeRecoveryTasksState,
} from "@/lib/feeRecoveryTasks";

/**
 * Fee-recovery follow-ups, read and written straight from the desk slice.
 *
 * lib/feeRecoveryTasks.ts is localStorage-first — on the server its load
 * returns an empty state and its save is a no-op — so the phone talks to
 * the same `fee_recovery_tasks_desk_slices` rows the Fees desk reads,
 * rather than through a browser cache that isn't there.
 */
export async function loadFeeFollowups(): Promise<FeeRecoveryTasksState> {
  const read = await fetchDeskSliceFromDb("fee_recovery_tasks");
  if (!read.ok) {
    throw new Error(read.error || "Could not read fee follow-ups");
  }
  const meetings = Array.isArray(read.bundle.meetings)
    ? (read.bundle.meetings as FeeRecoveryMeeting[])
    : [];
  return { version: 1, meetings };
}

export async function saveFeeFollowups(
  state: FeeRecoveryTasksState,
): Promise<{ ok: boolean; error?: string }> {
  return pushDeskSliceToDb("fee_recovery_tasks", {
    ...state,
    version: 1,
  } as FeeRecoveryTasksState & Record<string, unknown>);
}

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export type LogFollowupInput = {
  studentId: string;
  householdId: string;
  studentName: string;
  classLabel: string;
  admissionNo: string;
  amountPaise: number;
  overdueDays: number;
  mobile: string;
  /** call | whatsapp | visit — what the collector actually did. */
  channel: string;
  /** Free text: what the family said. */
  note: string;
  /** YYYY-MM-DD the family promised to pay, or the next attempt. */
  promisedOn: string;
  status: FeeRecoveryMeetingStatus;
  by: string;
};

/**
 * Record one contact attempt against a defaulting family. Replaces this
 * student's open follow-up rather than stacking rows, so the desk's list
 * stays one line per family — the collector calls the same number twice a
 * week and only the latest promise matters.
 */
export async function logFeeFollowup(
  input: LogFollowupInput,
): Promise<{ ok: true; meeting: FeeRecoveryMeeting } | { ok: false; error: string }> {
  const state = await loadFeeFollowups();
  const now = new Date().toISOString();
  const meeting: FeeRecoveryMeeting = {
    id: nid("frm"),
    studentId: input.studentId,
    householdId: input.householdId,
    studentName: input.studentName,
    classLabel: input.classLabel,
    admissionNo: input.admissionNo,
    amountPaise: input.amountPaise,
    overdueDays: input.overdueDays,
    scheduledOn: input.promisedOn,
    note: `${input.channel}: ${input.note}`.trim().slice(0, 400),
    status: input.status,
    createdAt: now,
    createdBy: input.by,
    mobile: input.mobile,
  };
  const kept = state.meetings.filter(
    (m) => !(m.studentId === input.studentId && m.status === "scheduled"),
  );
  const next: FeeRecoveryTasksState = {
    version: 1,
    meetings: [meeting, ...kept].slice(0, 2000),
  };
  const saved = await saveFeeFollowups(next);
  if (!saved.ok) return { ok: false, error: saved.error || "Could not save" };
  return { ok: true, meeting };
}
