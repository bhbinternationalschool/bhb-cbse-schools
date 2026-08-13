/**
 * Events & academic calendar — thin CRUD over the server-authoritative
 * school_events / event_rsvps tables (no localStorage desk-sync: RSVP
 * writes are inherently server-side already, since the WA webhook that
 * records them has no access to a browser's localStorage).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, householdWhatsApp } from "@/lib/sis";
import { sendEventRsvpPrompt } from "@/lib/waEventsRsvp.server";
import {
  normalizeEventKind,
  type EventKind,
  type SchoolEvent,
} from "@/lib/events";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  academic_year_code: string;
  title: string;
  description: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  start_time: string;
  location: string;
  class_ids: string[];
  rsvp_enabled: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function rowToEvent(r: EventRow): SchoolEvent {
  return {
    id: r.id,
    academicYearCode: r.academic_year_code,
    title: r.title,
    description: r.description,
    kind: normalizeEventKind(r.kind),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    startTime: r.start_time,
    location: r.location,
    classIds: Array.isArray(r.class_ids) ? r.class_ids : [],
    rsvpEnabled: r.rsvp_enabled,
    isActive: r.is_active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type RsvpRow = {
  id: string;
  event_id: string;
  household_id: string;
  choice: string | null;
  responded_at: string | null;
  reminded_at: string | null;
  updated_at: string;
};

/** GET — events (+ their RSVPs) for the tenant, optionally by academic year. */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "events", "view");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const ay = new URL(req.url).searchParams.get("academicYearCode");
  let eventsQuery = sb.from("school_events").select("*").eq("tenant_id", tenantId);
  if (ay) eventsQuery = eventsQuery.eq("academic_year_code", ay);
  const { data: eventRows, error: eventsErr } = await eventsQuery.order("starts_on");
  if (eventsErr) {
    return NextResponse.json({ error: eventsErr.message }, { status: 502 });
  }
  const events = ((eventRows ?? []) as EventRow[]).map(rowToEvent);

  const eventIds = events.map((e) => e.id);
  let rsvps: RsvpRow[] = [];
  if (eventIds.length) {
    const { data: rsvpRows, error: rsvpErr } = await sb
      .from("event_rsvps")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("event_id", eventIds);
    if (rsvpErr) {
      return NextResponse.json({ error: rsvpErr.message }, { status: 502 });
    }
    rsvps = (rsvpRows ?? []) as RsvpRow[];
  }

  return NextResponse.json({
    ok: true,
    events,
    rsvps: rsvps.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      householdId: r.household_id,
      choice: r.choice,
      respondedAt: r.responded_at,
      remindedAt: r.reminded_at,
      updatedAt: r.updated_at,
    })),
  });
}

type EventPostBody = {
  id?: string;
  academicYearCode?: string;
  title?: string;
  description?: string;
  kind?: EventKind;
  startsOn?: string;
  endsOn?: string;
  startTime?: string;
  location?: string;
  classIds?: string[];
  rsvpEnabled?: boolean;
  isActive?: boolean;
};

/** POST — create (no id) or update (id present) one event. */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "events", "edit");
  if (!auth.ok) return auth.response;

  let body: EventPostBody;
  try {
    body = (await req.json()) as EventPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const academicYearCode = (body.academicYearCode || "").trim();
  const startsOn = (body.startsOn || "").slice(0, 10);
  const endsOn = (body.endsOn || startsOn).slice(0, 10);
  if (!title || !academicYearCode || !startsOn) {
    return NextResponse.json(
      { error: "title, academicYearCode and startsOn are required" },
      { status: 400 },
    );
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const now = new Date().toISOString();
  const id = body.id || `evt_${randomUUID()}`;
  const row = {
    id,
    tenant_id: tenantId,
    academic_year_code: academicYearCode,
    title,
    description: body.description || "",
    kind: normalizeEventKind(body.kind),
    starts_on: startsOn,
    ends_on: endsOn < startsOn ? startsOn : endsOn,
    start_time: body.startTime || "",
    location: body.location || "",
    class_ids: Array.isArray(body.classIds) ? body.classIds : [],
    rsvp_enabled: !!body.rsvpEnabled,
    is_active: body.isActive !== false,
    created_by: auth.ctx.session.fullName || "Staff",
    updated_at: now,
  };

  const { error } = await sb.from("school_events").upsert(row, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id });
}

/** DELETE — remove an event (cascades to its RSVPs). */
export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "events", "delete");
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const { error } = await sb
    .from("school_events")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

type EventPatchBody = { eventId?: string; action?: "send_rsvp" };

/** PATCH — send the RSVP prompt to every household in the event's classes
 * (or every active household, when the event has no class scope). */
export async function PATCH(req: Request) {
  const auth = await requireStaffPermission(req, "events", "edit");
  if (!auth.ok) return auth.response;

  let body: EventPatchBody;
  try {
    body = (await req.json()) as EventPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "send_rsvp" || !body.eventId) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const { data: eventRow, error: eventErr } = await sb
    .from("school_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", body.eventId)
    .maybeSingle();
  if (eventErr || !eventRow) {
    return NextResponse.json({ error: eventErr?.message || "Event not found" }, { status: 404 });
  }
  const event = rowToEvent(eventRow as EventRow);
  if (!event.rsvpEnabled) {
    return NextResponse.json({ error: "RSVP is not enabled for this event" }, { status: 400 });
  }

  await Promise.all([ensureSisHydratedServer(), ensureSchoolMirrorHydrated()]);
  const sis = loadSis();
  const classSet = new Set(event.classIds);
  const targetStudents = sis.students.filter(
    (s) => s.status === "active" && (classSet.size === 0 || classSet.has(s.classId)),
  );
  const householdIds = Array.from(new Set(targetStudents.map((s) => s.householdId)));
  const households = householdIds
    .map((id) => sis.households.find((h) => h.id === id))
    .filter((h): h is NonNullable<typeof h> => !!h);

  let sent = 0;
  let failed = 0;
  let skippedNoMobile = 0;
  for (const hh of households) {
    const mobile = householdWhatsApp(hh);
    if (!mobile) {
      skippedNoMobile += 1;
      continue;
    }
    const r = await sendEventRsvpPrompt(event, { id: hh.id, whatsappMobile: mobile });
    if (r.ok) sent += 1;
    else failed += 1;
  }

  const now = new Date().toISOString();
  const { data: existingRows } = await sb
    .from("event_rsvps")
    .select("household_id")
    .eq("tenant_id", tenantId)
    .eq("event_id", event.id);
  const existingIds = new Set(
    ((existingRows ?? []) as { household_id: string }[]).map((r) => r.household_id),
  );
  const newHouseholdIds = households.map((h) => h.id).filter((id) => !existingIds.has(id));
  if (newHouseholdIds.length) {
    await sb.from("event_rsvps").insert(
      newHouseholdIds.map((householdId) => ({
        id: `${event.id}|${householdId}`,
        tenant_id: tenantId,
        event_id: event.id,
        household_id: householdId,
        choice: null,
        reminded_at: now,
        updated_at: now,
      })),
    );
  }
  const reminderIds = households.map((h) => h.id).filter((id) => existingIds.has(id));
  if (reminderIds.length) {
    await sb
      .from("event_rsvps")
      .update({ reminded_at: now, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("event_id", event.id)
      .in("household_id", reminderIds);
  }

  return NextResponse.json({ ok: true, sent, failed, skippedNoMobile, targetHouseholds: households.length });
}
