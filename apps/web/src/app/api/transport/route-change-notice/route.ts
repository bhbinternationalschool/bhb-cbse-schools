/**
 * POST /api/transport/route-change-notice
 *
 * Tell one family that their child's bus or stop has changed.
 *
 * Pressed by a clerk on the move they have just made, never fired by saving
 * the move itself — see `notifyRouteChange` for why route changes stay a
 * decision rather than a trigger. The endpoint exists so that decision costs
 * one press instead of a trip to the WhatsApp desk, which is why the real
 * changes were going untold.
 *
 * The route, stop and bus name are read from the SERVER's copy of the desk,
 * not from the body. A client that sent its own labels could message a parent
 * a stop name that exists only in one browser's unsaved state — and the
 * message is the one artefact of a move the family actually sees. The body
 * carries only ids and the effective date.
 *
 * Gated on `transport.edit`: this is the same authority as making the move,
 * and messaging a parent about a change you could not make is not a thing
 * anyone should be able to do.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { notifyRouteChange } from "@/lib/transportParentNotify.server";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import type { SisState } from "@/lib/sis";

export const runtime = "nodejs";

type Body = {
  studentId?: unknown;
  routeId?: unknown;
  stopId?: unknown;
  effectiveFrom?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const studentId = str(body.studentId);
  const routeId = str(body.routeId);
  const stopId = str(body.stopId);
  const effectiveFrom = str(body.effectiveFrom).slice(0, 10);
  if (!studentId || !routeId || !stopId) {
    return NextResponse.json(
      { error: "studentId, routeId and stopId are required" },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return NextResponse.json(
      { error: "effectiveFrom must be an ISO date" },
      { status: 400 },
    );
  }

  const [desk, sis] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
  ]);
  // A failed read is not an empty school. Sending against a bundle that did
  // not load would message the family a blank bus and a blank stop, or skip
  // silently as "student not found" — both worse than saying nothing worked.
  if (!desk.ok) {
    return NextResponse.json(
      { error: "Transport desk unavailable — nothing sent" },
      { status: 503 },
    );
  }
  if (!sis.ok) {
    return NextResponse.json(
      { error: "Student roster unavailable — nothing sent" },
      { status: 503 },
    );
  }

  const outcome = await notifyRouteChange({
    studentId,
    routeId,
    stopId,
    effectiveFrom,
    transport: deskBundleToTransportState(desk.bundle),
    sis: sis.bundle as unknown as SisState,
  });

  await writeAudit({
    module: "transport",
    action: outcome.sent
      ? "transport.route_change_notice.sent"
      : "transport.route_change_notice.not_sent",
    entityType: "student",
    entityId: studentId,
    summary: outcome.sent
      ? `Bus/stop change told to ${outcome.toMasked ?? "the family"}`
      : `Bus/stop change NOT told: ${outcome.error || outcome.skipped || "unknown"}`,
    after: {
      routeId,
      stopId,
      effectiveFrom,
      to: outcome.toMasked ?? null,
      template: outcome.templateName ?? null,
      // Kept whether or not it sent: "we told them" and "we meant to" are
      // different facts, and a parent will one day ask which happened.
      skipped: outcome.skipped ?? null,
      error: outcome.error ?? null,
    },
    ...requestMeta(req),
  });

  if (!outcome.sent) {
    return NextResponse.json(
      { ok: false, error: outcome.error || outcome.skipped || "Nothing sent" },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, to: outcome.toMasked ?? null });
}
