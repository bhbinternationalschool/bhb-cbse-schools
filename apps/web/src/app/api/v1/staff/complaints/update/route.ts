import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { complaintStatusLabel, type ComplaintStatus } from "@/lib/complaints";
import { listAllComplaintTickets, updateComplaintTicketServer } from "@/lib/complaintsServer";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { complaintInScope } from "@/lib/api/v1/staffComplaints";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

type Body = { id?: string; status?: string; resolutionNote?: string; takeUp?: boolean };
const ALLOWED: ComplaintStatus[] = ["assigned", "in_progress", "resolved", "closed"];

/**
 * POST /api/v1/staff/complaints/update {id, status, resolutionNote, takeUp}
 * — move a ticket along: take it up (assigns to me), mark in progress,
 * resolve with a note (the parent is told), or close. Writes to whichever
 * store holds the ticket, so the office desk sees the same row.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "complaints", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);
    const status = (body.status || "").trim() as ComplaintStatus;
    const note = (body.resolutionNote || "").trim().slice(0, 600);
    if (status && !ALLOWED.includes(status)) {
      throw new ApiError("bad_request", "status must be assigned, in_progress, resolved or closed", 400);
    }
    if (status === "resolved" && !note) {
      throw new ApiError("bad_request", "Say what was done — the parent will read it", 400);
    }

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const tickets = await listAllComplaintTickets();
    if (tickets === null) {
      throw new ApiError("server_error", "Complaints are unavailable right now", 503);
    }
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) throw new ApiError("not_found", "Ticket not found", 404);
    const sis = loadSis();
    const studentById = new Map(sis.students.map((s) => [s.id, s]));
    if (!complaintInScope(ctx, scope, ticket, studentById)) {
      throw new ApiError("forbidden", "Not a complaint for your class", 403);
    }
    if (status === "closed" && !scope.unrestricted) {
      throw new ApiError("forbidden", "Only the office can close a ticket; resolve it instead", 403);
    }

    const patch: Parameters<typeof updateComplaintTicketServer>[1] = {};
    if (body.takeUp || status === "assigned") {
      patch.assignedToStaffId = ctx.session.staffId || ticket.assignedToStaffId;
      if (!status || status === "assigned") patch.status = "assigned";
    }
    if (status && status !== "assigned") patch.status = status;
    if (status === "resolved") {
      patch.resolutionNote = note;
      patch.resolvedAt = new Date().toISOString();
    } else if (note) {
      patch.resolutionNote = note;
    }
    if (Object.keys(patch).length === 0) {
      throw new ApiError("bad_request", "Nothing to change", 400);
    }

    const result = await updateComplaintTicketServer(id, patch);
    if (!result.ok) throw new ApiError("server_error", result.error, 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "complaints",
      action: "edit",
      entityType: "ticket",
      entityId: id,
      summary: `Complaint ${complaintStatusLabel(result.ticket.status).toLowerCase()} from app: ${ticket.subject}`,
      after: { status: result.ticket.status, assignedToStaffId: result.ticket.assignedToStaffId, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (ticket.householdId && (status === "resolved" || status === "in_progress")) {
      await sendPushToSubject("parent", ticket.householdId, {
        title: status === "resolved" ? "Your complaint has been resolved" : "Your complaint is being looked into",
        body: status === "resolved" ? `${ticket.subject}: ${note}` : `${ticket.subject} · ${ctx.session.fullName}`,
        url: "/complaints",
        data: { kind: "complaint_update", ticketId: id, status: result.ticket.status },
      }).catch(() => undefined);
    }

    return apiOk({
      id,
      status: result.ticket.status,
      statusLabel: complaintStatusLabel(result.ticket.status),
      assignedToStaffId: result.ticket.assignedToStaffId,
      resolutionNote: result.ticket.resolutionNote,
      resolvedAt: result.ticket.resolvedAt,
    });
  } catch (e) {
    return apiErr(e);
  }
}
