/**
 * PTM desk — Supabase normalized tables (ptm_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PtmBooking,
  PtmBookingStatus,
  PtmEvent,
  PtmFeedback,
  PtmMode,
  PtmSlot,
  PtmState,
} from "@/lib/ptm";
import { ptmDualWriteDbEnabled } from "@/lib/ptmDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type PtmDeskSyncMeta = {
  eventCount: number;
  slotCount: number;
  bookingCount: number;
  feedbackCount: number;
  lastBookedAt: string | null;
  updatedAt: string;
};

export type PtmDeskBundle = {
  events: PtmEvent[];
  slots: PtmSlot[];
  bookings: PtmBooking[];
  feedback: PtmFeedback[];
};

const META_SELECT =
  "event_count, slot_count, booking_count, feedback_count, last_booked_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function eventToRow(tenantId: string, e: PtmEvent): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: e.id,
    tenant_id: tenantId,
    academic_year_code: e.academicYearCode,
    name: e.name || "",
    event_date: e.date,
    end_date: e.endDate || e.date,
    class_ids_json: e.classIds ?? [],
    mode: e.mode,
    note: e.note || "",
    is_active: e.isActive !== false,
    created_at: e.createdAt || now,
    updated_at: now,
  };
}

function rowToEvent(r: Record<string, unknown>): PtmEvent {
  const classIds = Array.isArray(r.class_ids_json)
    ? (r.class_ids_json as string[])
    : [];
  const mode = String(r.mode) as PtmMode;
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code),
    name: String(r.name || ""),
    date: String(r.event_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    classIds,
    mode:
      mode === "video" || mode === "phone" || mode === "in_person"
        ? mode
        : "in_person",
    note: String(r.note || ""),
    isActive: r.is_active !== false,
    createdAt: String(r.created_at),
  };
}

function slotToRow(tenantId: string, s: PtmSlot): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: s.id,
    tenant_id: tenantId,
    event_id: s.eventId,
    teacher_staff_id: s.teacherStaffId || "",
    teacher_name: s.teacherName || "",
    start_at: s.startAt || "",
    end_at: s.endAt || "",
    capacity: s.capacity ?? 1,
    room_or_link: s.roomOrLink || "",
    updated_at: now,
  };
}

function rowToSlot(r: Record<string, unknown>): PtmSlot {
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    teacherStaffId: String(r.teacher_staff_id || ""),
    teacherName: String(r.teacher_name || ""),
    startAt: String(r.start_at || ""),
    endAt: String(r.end_at || ""),
    capacity: Number(r.capacity || 1),
    roomOrLink: String(r.room_or_link || ""),
  };
}

function bookingToRow(tenantId: string, b: PtmBooking): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: b.id,
    tenant_id: tenantId,
    event_id: b.eventId,
    slot_id: b.slotId,
    student_id: b.studentId,
    parent_name: b.parentName || "",
    household_id: b.householdId || "",
    status: b.status,
    booked_at: b.bookedAt || now,
    whatsapp_confirmed_at: b.whatsappConfirmedAt || "",
    whatsapp_reminded_at: b.whatsappRemindedAt || "",
    updated_at: now,
  };
}

function rowToBooking(r: Record<string, unknown>): PtmBooking {
  const status = String(r.status) as PtmBookingStatus;
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    slotId: String(r.slot_id),
    studentId: String(r.student_id),
    parentName: String(r.parent_name || ""),
    householdId: String(r.household_id || ""),
    status:
      status === "cancelled" ||
      status === "completed" ||
      status === "no_show"
        ? status
        : "booked",
    bookedAt: String(r.booked_at),
    whatsappConfirmedAt: String(r.whatsapp_confirmed_at || "") || undefined,
    whatsappRemindedAt: String(r.whatsapp_reminded_at || "") || undefined,
  };
}

function feedbackToRow(tenantId: string, f: PtmFeedback): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: f.id,
    tenant_id: tenantId,
    booking_id: f.bookingId,
    student_id: f.studentId,
    strengths: f.strengths || "",
    areas: f.areas || "",
    follow_up: f.followUp || "",
    created_at: f.createdAt || now,
    created_by: f.createdBy || "",
    updated_at: now,
  };
}

function rowToFeedback(r: Record<string, unknown>): PtmFeedback {
  return {
    id: String(r.id),
    bookingId: String(r.booking_id),
    studentId: String(r.student_id),
    strengths: String(r.strengths || ""),
    areas: String(r.areas || ""),
    followUp: String(r.follow_up || ""),
    createdAt: String(r.created_at),
    createdBy: String(r.created_by || ""),
  };
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): PtmDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    eventCount: metaRow.event_count as number,
    slotCount: metaRow.slot_count as number,
    bookingCount: metaRow.booking_count as number,
    feedbackCount: metaRow.feedback_count as number,
    lastBookedAt: metaRow.last_booked_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

export async function pushPtmDeskToDb(
  state: PtmState,
): Promise<{ ok: boolean; error?: string }> {
  if (!ptmDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const events = state.events ?? [];
  const slots = state.slots ?? [];
  const bookings = state.bookings ?? [];
  const feedback = state.feedback ?? [];

  await Promise.all([
    deleteStale(sb, tenantId, "ptm_desk_events", new Set(events.map((e) => e.id))),
    deleteStale(sb, tenantId, "ptm_desk_slots", new Set(slots.map((s) => s.id))),
    deleteStale(
      sb,
      tenantId,
      "ptm_desk_bookings",
      new Set(bookings.map((b) => b.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "ptm_desk_feedback",
      new Set(feedback.map((f) => f.id)),
    ),
  ]);

  let r = await upsertChunks(
    sb,
    "ptm_desk_events",
    events.map((e) => eventToRow(tenantId, e)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "ptm_desk_slots",
    slots.map((s) => slotToRow(tenantId, s)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "ptm_desk_bookings",
    bookings.map((b) => bookingToRow(tenantId, b)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "ptm_desk_feedback",
    feedback.map((f) => feedbackToRow(tenantId, f)),
  );
  if (!r.ok) return r;

  let lastBookedAt: string | null = null;
  for (const b of bookings) {
    const at = b.bookedAt;
    if (at && (!lastBookedAt || at > lastBookedAt)) lastBookedAt = at;
  }

  await sb.from("ptm_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      event_count: events.length,
      slot_count: slots.length,
      booking_count: bookings.length,
      feedback_count: feedback.length,
      last_booked_at: lastBookedAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchPtmDeskFromDb(): Promise<{
  bundle: PtmDeskBundle;
  meta: PtmDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: PtmDeskBundle = {
    events: [],
    slots: [],
    bookings: [],
    feedback: [],
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: eventRows },
    { data: slotRows },
    { data: bookingRows },
    { data: feedbackRows },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("ptm_desk_events").select("*").eq("tenant_id", tenantId),
    sb.from("ptm_desk_slots").select("*").eq("tenant_id", tenantId),
    sb.from("ptm_desk_bookings").select("*").eq("tenant_id", tenantId),
    sb.from("ptm_desk_feedback").select("*").eq("tenant_id", tenantId),
    sb.from("ptm_desk_sync_meta").select(META_SELECT).eq("tenant_id", tenantId).maybeSingle(),
  ]);

  return {
    bundle: {
      events: (eventRows ?? []).map((r) => rowToEvent(r as Record<string, unknown>)),
      slots: (slotRows ?? []).map((r) => rowToSlot(r as Record<string, unknown>)),
      bookings: (bookingRows ?? []).map((r) =>
        rowToBooking(r as Record<string, unknown>),
      ),
      feedback: (feedbackRows ?? []).map((r) =>
        rowToFeedback(r as Record<string, unknown>),
      ),
    },
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
  };
}
