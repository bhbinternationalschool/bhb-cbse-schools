/**
 * Staff → Requests on the server (15 Oct 2026).
 *
 * Until now a request lived only in the browser that raised it: staff HR
 * reads from the desk (STAFF_HR_READ_FROM_DB), `staffRequests` was not a desk
 * slice, so the whole-desk push never carried it and the old staff_hr_state
 * blob (the only place it was ever saved) has not been written since 5 Aug.
 * An approver on any other device never saw one.
 *
 * Now each request is one element of `staffRequests` in staff_hr_desk_slices:
 *   GET  /api/data/views/staff-requests  → staffRequestsViewGet
 *        any member of staff; a manager (canManageStaffLeave, with the saved
 *        roles) gets every request, anyone else only their own. Read through
 *        a referenceCache keyed on erp_versions `staff_hr`; `versions` = what
 *        the copy was built from, so the browser's versions poll refetches it
 *        when another device writes.
 *   POST /api/staff/requests             → staffRequestsPost
 *        raise      — any member of staff with a staff record, for themselves;
 *                     the server builds the ticket (id, dates, status open)
 *        update     — managers only: assign / status / resolution, with the
 *                     element `_rev` the screen loaded as the base (a stale
 *                     base = 409 and the stored request)
 *   Every write is one desk_slice_row_write call (data-layer 1.5): row lock,
 *   `_rev`, staff_hr_desk_sync_meta bumped in the same transaction. No
 *   whole-desk push. A failure is an error status — never "saved".
 *
 * Dependencies are injected (staffRequestsDeps.server.ts has the real ones)
 * so the self-test drives the handlers without a database.
 */
import { NextResponse } from "next/server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RouteAuthResult } from "@/lib/apiRouteAuth.server";
import { asRevision, type WriteOp, type WriteResult } from "@/lib/data/types";
import type { BuiltFrom, CacheRead } from "@/lib/data/server/referenceCache";
import {
  STAFF_REQUEST_TYPE_LABELS,
  type StaffRequestStatus,
  type StaffRequestTicket,
  type StaffRequestType,
} from "@/lib/staffHr";
import { canManageStaffLeave, resolveSessionStaff } from "@/lib/staffResolve";
import {
  staffRequestFromElement,
  type StaffRequestRow,
  type StaffRequestTriage,
  type StaffRequestsView,
} from "@/lib/staffRequestsShared";

export type StaffRequestsDeps = {
  /** Any member of staff (requireStaffApi). */
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
  mirrorSecret: (req: Request) => boolean;
  /** Every stored request (the referenceCache over the slice). */
  readRequests: () => Promise<CacheRead<StaffRequestRow[]>>;
  /** One element through desk_slice_row_write (repo.writeSliceElement). */
  write: (op: WriteOp<Record<string, unknown>>) => Promise<WriteResult<Record<string, unknown>>>;
  /** Drop the cached copy after this process wrote. */
  invalidate: () => void;
  now: () => Date;
  newId: () => string;
};

const NO_STORE = { "Cache-Control": "private, no-store" };
const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 4000;
const NOTE_MAX = 2000;
const TYPES = Object.keys(STAFF_REQUEST_TYPE_LABELS) as StaffRequestType[];
const STATUSES: StaffRequestStatus[] = ["open", "in_progress", "resolved", "closed"];

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
}

async function refusal(r: { response: Response }): Promise<Response> {
  const status = r.response.status;
  const body = (await r.response.json().catch(() => null)) as { error?: unknown } | null;
  return fail(status, typeof body?.error === "string" ? body.error : status === 401 ? "Unauthorized" : "Forbidden");
}

const MIRROR_REFUSED = "Staff requests are for signed-in staff.";
const UNREADABLE = "Could not load staff requests — please try again.";

type Who = { ctx: ApiAuthContext; canManage: boolean; selfStaffId: string | null; selfName: string };

