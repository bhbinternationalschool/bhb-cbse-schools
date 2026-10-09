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
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { stampsOf, writeStampedRows } from "@/lib/rowStampWrite.server";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";

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

/** The PTM tables a desk save deletes from — by named id only. */
export const PTM_DELETABLE_TABLES = ["ptm_desk_events", "ptm_desk_slots"] as const;
/** Desk slice each deletable table stores (for function-only writers). */
export const PTM_TABLE_SLICES: Record<string, string> = {
  ptm_desk_events: "events",
  ptm_desk_slots: "slots",
};

/** The four PTM lists, in write order (a slot needs its event, and so on). */
export const PTM_SLICES = ["events", "slots", "bookings", "feedback"] as const;
export type PtmSlice = (typeof PTM_SLICES)[number];
const PTM_SLICE_TABLE: Record<PtmSlice, string> = {
  events: "ptm_desk_events",
  slots: "ptm_desk_slots",
  bookings: "ptm_desk_bookings",
  feedback: "ptm_desk_feedback",
};

export type PtmPushOpts = {
  /**
   * A browser's save: per list, the rows it changed and the `updated_at`
   * each was changed from ("" = new). Only those rows are written, each
   * only while still at that stamp; the rest are conflicts.
   */
  stamps?: RowStamps;
  /** A server writer: the rows it changed. Only those are written. */
  only?: Partial<Record<PtmSlice, string[]>>;
};

