/**
 * Visitor register + early-pickup gate passes.
 * Greenfield module — nothing in this codebase previously tracked a front
 * gate log. "Gate duty today" reads lib/dutyRoster.ts's existing "gate"
 * duty type read-only; it doesn't duplicate that data.
 *
 * Storage: localStorage only, same scope limit as lib/health.ts and
 * lib/discipline.ts. saveVisitors carries the real assertModulePermission
 * guard lib/dutyRoster.ts's saveDutyRoster is missing.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { householdOf, householdWhatsApp, type SisState } from "@/lib/sis";
import { listAssignmentsForDate, type DutyRosterState } from "@/lib/dutyRoster";

export type VisitorPurpose =
  | "admission"
  | "meeting"
  | "vendor"
  | "delivery"
  | "job_interview"
  | "other";

export const VISITOR_PURPOSES: { value: VisitorPurpose; label: string }[] = [
  { value: "admission", label: "Admission enquiry" },
  { value: "meeting", label: "Meeting a staff member" },
  { value: "vendor", label: "Vendor / supplier" },
  { value: "delivery", label: "Delivery" },
  { value: "job_interview", label: "Job interview" },
  { value: "other", label: "Other" },
];

export type VisitorEntry = {
  id: string;
  visitorName: string;
  mobile: string;
  purpose: VisitorPurpose;
  personToMeet: string;
  /** ISO timestamp */
  inTime: string;
  /** ISO timestamp, null while still on campus */
  outTime: string | null;
  idProofNote: string;
  qrPayload: string;
  createdBy: string;
  createdAt: string;
};

export type GatePassStatus = "requested" | "approved" | "picked_up" | "cancelled";

export const GATE_PASS_STATUSES: { value: GatePassStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "picked_up", label: "Picked up" },
  { value: "cancelled", label: "Cancelled" },
];

export type GatePass = {
  id: string;
  studentId: string;
  academicYearCode: string;
  date: string;
  requestedPickupTime: string;
  reason: string;
  requestedByStaffId: string;
  status: GatePassStatus;
  pickedUpByName: string;
  actualPickupTime: string | null;
  notifiedParentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisitorState = {
  version: 1;
  visitorLog: VisitorEntry[];
  gatePasses: GatePass[];
};

const STORAGE_KEY = "bhb_visitors_v1";
const PURPOSE_SET = new Set<VisitorPurpose>(VISITOR_PURPOSES.map((p) => p.value));
const STATUS_SET = new Set<GatePassStatus>(GATE_PASS_STATUSES.map((s) => s.value));

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function visitorPurposeLabel(p: VisitorPurpose): string {
  return VISITOR_PURPOSES.find((x) => x.value === p)?.label || p;
}

export function gatePassStatusLabel(s: GatePassStatus): string {
  return GATE_PASS_STATUSES.find((x) => x.value === s)?.label || s;
}

/** Mirrors staffQrPayload's JSON shape ({type,...,id}) — foundationMasters.ts:922. */
export function visitorQrPayload(id: string, visitorName: string): string {
  return JSON.stringify({ type: "bhb_visitor", visitorName: visitorName.trim(), id });
}

function normalizeVisitorEntry(raw: Partial<VisitorEntry> | null | undefined): VisitorEntry | null {
  if (!raw?.visitorName || !raw.inTime) return null;
  const purpose = PURPOSE_SET.has(raw.purpose as VisitorPurpose) ? (raw.purpose as VisitorPurpose) : "other";
  const id = raw.id || nid("visit");
  return {
    id,
    visitorName: String(raw.visitorName).trim(),
    mobile: String(raw.mobile || "").trim(),
    purpose,
    personToMeet: String(raw.personToMeet || "").trim(),
    inTime: raw.inTime,
    outTime: raw.outTime || null,
    idProofNote: String(raw.idProofNote || "").trim(),
    qrPayload: raw.qrPayload || visitorQrPayload(id, raw.visitorName),
    createdBy: raw.createdBy || "",
    createdAt: raw.createdAt || nowIso(),
  };
}

function normalizeGatePass(raw: Partial<GatePass> | null | undefined): GatePass | null {
  if (!raw?.studentId || !raw.date) return null;
  const status = STATUS_SET.has(raw.status as GatePassStatus) ? (raw.status as GatePassStatus) : "requested";
  const now = nowIso();
  return {
    id: raw.id || nid("gpass"),
    studentId: raw.studentId,
    academicYearCode: raw.academicYearCode || "",
    date: raw.date.slice(0, 10),
    requestedPickupTime: raw.requestedPickupTime || "",
    reason: String(raw.reason || "").trim(),
    requestedByStaffId: raw.requestedByStaffId || "",
    status,
    pickedUpByName: String(raw.pickedUpByName || "").trim(),
    actualPickupTime: raw.actualPickupTime || null,
    notifiedParentAt: raw.notifiedParentAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function emptyVisitorState(): VisitorState {
  return { version: 1, visitorLog: [], gatePasses: [] };
}

export function normalizeVisitorState(raw: unknown): VisitorState {
  if (!raw || typeof raw !== "object") return emptyVisitorState();
  const r = raw as Partial<VisitorState>;
  return {
    version: 1,
    visitorLog: Array.isArray(r.visitorLog)
      ? r.visitorLog.map((v) => normalizeVisitorEntry(v as Partial<VisitorEntry>)).filter((x): x is VisitorEntry => !!x)
      : [],
    gatePasses: Array.isArray(r.gatePasses)
      ? r.gatePasses.map((g) => normalizeGatePass(g as Partial<GatePass>)).filter((x): x is GatePass => !!x)
      : [],
  };
}

export function loadVisitors(): VisitorState {
  if (typeof window === "undefined") return emptyVisitorState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyVisitorState();
    return normalizeVisitorState(JSON.parse(raw));
  } catch {
    return emptyVisitorState();
  }
}

export function saveVisitors(state: VisitorState): VisitorState {
  if (!assertModulePermission("visitors", "edit", "saveVisitors")) {
    return state;
  }
  const next = normalizeVisitorState(state);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("bhb-visitors"));
  }
  return next;
}

