/**
 * Booking a PTM slot on a family's behalf, server-side.
 *
 * `/api/v1/ptm/book` is the parent's own route: a parent opens the portal,
 * picks a time and books it. Plenty of families never will — they call the
 * office, or catch the class teacher at the gate — and the staff member who
 * takes that call has no way to book it for them without opening the ERP.
 *
 * This is the shared path for both. The parent route keeps its own
 * permission rules and calls in here to do the work; the command desk calls
 * the same function with the staff member's session, so a booking made from
 * a WhatsApp command is the same record, in the same order, as one the
 * parent made themselves.
 *
 * Two things the parent portal does in the browser happen here instead.
 * `savePtm()` is a no-op on the server, so the new booking is folded into
 * the server cache and pushed to the database explicitly; and the family is
 * told through the app rather than by the staff member opening wa.me.
 */

import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import {
  activeBookingForStudent,
  bookPtmSlot,
  loadPtm,
  modeLabel,
  slotBookedCount,
  writePtmLocalRaw,
  type PtmBooking,
  type PtmEvent,
  type PtmSlot,
} from "@/lib/ptm";
import { householdWhatsApp, loadSis, type SisStudent } from "@/lib/sis";
import { classLabel } from "@/lib/homework";
import { sendPushToSubject } from "@/lib/webPush.server";
import { sendWaWithFailover, buildWaTemplateBodyComponent } from "@/lib/waSend";

export type PtmSlotOption = {
  id: string;
  startAt: string;
  endAt: string;
  teacherName: string;
  roomOrLink: string;
  /** Places still open on this slot. */
  free: number;
};

export type PtmOptions = {
  event: PtmEvent;
  student: SisStudent;
  classLabel: string;
  guardianName: string;
  mobile: string;
  householdId: string;
  /** Slots with at least one place left, earliest first. */
  slots: PtmSlotOption[];
  /** The child's existing booking on this event, when there is one. */
  existing: { booking: PtmBooking; slot: PtmSlot | undefined } | null;
};

/**
 * The PTM a booking would be made against, and the times still open on it.
 *
 * An event is a candidate when it is active, in this academic year, covers
 * the child's class (an empty class list means the whole school) and has
 * not finished yet. The nearest one wins — a school running two at once is
 * rare, and the card names the event so a wrong guess is visible before
 * anything is written.
 */
