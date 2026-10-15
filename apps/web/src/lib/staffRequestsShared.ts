/**
 * Staff → Requests: what the browser and the server agree on (15 Oct 2026).
 *
 * Every request is one element of the `staffRequests` list in
 * staff_hr_desk_slices, written one at a time through the write kernel
 * (desk_slice_row_write, base = the element's `_rev`) by
 * POST /api/staff/requests and read through GET /api/data/views/staff-requests
 * (lib/staffRequests.server.ts). The browser holds no copy of its own: the
 * query kernel's cache, refetched when erp_versions says staff_hr moved.
 */
import {
  normalizeStaffRequestTicket,
  type StaffRequestStatus,
  type StaffRequestTicket,
  type StaffRequestType,
} from "@/lib/staffHr";

/** A request as the server holds it, with the revision a change must name. */
export type StaffRequestRow = StaffRequestTicket & { rev: number };

export type StaffRequestsView = {
  /** Everyone's when `canManage`, else only the caller's own. */
  requests: StaffRequestRow[];
  /** May assign, change status and write the resolution (the Manage-leave people). */
  canManage: boolean;
  /** The caller's staff record, or null when the login has none. */
  selfStaffId: string | null;
};

export type StaffRequestTriage = {
  assignedToStaffId?: string;
  status?: StaffRequestStatus;
  resolutionNote?: string;
};

/** POST /api/staff/requests bodies. */
export type StaffRequestPost =
  | { op: "raise"; type: StaffRequestType; subject: string; description: string }
  | { op: "update"; id: string; base: number; patch: StaffRequestTriage };

export const STAFF_REQUESTS_VIEW_PATH = "/api/data/views/staff-requests";
export const STAFF_REQUESTS_WRITE_PATH = "/api/staff/requests";
/** The erp_versions key whose move means "requests may have changed". */
export const STAFF_REQUESTS_DESK = "staff_hr";

/** A stored element (or a view row) as a request with its revision; null for anything that is not one. */
export function staffRequestFromElement(raw: unknown): StaffRequestRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  const t = normalizeStaffRequestTicket(o as Partial<StaffRequestTicket>);
  if (!t) return null;
  // `_rev` on a stored element (the RPC owns it); `rev` once the view sent it.
  const r = typeof o._rev === "number" ? o._rev : o.rev;
  const rev = typeof r === "number" && r > 0 ? Math.floor(r) : 0;
  return { ...t, id: o.id, rev };
}

/** The view's answer, checked: a malformed body is a failed read, never an empty list. */
export function parseStaffRequestsView(data: unknown): StaffRequestsView {
  const d = data as Partial<StaffRequestsView> | null;
  if (!d || !Array.isArray(d.requests) || typeof d.canManage !== "boolean") {
    throw new Error("The requests answer was not understood");
  }
  return {
    requests: d.requests.map(staffRequestFromElement).filter((r): r is StaffRequestRow => !!r),
    canManage: d.canManage,
    selfStaffId: typeof d.selfStaffId === "string" && d.selfStaffId ? d.selfStaffId : null,
  };
}
