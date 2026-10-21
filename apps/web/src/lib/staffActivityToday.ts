/**
 * "Staff today" as a list of what each member of staff DID today (approved
 * request mr_mva0mcxt0c3h, 20 Oct 2026: "show staff activities instead of
 * attendance logs").
 *
 * Nothing new is recorded for this. It reads what the ERP already keeps:
 *   - the staff register (punch in / out times),
 *   - the student registers (who marked which section),
 *   - homework posts (by teacher id),
 *   - fee receipts (by cashier name),
 *   - the audit log, for the work that lives nowhere else (marks entered,
 *     leave decided, class sheet updated, …) — matched to staff by the
 *     actor's name, as "My collections" matches a cashier.
 *
 * Kinds that have a desk of their own are taken from the desk, and the same
 * kind is never also taken from the audit log, so nothing counts twice.
 */

export type StaffActivityKind =
  | "punch_in"
  | "punch_out"
  | "attendance_register"
  | "homework"
  | "fee_receipts"
  | "marks"
  | "co_scholastic"
  | "class_sheet"
  | "student_records"
  | "receipt_edit"
  | "leave_applied"
  | "staff_leave_decided"
  | "student_leave_decided"
  | "profile";

export type StaffActivityEvent = {
  /** Either the staff id, or the actor's name to match against the roster. */
  staffId?: string;
  actorName?: string;
  kind: StaffActivityKind;
  /** ISO timestamp, or HH:mm already in school time. */
  at: string;
  /** Students, paise — whatever the kind counts. */
  qty?: number;
  /** A short human detail (section, homework title). */
  detail?: string;
};

export type StaffActivityItem = {
  kind: StaffActivityKind;
  /** How many events of this kind. */
  count: number;
  qty: number;
  /** HH:mm (school time) of the first and the latest. */
  firstAt: string;
  lastAt: string;
  details: string[];
};

export type StaffActivityRow = {
  staffId: string;
  fullName: string;
  designation: string;
  items: StaffActivityItem[];
};

/** HH:mm in India time for an ISO timestamp; HH:mm passes through. */
export function schoolClock(at: string): string {
  if (/^\d{1,2}:\d{2}$/.test(at)) return at.padStart(5, "0");
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 330 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** YYYY-MM-DD in India time for an ISO timestamp. */
export function schoolDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The order the kinds are listed in for one person. */
const KIND_ORDER: StaffActivityKind[] = [
  "punch_in",
  "attendance_register",
  "homework",
  "marks",
  "co_scholastic",
  "class_sheet",
  "student_records",
  "fee_receipts",
  "receipt_edit",
  "student_leave_decided",
  "staff_leave_decided",
  "leave_applied",
  "profile",
  "punch_out",
];

/**
 * Map one audit row to an activity, or null for anything this view does not
 * show (including kinds a desk already supplies — punches, registers,
 * homework posts, new receipts).
 */
export function auditActivity(row: {
  module: string;
  action: string;
  entityType: string;
  summary: string;
}): { kind: StaffActivityKind; qty?: number } | null {
  const { module, action, entityType, summary } = row;
  if (module === "exams" && action === "edit" && entityType === "mark_sheet") {
    const m = /(\d+)\s+students?/i.exec(summary);
    return { kind: "marks", qty: m ? Number(m[1]) : 0 };
  }
  if (module === "exams" && action === "create" && entityType === "co_scholastic_rating") {
    return { kind: "co_scholastic", qty: 1 };
  }
  if (module === "students" && action === "edit") {
    return /^class sheet/i.test(summary) ? { kind: "class_sheet" } : { kind: "student_records" };
  }
  if (module === "fees" && action === "update" && entityType === "collection_voucher") {
    return { kind: "receipt_edit" };
  }
  if (module === "staff" && entityType === "staff_leave" && /^leave applied/i.test(summary)) {
    return { kind: "leave_applied" };
  }
  if (module === "staff" && action === "approve") return { kind: "staff_leave_decided" };
  if (module === "student_leave" && action === "approve") return { kind: "student_leave_decided" };
  if (module === "staff" && action === "edit" && entityType === "staff" && /from the staff app/i.test(summary)) {
    return { kind: "profile" };
  }
  return null;
}

export function buildStaffActivityToday(input: {
  staff: { id: string; fullName: string; status: string; designationId?: string | null }[];
  designations: { id: string; name: string }[];
  events: StaffActivityEvent[];
}): { rows: StaffActivityRow[]; unmatched: number } {
  const active = input.staff.filter((s) => s.status === "active");
  const byId = new Map(active.map((s) => [s.id, s]));
  // A name two people share cannot say who did it: such events are not
  // given to either of them.
  const byName = new Map<string, string | null>();
  for (const s of active) {
    const k = normName(s.fullName);
    byName.set(k, byName.has(k) ? null : s.id);
  }
  const desig = (id: string | null | undefined) =>
    input.designations.find((d) => d.id === id)?.name || "";

  const per = new Map<string, Map<StaffActivityKind, StaffActivityItem>>();
  let unmatched = 0;
  for (const e of input.events) {
    const id =
      e.staffId && byId.has(e.staffId)
        ? e.staffId
        : e.actorName
          ? byName.get(normName(e.actorName)) ?? null
          : null;
    if (!id) {
      unmatched += 1;
      continue;
    }
    const at = schoolClock(e.at);
    const kinds = per.get(id) ?? new Map<StaffActivityKind, StaffActivityItem>();
    const item = kinds.get(e.kind) ?? { kind: e.kind, count: 0, qty: 0, firstAt: at, lastAt: at, details: [] };
    item.count += 1;
    item.qty += e.qty ?? 0;
    if (at && (!item.firstAt || at < item.firstAt)) item.firstAt = at;
    if (at && at > item.lastAt) item.lastAt = at;
    const d = (e.detail || "").trim();
    if (d && !item.details.includes(d) && item.details.length < 5) item.details.push(d);
    kinds.set(e.kind, item);
    per.set(id, kinds);
  }

  const rows = active
    .map((s) => ({
      staffId: s.id,
      fullName: s.fullName,
      designation: desig(s.designationId),
      items: [...(per.get(s.id)?.values() ?? [])].sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
      ),
    }))
    // Who did the most first; nobody-did-anything at the end, by name.
    .sort((a, b) => workCount(b) - workCount(a) || a.fullName.localeCompare(b.fullName));
  return { rows, unmatched };
}

/** Activities other than the punch itself. */
function workCount(r: StaffActivityRow): number {
  return r.items.filter((i) => i.kind !== "punch_in" && i.kind !== "punch_out").reduce((n, i) => n + i.count, 0);
}