async function who(req: Request, deps: StaffRequestsDeps): Promise<{ ok: true; who: Who } | { ok: false; res: Response }> {
  if (deps.mirrorSecret(req)) return { ok: false, res: fail(403, MIRROR_REFUSED) };
  const staff = await deps.requireStaff(req);
  if (!staff.ok) return { ok: false, res: await refusal(staff) };
  if (staff.viaMirrorSecret) return { ok: false, res: fail(403, MIRROR_REFUSED) };
  const ctx = staff.ctx;
  const self = resolveSessionStaff(ctx.session, ctx.masters);
  return {
    ok: true,
    who: {
      ctx,
      canManage: canManageStaffLeave(ctx.session, ctx.masters, ctx.rbac),
      selfStaffId: self?.id ?? null,
      selfName: self?.fullName || ctx.session.fullName || "",
    },
  };
}

/** What one caller may see. */
export function staffRequestsViewFor(all: readonly StaffRequestRow[], w: { canManage: boolean; selfStaffId: string | null }): StaffRequestsView {
  const mine = w.canManage ? [...all] : all.filter((r) => !!w.selfStaffId && r.staffId === w.selfStaffId);
  mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { requests: mine, canManage: w.canManage, selfStaffId: w.selfStaffId };
}

export async function staffRequestsViewGet(req: Request, deps: StaffRequestsDeps): Promise<Response> {
  const w = await who(req, deps);
  if (!w.ok) return w.res;
  const read = await deps.readRequests();
  if (!read.ok) return fail(503, UNREADABLE);
  return NextResponse.json(
    {
      ok: true,
      data: staffRequestsViewFor(read.value, w.who),
      versions: read.stale ? null : (read.builtFrom as BuiltFrom | null),
      stale: read.stale,
    },
    { headers: NO_STORE },
  );
}

/** The stored slice as requests (a missing slice = none: the list was never written). */
export function staffRequestsOfSlice(payload: unknown): StaffRequestRow[] {
  if (payload == null) return [];
  if (!Array.isArray(payload)) throw new Error("staff_hr.staffRequests is not a list");
  return payload.map(staffRequestFromElement).filter((r): r is StaffRequestRow => !!r);
}

/** The element written for a new request — the server decides every field but the words. */
export function raisedTicket(
  input: { type: unknown; subject: unknown; description: unknown },
  staff: { id: string; name: string },
  now: Date,
  id: string,
): { ok: true; ticket: StaffRequestTicket } | { ok: false; error: string } {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!subject) return { ok: false, error: "Subject is required" };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `Subject is longer than ${SUBJECT_MAX} characters` };
  if (description.length > DESCRIPTION_MAX) return { ok: false, error: `Details are longer than ${DESCRIPTION_MAX} characters` };
  const type = TYPES.includes(input.type as StaffRequestType) ? (input.type as StaffRequestType) : null;
  if (!type) return { ok: false, error: "Unknown request type" };
  const iso = now.toISOString();
  return {
    ok: true,
    ticket: {
      id,
      staffId: staff.id,
      raisedByName: staff.name.trim(),
      type,
      subject,
      description,
      date: iso.slice(0, 10),
      assignedToStaffId: "",
      status: "open",
      resolutionNote: "",
      resolvedAt: null,
      createdAt: iso,
      updatedAt: iso,
    },
  };
}

/** The fields a triage changes, from the stored request (resolvedAt as the old screen kept it). */
export function triagePatch(
  stored: StaffRequestTicket,
  patch: StaffRequestTriage,
  now: Date,
): { ok: true; row: Partial<StaffRequestTicket> } | { ok: false; error: string } {
  const row: Partial<StaffRequestTicket> = {};
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) return { ok: false, error: "Unknown status" };
    row.status = patch.status;
  }
  if (patch.assignedToStaffId !== undefined) {
    if (typeof patch.assignedToStaffId !== "string") return { ok: false, error: "Bad assignee" };
    row.assignedToStaffId = patch.assignedToStaffId;
  }
  if (patch.resolutionNote !== undefined) {
    if (typeof patch.resolutionNote !== "string") return { ok: false, error: "Bad resolution note" };
    if (patch.resolutionNote.length > NOTE_MAX) return { ok: false, error: `Resolution note is longer than ${NOTE_MAX} characters` };
    row.resolutionNote = patch.resolutionNote.trim();
  }
  if (Object.keys(row).length === 0) return { ok: false, error: "Nothing to change" };
  const iso = now.toISOString();
  const status = row.status ?? stored.status;
  row.resolvedAt =
    status === "resolved" || status === "closed"
      ? stored.resolvedAt || iso
      : status !== stored.status
        ? null
        : stored.resolvedAt;
  row.updatedAt = iso;
  return { ok: true, row };
}

