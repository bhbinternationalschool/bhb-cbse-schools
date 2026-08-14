/**
 * Complaints / grievance tickets — parent portal intake + staff triage.
 * Greenfield module. Automatic WhatsApp-bot ticket intake is out of scope
 * this round (would touch the shared bot webhook routing); office can log
 * a complaint that arrived by WA manually via `source: "whatsapp"`.
 *
 * createComplaintTicket mirrors lib/studentLeave.ts's
 * createStudentLeaveRequest — load/mutate/save internally, ok/error
 * return shape — since the parent portal calls it directly client-side
 * with no API route and no held-in-memory state slice.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type ComplaintCategory =
  | "academic"
  | "facilities"
  | "transport"
  | "fees"
  | "staff_behavior"
  | "safety"
  | "other";

export const COMPLAINT_CATEGORIES: { value: ComplaintCategory; label: string }[] = [
  { value: "academic", label: "Academic" },
  { value: "facilities", label: "Facilities" },
  { value: "transport", label: "Transport" },
  { value: "fees", label: "Fees" },
  { value: "staff_behavior", label: "Staff behavior" },
  { value: "safety", label: "Safety" },
  { value: "other", label: "Other" },
];

export type ComplaintStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";

export const COMPLAINT_STATUSES: { value: ComplaintStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export type ComplaintSource = "parent_portal" | "whatsapp" | "office";

export const COMPLAINT_SOURCES: { value: ComplaintSource; label: string }[] = [
  { value: "parent_portal", label: "Parent portal" },
  { value: "whatsapp", label: "WhatsApp (logged manually)" },
  { value: "office", label: "Office (walk-in / phone)" },
];

export type ComplaintTicket = {
  id: string;
  householdId: string;
  studentId: string | null;
  raisedByName: string;
  raisedByMobile: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
  date: string;
  assignedToStaffId: string | null;
  dueByDate: string | null;
  status: ComplaintStatus;
  resolutionNote: string;
  resolvedAt: string | null;
  source: ComplaintSource;
  createdAt: string;
  updatedAt: string;
};

export type ComplaintState = { version: 1; tickets: ComplaintTicket[] };

const STORAGE_KEY = "bhb_complaints_v1";
const CATEGORY_SET = new Set<ComplaintCategory>(COMPLAINT_CATEGORIES.map((c) => c.value));
const STATUS_SET = new Set<ComplaintStatus>(COMPLAINT_STATUSES.map((s) => s.value));
const SOURCE_SET = new Set<ComplaintSource>(COMPLAINT_SOURCES.map((s) => s.value));

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function complaintCategoryLabel(c: ComplaintCategory): string {
  return COMPLAINT_CATEGORIES.find((x) => x.value === c)?.label || c;
}

export function complaintStatusLabel(s: ComplaintStatus): string {
  return COMPLAINT_STATUSES.find((x) => x.value === s)?.label || s;
}

export function complaintSourceLabel(s: ComplaintSource): string {
  return COMPLAINT_SOURCES.find((x) => x.value === s)?.label || s;
}

function normalizeTicket(raw: Partial<ComplaintTicket> | null | undefined): ComplaintTicket | null {
  if (!raw?.householdId || !raw.subject) return null;
  const category = CATEGORY_SET.has(raw.category as ComplaintCategory) ? (raw.category as ComplaintCategory) : "other";
  const status = STATUS_SET.has(raw.status as ComplaintStatus) ? (raw.status as ComplaintStatus) : "open";
  const source = SOURCE_SET.has(raw.source as ComplaintSource) ? (raw.source as ComplaintSource) : "office";
  const now = nowIso();
  return {
    id: raw.id || nid("cplt"),
    householdId: raw.householdId,
    studentId: raw.studentId || null,
    raisedByName: String(raw.raisedByName || "").trim(),
    raisedByMobile: String(raw.raisedByMobile || "").trim(),
    category,
    subject: String(raw.subject).trim(),
    description: String(raw.description || "").trim(),
    date: (raw.date || now.slice(0, 10)).slice(0, 10),
    assignedToStaffId: raw.assignedToStaffId || null,
    dueByDate: raw.dueByDate || null,
    status,
    resolutionNote: String(raw.resolutionNote || "").trim(),
    resolvedAt: raw.resolvedAt || null,
    source,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function emptyComplaintState(): ComplaintState {
  return { version: 1, tickets: [] };
}

export function normalizeComplaintState(raw: unknown): ComplaintState {
  if (!raw || typeof raw !== "object") return emptyComplaintState();
  const r = raw as Partial<ComplaintState>;
  return {
    version: 1,
    tickets: Array.isArray(r.tickets)
      ? r.tickets.map((t) => normalizeTicket(t as Partial<ComplaintTicket>)).filter((x): x is ComplaintTicket => !!x)
      : [],
  };
}

export function loadComplaints(): ComplaintState {
  if (typeof window === "undefined") return emptyComplaintState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyComplaintState();
    return normalizeComplaintState(JSON.parse(raw));
  } catch {
    return emptyComplaintState();
  }
}

export function saveComplaints(state: ComplaintState): void {
  if (!assertModulePermission("complaints", "edit", "saveComplaints")) return;
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeComplaintState(state)));
    window.dispatchEvent(new CustomEvent("bhb-complaints"));
  } catch (e) {
    console.warn("[complaints] localStorage quota exceeded", e);
  }
}

/** Parent-portal entry point — mirrors createStudentLeaveRequest's
 * load/mutate/save-internally, ok/error shape. No API route: the parent
 * portal has no held-in-memory ComplaintState to round-trip. */
