/**
 * Fee recovery parent-meeting tasks (defaulters playbook).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_fee_recovery_tasks_v1";

export type FeeRecoveryMeetingStatus =
  | "scheduled"
  | "done"
  | "cancelled"
  | "no_show";

export type FeeRecoveryMeeting = {
  id: string;
  studentId: string;
  householdId: string;
  studentName: string;
  classLabel: string;
  admissionNo: string;
  amountPaise: number;
  overdueDays: number;
  scheduledOn: string;
  note: string;
  status: FeeRecoveryMeetingStatus;
  createdAt: string;
  createdBy: string;
  mobile: string;
};

export type FeeRecoveryTasksState = {
  version: 1;
  meetings: FeeRecoveryMeeting[];
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function emptyFeeRecoveryTasks(): FeeRecoveryTasksState {
  return { version: 1, meetings: [] };
}

export function loadFeeRecoveryTasks(): FeeRecoveryTasksState {
  if (typeof window === "undefined") return emptyFeeRecoveryTasks();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyFeeRecoveryTasks();
    const parsed = JSON.parse(raw) as Partial<FeeRecoveryTasksState>;
    return {
      version: 1,
      meetings: Array.isArray(parsed.meetings) ? parsed.meetings : [],
    };
  } catch {
    return emptyFeeRecoveryTasks();
  }
}

export function writeFeeRecoveryTasksLocalRaw(
  state: FeeRecoveryTasksState,
): void {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function feeRecoveryTasksIsEmpty(state: FeeRecoveryTasksState): boolean {
  return (state.meetings?.length ?? 0) === 0;
}

export function saveFeeRecoveryTasks(state: FeeRecoveryTasksState): void {
  if (!assertModulePermission("fees", "edit", "saveFeeRecoveryTasks")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/feeRecoveryTasksPersistence").then((m) => {
    m.scheduleFeeRecoveryTasksSync(state);
  });
}

export {
  scheduleFeeRecoveryTasksSync,
  ensureFeeRecoveryTasksHydrated,
} from "@/lib/feeRecoveryTasksPersistence";

export function scheduleParentMeeting(input: {
  studentId: string;
  householdId: string;
  studentName: string;
  classLabel: string;
  admissionNo: string;
  amountPaise: number;
  overdueDays: number;
  mobile?: string;
  scheduledOn?: string;
  note?: string;
  createdBy: string;
}):
  | { ok: true; meeting: FeeRecoveryMeeting; state: FeeRecoveryTasksState }
  | { ok: false; error: string } {
  if (!assertModulePermission("fees", "create", "scheduleParentMeeting")) {
    return { ok: false, error: "No permission to schedule meetings" };
  }
  const state = loadFeeRecoveryTasks();
  const open = state.meetings.find(
    (m) =>
      m.studentId === input.studentId &&
      m.status === "scheduled" &&
      m.scheduledOn >= todayPlus(0),
  );
  if (open) {
    return {
      ok: false,
      error: `Meeting already scheduled for ${open.scheduledOn}`,
    };
  }
  const meeting: FeeRecoveryMeeting = {
    id: nid("frm"),
    studentId: input.studentId,
    householdId: input.householdId,
    studentName: input.studentName,
    classLabel: input.classLabel,
    admissionNo: input.admissionNo,
    amountPaise: input.amountPaise,
    overdueDays: input.overdueDays,
    scheduledOn: input.scheduledOn || todayPlus(2),
    note: input.note?.trim() || "Fee recovery parent meeting",
    status: "scheduled",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy || "office",
    mobile: (input.mobile || "").replace(/\D/g, "").slice(-10),
  };
  const next = {
    version: 1 as const,
    meetings: [meeting, ...state.meetings],
  };
  saveFeeRecoveryTasks(next);
  return { ok: true, meeting, state: next };
}

export function setParentMeetingStatus(
  meetingId: string,
  status: FeeRecoveryMeetingStatus,
): FeeRecoveryTasksState {
  const state = loadFeeRecoveryTasks();
  const next = {
    ...state,
    meetings: state.meetings.map((m) =>
      m.id === meetingId ? { ...m, status } : m,
    ),
  };
  saveFeeRecoveryTasks(next);
  return next;
}

export function listOpenParentMeetings(
  state?: FeeRecoveryTasksState,
): FeeRecoveryMeeting[] {
  const s = state ?? loadFeeRecoveryTasks();
  return s.meetings
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn));
}

export function composeParentMeetingInvite(m: FeeRecoveryMeeting): string {
  return [
    `*${TENANT.nameDisplay}*`,
    `Fee recovery meeting`,
    "",
    `Student: ${m.studentName}${m.classLabel ? ` (${m.classLabel})` : ""}`,
    m.admissionNo ? `Adm no: ${m.admissionNo}` : "",
    `Overdue: *${formatInr(m.amountPaise)}* · ${m.overdueDays} day(s)`,
    `Please meet office on *${m.scheduledOn}*`,
    m.note ? `\n${m.note}` : "",
    "",
    "Please confirm attendance. Thank you.",
  ]
    .filter(Boolean)
    .join("\n");
}