function writeFailure(r: Extract<WriteResult<Record<string, unknown>>, { ok: false }>): Response {
  if (r.kind === "conflict") {
    const c = r.conflicts.find((x) => x.status === "conflict");
    const stored = c && c.status === "conflict" ? staffRequestFromElement(c.stored) : null;
    return fail(409, "This request was changed on another device — the screen now shows its latest state. Nothing was saved.", {
      reason: (c && c.status === "conflict" ? c.reason : undefined) ?? "stale",
      stored,
    });
  }
  const status = r.kind === "auth" ? 403 : r.kind === "invalid" ? 400 : r.kind === "not_found" ? 404 : 503;
  return fail(status, `Not saved — ${r.message}`);
}

/** The saved element's revision from a write result. */
function savedRev(r: Extract<WriteResult<Record<string, unknown>>, { ok: true }>): number {
  const n = Number(r.results[0]?.revision ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function staffRequestsPost(req: Request, deps: StaffRequestsDeps): Promise<Response> {
  const w = await who(req, deps);
  if (!w.ok) return w.res;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object") return fail(400, "Invalid body");
  const { canManage, selfStaffId, selfName, ctx } = w.who;
  const roster = ctx.masters.staff ?? [];

  if (body.op === "raise") {
    if (!selfStaffId) return fail(403, "Your login is not linked to a staff record, so a request cannot be filed for you.");
    const built = raisedTicket(
      { type: body.type, subject: body.subject, description: body.description },
      { id: selfStaffId, name: selfName },
      deps.now(),
      deps.newId(),
    );
    if (!built.ok) return fail(400, built.error);
    const r = await deps.write({ op: "upsert", id: built.ticket.id, base: null, row: built.ticket as unknown as Record<string, unknown> });
    if (!r.ok) return writeFailure(r);
    deps.invalidate();
    return NextResponse.json({ ok: true, request: { ...built.ticket, rev: savedRev(r) } }, { headers: NO_STORE });
  }

  if (body.op === "update") {
    if (!canManage) return fail(403, "Only the people who manage staff requests can assign or resolve them.");
    const id = typeof body.id === "string" ? body.id : "";
    const base = typeof body.base === "number" && Number.isInteger(body.base) && body.base >= 0 ? body.base : null;
    if (!id) return fail(400, "Which request?");
    if (base === null) return fail(400, "The change must say which version of the request it was made on");
    const read = await deps.readRequests();
    if (!read.ok) return fail(503, UNREADABLE);
    const stored = read.value.find((t) => t.id === id);
    // The copy may be a moment old: the RPC re-checks the base under its lock.
    if (!stored) return fail(404, "This request is not on the server.");
    const patch = (body.patch ?? {}) as StaffRequestTriage;
    if (patch.assignedToStaffId && !roster.some((s) => s.id === patch.assignedToStaffId)) {
      return fail(400, "That member of staff is not on the roster");
    }
    const p = triagePatch(stored, patch, deps.now());
    if (!p.ok) return fail(400, p.error);
    const r = await deps.write({ op: "upsert", id, base: asRevision(String(base)), row: p.row as Record<string, unknown> });
    if (!r.ok) {
      deps.invalidate();
      return writeFailure(r);
    }
    deps.invalidate();
    return NextResponse.json({ ok: true, request: { ...stored, ...p.row, rev: savedRev(r) } }, { headers: NO_STORE });
  }

  return fail(400, "Unknown op — raise or update");
}