export function createComplaintTicket(input: {
  householdId: string;
  studentId?: string | null;
  raisedByName: string;
  raisedByMobile: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
  source?: ComplaintSource;
}): { ok: true; ticket: ComplaintTicket } | { ok: false; error: string } {
  if (!input.householdId) return { ok: false, error: "Missing household" };
  if (!input.subject.trim()) return { ok: false, error: "Subject required" };
  if (!input.description.trim()) return { ok: false, error: "Description required" };
  const state = loadComplaints();
  const ticket: ComplaintTicket = {
    id: nid("cplt"),
    householdId: input.householdId,
    studentId: input.studentId || null,
    raisedByName: input.raisedByName.trim(),
    raisedByMobile: input.raisedByMobile.trim(),
    category: input.category,
    subject: input.subject.trim(),
    description: input.description.trim(),
    date: nowIso().slice(0, 10),
    assignedToStaffId: null,
    dueByDate: null,
    status: "open",
    resolutionNote: "",
    resolvedAt: null,
    source: input.source || "parent_portal",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveComplaints({ ...state, tickets: [ticket, ...state.tickets] });
  return { ok: true, ticket };
}

export function assignTicket(state: ComplaintState, id: string, staffId: string): ComplaintState {
  const next: ComplaintState = {
    ...state,
    tickets: state.tickets.map((t) =>
      t.id === id
        ? { ...t, assignedToStaffId: staffId, status: t.status === "open" ? "assigned" : t.status, updatedAt: nowIso() }
        : t,
    ),
  };
  saveComplaints(next);
  return next;
}

export function setTicketStatus(state: ComplaintState, id: string, status: ComplaintStatus): ComplaintState {
  const next: ComplaintState = {
    ...state,
    tickets: state.tickets.map((t) => (t.id === id ? { ...t, status, updatedAt: nowIso() } : t)),
  };
  saveComplaints(next);
  return next;
}

export function resolveTicket(state: ComplaintState, id: string, resolutionNote: string): ComplaintState {
  const now = nowIso();
  const next: ComplaintState = {
    ...state,
    tickets: state.tickets.map((t) =>
      t.id === id ? { ...t, status: "resolved", resolutionNote: resolutionNote.trim(), resolvedAt: now, updatedAt: now } : t,
    ),
  };
  saveComplaints(next);
  return next;
}

export function deleteTicket(state: ComplaintState, id: string): ComplaintState {
  const next: ComplaintState = { ...state, tickets: state.tickets.filter((t) => t.id !== id) };
  saveComplaints(next);
  return next;
}

export function listTicketsForHousehold(state: ComplaintState, householdId: string): ComplaintTicket[] {
  return state.tickets
    .filter((t) => t.householdId === householdId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