export async function ptmOptionsForStudent(opts: {
  studentId: string;
  academicYearCode: string;
  todayIso: string;
}): Promise<{ ok: true; options: PtmOptions } | { ok: false; error: string }> {
  await ensureSchoolMirrorHydrated();
  await ensurePtmHydratedServer();

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === opts.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const { loadMasters } = await import("@/lib/masters");
  const masters = loadMasters();
  const state = loadPtm();
  const events = state.events
    .filter(
      (e) =>
        e.isActive &&
        e.academicYearCode === opts.academicYearCode &&
        (e.classIds.length === 0 || e.classIds.includes(student.classId)) &&
        (e.endDate || e.date) >= opts.todayIso,
    )
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!events.length) {
    return { ok: false, error: "No PTM is open for that class right now" };
  }
  const event = events[0]!;

  const slots = state.slots
    .filter((s) => s.eventId === event.id)
    .map((s) => ({
      id: s.id,
      startAt: s.startAt,
      endAt: s.endAt,
      teacherName: s.teacherName,
      roomOrLink: s.roomOrLink,
      free: Math.max(0, s.capacity - slotBookedCount(state, s.id)),
    }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const booking = activeBookingForStudent(state, event.id, student.id);
  const hh = sis.households.find((h) => h.id === student.householdId);
  return {
    ok: true,
    options: {
      event,
      student,
      classLabel: classLabel(masters, student.classId, student.sectionId).replace(" · ", " "),
      guardianName: hh?.guardianName || "",
      mobile: hh ? householdWhatsApp(hh) || hh.mobile || hh.altMobile || "" : "",
      householdId: student.householdId || "",
      slots,
      existing: booking
        ? { booking, slot: state.slots.find((s) => s.id === booking.slotId) }
        : null,
    },
  };
}

export type PtmBookResult =
  | {
      ok: true;
      booking: PtmBooking;
      slot: PtmSlot;
      event: PtmEvent;
      studentName: string;
      /** False when the booking is only in this process's cache. */
      persisted: boolean;
      persistError?: string;
      pushSent: number;
      whatsapp: { sent: boolean; error?: string };
    }
  | { ok: false; error: string };

/**
 * Book one slot and tell the family.
 *
 * `bookPtmSlot` is the same validator the parent portal uses — event open,
 * slot on that event, child in scope, no second booking, capacity left — so
 * a staff booking cannot slip past a rule a parent is held to.
 */
export async function bookPtmSlotServer(opts: {
  studentId: string;
  eventId: string;
  slotId: string;
  /** Who the booking is recorded under — the parent, not the staff member. */
  parentName: string;
  householdId: string;
  /** Tell the family. The parent's own booking already knows it happened. */
  notify?: boolean;
  /** Approved notice template, when the school has one. */
  template?: { metaName: string; language: string; variables: string[]; vars: Record<string, string> } | null;
}): Promise<PtmBookResult> {
  await ensureSchoolMirrorHydrated();
  await ensurePtmHydratedServer();

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === opts.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const result = bookPtmSlot({
    eventId: opts.eventId,
    slotId: opts.slotId,
    studentId: opts.studentId,
    parentName: opts.parentName,
    householdId: opts.householdId || student.householdId || "",
  });
  if (!result.ok) return { ok: false, error: result.error };

  // savePtm() inside the mutator is a no-op on the server, so fold the new
  // booking into the server cache before pushing the bundle.
  const prior = loadPtm();
  const state = prior.bookings.some((b) => b.id === result.booking.id)
    ? prior
    : { ...prior, bookings: [result.booking, ...prior.bookings] };
  writePtmLocalRaw(state);

  const { pushPtmDeskToDb } = await import("@/lib/ptmNormalized.server");
  const dbPush = await pushPtmDeskToDb({
    version: 1,
    events: state.events,
    slots: state.slots,
    bookings: state.bookings,
    feedback: state.feedback,
  });
  if (!dbPush.ok) console.warn("[ptm] db push failed", dbPush.error);

  const slot = state.slots.find((s) => s.id === opts.slotId)!;
  const event = state.events.find((e) => e.id === opts.eventId)!;

  let pushSent = 0;
  let whatsapp: { sent: boolean; error?: string } = { sent: false };
  if (opts.notify) {
    const householdId = opts.householdId || student.householdId || "";
    if (householdId) {
      const r = await sendPushToSubject("parent", householdId, {
        title: `PTM booked · ${student.fullName}`,
        body: `${event.name} · ${event.date} ${slot.startAt} with ${slot.teacherName}${slot.roomOrLink ? ` · ${slot.roomOrLink}` : ""} (${modeLabel(event.mode)}).`,
        url: "/ptm",
        data: { kind: "ptm", bookingId: result.booking.id },
      }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
      pushSent = r.sent;
    }
    const hh = sis.households.find((h) => h.id === householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (opts.template?.metaName && mobile) {
      const sent = await sendWaWithFailover({
        primaryMobile: mobile,
        template: {
          name: opts.template.metaName,
          language: opts.template.language,
          components: [buildWaTemplateBodyComponent(opts.template.variables, opts.template.vars)],
        },
        clientMessageId: `ptmbook_${result.booking.id}`,
      });
      whatsapp = sent.ok ? { sent: true } : { sent: false, error: sent.error };
    } else if (opts.template?.metaName && !mobile) {
      whatsapp = { sent: false, error: "No parent WhatsApp number on record" };
    } else {
      whatsapp = { sent: false, error: "No approved notice template" };
    }
  }

  return {
    ok: true,
    booking: result.booking,
    slot,
    event,
    studentName: student.fullName,
    persisted: dbPush.ok,
    persistError: dbPush.ok ? undefined : dbPush.error || "Could not save the booking",
    pushSent,
    whatsapp,
  };
}
