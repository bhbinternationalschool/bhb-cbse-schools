/**
 * What a teacher may see and change on the PTM desk (2026-09-29).
 *
 * Until now the web PTM desk loaded and pushed the whole school's PTM
 * state from any browser with ptm.edit — a teacher saw every class's
 * bookings and feedback and could add slots in anyone's name. Events stay
 * an office decision; a teacher works inside them:
 *   - events that include one of their classes (or every class),
 *   - their own slots,
 *   - bookings on their own slots or for a child in one of their sections,
 *     and the feedback on those bookings.
 * The v1 PTM routes use the same rules to read and to allow a write, so a
 * screen can never offer what the save would refuse.
 */

import type { StaffScope } from "@/lib/api/v1/staffScope";
import { sectionKey } from "@/lib/api/v1/staffScope";
import type { PtmBooking, PtmEvent, PtmState } from "@/lib/ptm";
import type { SisState } from "@/lib/sis";

export function ptmEventReachesScope(event: PtmEvent, scope: StaffScope): boolean {
  if (scope.unrestricted) return true;
  // An event with no class list is for every class — it reaches everyone.
  if (!event.classIds.length) return true;
  const mine = new Set(scope.teaching.map((t) => t.classId));
  return event.classIds.some((id) => mine.has(id));
}

export function ptmBookingInScope(input: {
  state: PtmState;
  booking: PtmBooking;
  scope: StaffScope;
  staffId: string;
  sis: SisState;
}): boolean {
  const { state, booking, scope, staffId, sis } = input;
  if (scope.unrestricted) return true;
  const slot = state.slots.find((s) => s.id === booking.slotId);
  if (staffId && slot?.teacherStaffId === staffId) return true;
  const st = sis.students.find((s) => s.id === booking.studentId);
  // A child the register cannot place is not in anyone's section.
  if (!st) return false;
  return scope.sections.has(sectionKey(st.classId, st.sectionId));
}

/** The slice of the PTM desk this session may read. Unrestricted sessions
 * get the whole state back unchanged. */
export function scopedPtmState(input: {
  state: PtmState;
  scope: StaffScope;
  staffId: string;
  sis: SisState;
}): PtmState {
  const { state, scope, staffId, sis } = input;
  if (scope.unrestricted) return state;
  const events = state.events.filter((e) => ptmEventReachesScope(e, scope));
  const eventIds = new Set(events.map((e) => e.id));
  const bookings = state.bookings.filter(
    (b) =>
      eventIds.has(b.eventId) &&
      ptmBookingInScope({ state, booking: b, scope, staffId, sis }),
  );
  const bookingIds = new Set(bookings.map((b) => b.id));
  const bookedSlotIds = new Set(bookings.map((b) => b.slotId));
  // Own slots, plus the (read-only) slot behind each visible booking so a
  // booking card can still show its time and teacher.
  const slots = state.slots.filter(
    (s) =>
      eventIds.has(s.eventId) &&
      ((!!staffId && s.teacherStaffId === staffId) || bookedSlotIds.has(s.id)),
  );
  const feedback = state.feedback.filter((f) => bookingIds.has(f.bookingId));
  return { version: 1, events, slots, bookings, feedback };
}