export async function pushPtmDeskToDb(
  state: PtmState,
  deletes: NamedDeletes = {},
  opts: PtmPushOpts = {},
): Promise<{ ok: boolean; error?: string; stamps?: RowStamps; conflicts?: RowConflicts }> {
  if (!ptmDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const goneEvents = new Set(deletes["ptm_desk_events"] ?? []);
  const goneSlots = new Set(deletes["ptm_desk_slots"] ?? []);
  const events = (state.events ?? []).filter((e) => !goneEvents.has(e.id));
  const slots = (state.slots ?? []).filter(
    (x) => !goneSlots.has(x.id) && !goneEvents.has(x.eventId),
  );
  // Rows under a deleted event or slot are not written back first.
  const goneBookings = new Set(
    (state.bookings ?? [])
      .filter((b) => goneSlots.has(b.slotId) || goneEvents.has(b.eventId))
      .map((b) => b.id),
  );
  const bookings = (state.bookings ?? []).filter((b) => !goneBookings.has(b.id));
  const feedback = (state.feedback ?? []).filter((f) => !goneBookings.has(f.bookingId));

  // No prune by absence. Parents book and teachers add slots and feedback
  // through the apps, and an empty browser seeds a sample event before it
  // has pulled the desk — that seed used to delete every other event, and
  // with them (on delete cascade) every slot, booking and feedback. Events
  // and slots go only when the user deleted them, named; their bookings and
  // feedback follow by cascade.
  //
  // No stale copy over a newer row (2026-10-09). Every row the save held
  // was upserted, so a tab that loaded a booking before the parent
  // cancelled it wrote "booked" back, and a teacher's slot edit or feedback
  // was undone by the next office save. A browser now sends the rows it
  // changed with the stamp it loaded (written only while still at it); a
  // server writer names the rows it changed. A save with neither (the blob
  // backfill, a browser on an older build) writes everything as before.
  const rows: Record<PtmSlice, Record<string, unknown>[]> = {
    events: events.map((e) => eventToRow(tenantId, e)),
    slots: slots.map((x) => slotToRow(tenantId, x)),
    bookings: bookings.map((b) => bookingToRow(tenantId, b)),
    feedback: feedback.map((f) => feedbackToRow(tenantId, f)),
  };
  const newStamps: RowStamps = {};
  const conflicts: RowConflicts = {};
  for (const slice of PTM_SLICES) {
    const table = PTM_SLICE_TABLE[slice];
    if (opts.stamps) {
      const sent = opts.stamps[slice] ?? {};
      const mine = rows[slice].filter((r) => String(r.id) in sent);
      const w = await writeStampedRows(sb, table, tenantId, mine, sent);
      if (!w.ok) return w;
      newStamps[slice] = w.stamps;
      if (w.conflicts.length) conflicts[slice] = w.conflicts;
      continue;
    }
    const only = opts.only ? new Set(opts.only[slice] ?? []) : null;
    const r = await upsertChunks(
      sb,
      table,
      only ? rows[slice].filter((x) => only.has(String(x.id))) : rows[slice],
    );
    if (!r.ok) return r;
  }

  for (const table of PTM_DELETABLE_TABLES) {
    const del = await deleteNamedIds(sb, tenantId, table, deletes[table]);
    if (!del.ok) return del;
  }

  // Counts from the database, not from this copy (it may be partly written).
  await touchPtmMeta(sb, tenantId, now).catch(() => undefined);
  if (Object.keys(conflicts).length) console.warn("[ptm-db] kept newer rows over a stale copy", conflicts);
  return { ok: true, stamps: newStamps, conflicts };
}

/** Recount the desk meta from the tables, so a hydrate sees the change. */
async function touchPtmMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const count = (table: string) =>
    sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [ev, sl, bk, fb, latest] = await Promise.all([
    count("ptm_desk_events"),
    count("ptm_desk_slots"),
    count("ptm_desk_bookings"),
    count("ptm_desk_feedback"),
    sb
      .from("ptm_desk_bookings")
      .select("booked_at")
      .eq("tenant_id", tenantId)
      .order("booked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  if (!ev.error && typeof ev.count === "number") row.event_count = ev.count;
  if (!sl.error && typeof sl.count === "number") row.slot_count = sl.count;
  if (!bk.error && typeof bk.count === "number") row.booking_count = bk.count;
  if (!fb.error && typeof fb.count === "number") row.feedback_count = fb.count;
  if (!latest.error) row.last_booked_at = (latest.data as { booked_at?: string } | null)?.booked_at ?? null;
  await sb.from("ptm_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

export async function fetchPtmDeskFromDb(): Promise<{
  bundle: PtmDeskBundle;
  meta: PtmDeskSyncMeta | null;
  ok: boolean;
  /** Each row's `updated_at`, per list — what a browser's save is stamped with. */
  stamps: RowStamps;
}> {
  const ctx = await resolveCtx();
  const empty: PtmDeskBundle = {
    events: [],
    slots: [],
    bookings: [],
    feedback: [],
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false, stamps: {} };
  const { sb, tenantId } = ctx;

  // Paged: PostgREST stops at 1,000 rows. A short copy merged and pushed
  // back whole (school-data/ptm-desk) would prune every row past the first
  // page — bookings get there after a few meetings.
  const all = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from(table).select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null }));
  const [eventRes, slotRes, bookingRes, feedbackRes, metaRes] =
    await Promise.all([
      all("ptm_desk_events"),
      all("ptm_desk_slots"),
      all("ptm_desk_bookings"),
      all("ptm_desk_feedback"),
      sb
        .from("ptm_desk_sync_meta")
        .select(META_SELECT)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  if (
    eventRes.error ||
    slotRes.error ||
    bookingRes.error ||
    feedbackRes.error ||
    metaRes.error
  ) {
    console.warn(
      "[ptm-db] fetchPtmDeskFromDb query error",
      eventRes.error || slotRes.error || bookingRes.error || feedbackRes.error || metaRes.error,
    );
    return { bundle: empty, meta: null, ok: false, stamps: {} };
  }

  const eventRows = eventRes.data;
  const slotRows = slotRes.data;
  const bookingRows = bookingRes.data;
  const feedbackRows = feedbackRes.data;
  const metaRow = metaRes.data;

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
    ok: true,
    stamps: {
      events: stampsOf(eventRows),
      slots: stampsOf(slotRows),
      bookings: stampsOf(bookingRows),
      feedback: stampsOf(feedbackRows),
    },
  };
}