export function checkInVisitor(
  state: VisitorState,
  input: Partial<VisitorEntry> & { visitorName: string },
): { state: VisitorState; entry: VisitorEntry } {
  const entry = normalizeVisitorEntry({ ...input, inTime: input.inTime || nowIso() })!;
  return { state: { ...state, visitorLog: [entry, ...state.visitorLog] }, entry };
}

export function checkOutVisitor(state: VisitorState, id: string): VisitorState {
  return saveVisitors({
    ...state,
    visitorLog: state.visitorLog.map((v) => (v.id === id ? { ...v, outTime: nowIso() } : v)),
  });
}

export function deleteVisitorEntry(state: VisitorState, id: string): VisitorState {
  return saveVisitors({ ...state, visitorLog: state.visitorLog.filter((v) => v.id !== id) });
}

export function upsertGatePass(
  state: VisitorState,
  input: Partial<GatePass> & { studentId: string; date: string },
): { state: VisitorState; pass: GatePass } {
  const existing = input.id ? state.gatePasses.find((g) => g.id === input.id) : undefined;
  const pass = normalizeGatePass({ ...existing, ...input, id: existing?.id || input.id, createdAt: existing?.createdAt })!;
  const gatePasses = existing
    ? state.gatePasses.map((g) => (g.id === pass.id ? pass : g))
    : [pass, ...state.gatePasses];
  return { state: { ...state, gatePasses }, pass };
}

export function markGatePassPickedUp(
  state: VisitorState,
  id: string,
  pickedUpByName: string,
): VisitorState {
  return saveVisitors({
    ...state,
    gatePasses: state.gatePasses.map((g) =>
      g.id === id
        ? { ...g, status: "picked_up", pickedUpByName, actualPickupTime: nowIso(), updatedAt: nowIso() }
        : g,
    ),
  });
}

export function deleteGatePass(state: VisitorState, id: string): VisitorState {
  return saveVisitors({ ...state, gatePasses: state.gatePasses.filter((g) => g.id !== id) });
}

/** Read-only wrapper over lib/dutyRoster.ts's "gate" duty assignments — not a duplicate store. */
export function onGateDutyNow(dutyRoster: DutyRosterState, date: string) {
  return listAssignmentsForDate(dutyRoster, date).filter((a) => a.dutyType === "gate");
}

/** WA parent notify for a gate pass — mirrors lib/discipline.ts's notifyDisciplineParent shape. */
export async function notifyGatePassParent(
  pass: GatePass,
  sis: SisState,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const student = sis.students.find((s) => s.id === pass.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const household = householdOf(sis, student.householdId);
  const mobile = householdWhatsApp(household);
  if (!mobile) return { ok: false, error: "No WhatsApp number on file" };
  const body =
    `Gate pass for ${student.fullName}: early pickup requested on ${pass.date}` +
    `${pass.requestedPickupTime ? ` at ${pass.requestedPickupTime}` : ""}. Reason: ${pass.reason}.`;
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "visitors",
        dryRun: !!opts?.dryRun,
        messages: [{ mobile, body }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
