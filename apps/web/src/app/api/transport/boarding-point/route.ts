/**
 * POST/DELETE /api/transport/boarding-point
 *
 * Records where one child actually boards — the point somebody dropped a pin
 * on, per student, in sis_student_transport_point.
 *
 * The table has existed since 24 August and has never held a row, because
 * nothing could write to it. Its own header says why it is per STUDENT rather
 * than per household: siblings are not always collected in the same place, an
 * older child on the main road while the younger is picked up nearer home.
 *
 * Server-owned on purpose. sis_students is pushed wholesale from the browser
 * by the roster sync, so a column there would survive only until the next
 * push — the same reason sis_household_village exists separately.
 *
 * A pin does NOT move the child's assignment or change the fee. It records a
 * fact about where they stand each morning; what they are billed for stays a
 * decision the office makes on the Riders panel. Pinning the place a child
 * really boards therefore keeps a mismatch visible in the audit rather than
 * silencing it, which is the point.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

type Body = {
  studentId?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  pointName?: unknown;
  note?: unknown;
  stopId?: unknown;
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
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  // Two ways to pin: an explicit point somebody dragged, or "copy the
  // coordinates of this route stop". The second is what the office uses to
  // confirm a child boards where the desk already says — and the stop's
  // coordinates are read here rather than trusted from the browser, so the
  // record cannot drift from the stop it claims to copy.
  const stopId = str(body.stopId);
  let latitude = Number(body.latitude);
  let longitude = Number(body.longitude);
  let copiedStopName = "";

  if (stopId && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    const desk = await fetchTransportDeskFromDb();
    if (!desk.ok) {
      return NextResponse.json({ error: "Could not read the transport desk" }, { status: 502 });
    }
    const state = deskBundleToTransportState(desk.bundle);
    const stop = state.routes
      .flatMap((r) => r.stops)
      .find((s) => s.id === stopId);
    if (!stop || !Number.isFinite(stop.geoLat) || !Number.isFinite(stop.geoLng)) {
      return NextResponse.json(
        { error: "That stop has no map pin to copy" },
        { status: 400 },
      );
    }
    latitude = Number(stop.geoLat);
    longitude = Number(stop.geoLng);
    copiedStopName = stop.name;
  }

  // Number.isFinite, not typeof: NaN is a number, and a NaN pin would be
  // stored, compared against every stop, lose every comparison silently and
  // then be shown to the office as a boarding point with no location.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json(
      { error: "Give a latitude and longitude, or a stopId to copy" },
      { status: 400 },
    );
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: "Coordinates out of range" }, { status: 400 });
  }

  const row = {
    student_id: studentId,
    tenant_id: tenantId,
    latitude,
    longitude,
    // Rural boarding points are landmarks with no formal name. Free text,
    // deliberately — forcing a pick from the stop list would either lose the
    // description or invent a stop that does not exist.
    point_name: str(body.pointName) || copiedStopName,
    note: str(body.note),
    stop_id: stopId,
    set_by: auth.ctx.session.fullName || auth.ctx.session.email || "",
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb
    .from("sis_student_transport_point")
    .upsert(row, { onConflict: "student_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: "boarding_point_set",
    entityType: "student",
    entityId: studentId,
    summary: `Boarding point pinned${row.point_name ? ` at ${row.point_name}` : ""}`,
    after: { latitude, longitude, pointName: row.point_name, stopId: row.stop_id },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  const studentId = new URL(req.url).searchParams.get("studentId")?.trim();
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }

  const { error } = await ctx.sb
    .from("sis_student_transport_point")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("student_id", studentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: "boarding_point_cleared",
    entityType: "student",
    entityId: studentId,
    summary: "Boarding point pin removed",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
}
