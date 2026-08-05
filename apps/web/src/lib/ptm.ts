/**
 * PTM scheduler (§19b) — events, teacher slots, parent bookings, feedback.
 * Demo store: localStorage `bhb_ptm_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { householdWhatsApp, loadSis, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";

const STORAGE_KEY = "bhb_ptm_v1";

let serverPtmCache: PtmState | null = null;

export type PtmMode = "in_person" | "video" | "phone";
export type PtmBookingStatus =
  | "booked"
  | "cancelled"
  | "completed"
  | "no_show";

export type PtmEvent = {
  id: string;
  academicYearCode: string;
  name: string;
  date: string;
  endDate: string;
  classIds: string[];
  mode: PtmMode;
  note: string;
  isActive: boolean;
  createdAt: string;
};

export type PtmSlot = {
  id: string;
  eventId: string;
  teacherStaffId: string;
  teacherName: string;
  startAt: string;
  endAt: string;
  capacity: number;
  roomOrLink: string;
};

export type PtmBooking = {
  id: string;
  eventId: string;
  slotId: string;
  studentId: string;
  parentName: string;
  householdId: string;
  status: PtmBookingStatus;
  bookedAt: string;
  whatsappConfirmedAt?: string;
  whatsappRemindedAt?: string;
};

export type PtmFeedback = {
  id: string;
  bookingId: string;
  studentId: string;
  strengths: string;
  areas: string;
  followUp: string;
  createdAt: string;
  createdBy: string;
};

export type PtmState = {
  version: 1;
  events: PtmEvent[];
  slots: PtmSlot[];
  bookings: PtmBooking[];
  feedback: PtmFeedback[];
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyPtmState(): PtmState {
  return { version: 1, events: [], slots: [], bookings: [], feedback: [] };
}

function normalizeState(raw: Partial<PtmState> | null): PtmState {
  const base = emptyPtmState();
  if (!raw) return base;
  return {
    version: 1,
    events: Array.isArray(raw.events) ? (raw.events as PtmEvent[]) : [],
    slots: Array.isArray(raw.slots) ? (raw.slots as PtmSlot[]) : [],
    bookings: Array.isArray(raw.bookings)
      ? (raw.bookings as PtmBooking[]).map((b) => ({
          ...b,
          whatsappConfirmedAt: b.whatsappConfirmedAt,
          whatsappRemindedAt: b.whatsappRemindedAt,
        }))
      : [],
    feedback: Array.isArray(raw.feedback) ? (raw.feedback as PtmFeedback[]) : [],
  };
}

export function loadPtm(): PtmState {
  if (typeof window === "undefined") {
    if (serverPtmCache) return serverPtmCache;
    return emptyPtmState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPtmState();
    return normalizeState(JSON.parse(raw) as Partial<PtmState>);
  } catch {
    return emptyPtmState();
  }
}

export function savePtm(state: PtmState): void {
  if (!assertModulePermission("ptm", "edit", "savePtm")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/ptmPersistence").then(({ schedulePtmSync }) => {
    schedulePtmSync(state);
  });

}

export function writePtmLocalRaw(state: PtmState) {
  if (typeof window === "undefined") {
    serverPtmCache = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function ptmStateIsEmpty(state: PtmState): boolean {
  return (state.events?.length ?? 0) === 0 && (state.bookings?.length ?? 0) === 0;
}


export function seedPtmIfEmpty(ay?: string): PtmState {
  const existing = loadPtm();
  if (existing.events.length > 0) return existing;
  const masters = loadMasters();
  const classIds = masters.classes
    .filter((c) => c.isActive !== false)
    .slice(0, 3)
    .map((c) => c.id);
  const staff =
    (masters.staff ?? []).find((s) => s.stream === "teaching") ||
    (masters.staff ?? [])[0];
  const date = todayIso();
  const eventId = nid("ptme");
  const event: PtmEvent = {
    id: eventId,
    academicYearCode: ay || DEFAULT_AY,
    name: "Term PTM",
    date,
    endDate: date,
    classIds,
    mode: "in_person",
    note: "Meet class teacher — 10 min slots",
    isActive: true,
    createdAt: nowIso(),
  };
  const slots: PtmSlot[] = [0, 1, 2, 3, 4].map((i) => {
    const h = 10;
    const m = i * 15;
    const start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const endM = m + 15;
    const end =
      endM >= 60
        ? `${String(h + 1).padStart(2, "0")}:${String(endM - 60).padStart(2, "0")}`
        : `${String(h).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    return {
      id: nid("ptms"),
      eventId,
      teacherStaffId: staff?.id || "",
      teacherName: staff?.fullName || "Class teacher",
      startAt: start,
      endAt: end,
      capacity: 1,
      roomOrLink: "Room 12",
    };
  });
  const next = { ...existing, events: [event], slots };
  savePtm(next);
  return next;
}

export function updatePtmEvent(input: {
  id: string;
  name: string;
  date: string;
  endDate?: string;
  classIds: string[];
  mode: PtmMode;
  note?: string;
  isActive?: boolean;
}): { ok: true; event: PtmEvent } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Name required" };
  if (!input.date) return { ok: false, error: "Date required" };
  if (!input.classIds.length) {
    return { ok: false, error: "Select at least one class" };
  }
  const state = loadPtm();
  const i = state.events.findIndex((e) => e.id === input.id);
  if (i < 0) return { ok: false, error: "Event not found" };
  const prev = state.events[i]!;
  const event: PtmEvent = {
    ...prev,
    name: input.name.trim(),
    date: input.date,
    endDate: input.endDate || input.date,
    classIds: input.classIds,
    mode: input.mode,
    note: input.note || "",
    isActive: input.isActive ?? prev.isActive,
  };
  const events = [...state.events];
  events[i] = event;
  savePtm({ ...state, events });
  return { ok: true, event };
}

export function deletePtmEvent(
  eventId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadPtm();
  if (!state.events.some((e) => e.id === eventId)) {
    return { ok: false, error: "Event not found" };
  }
  const hasActiveBookings = state.bookings.some(
    (b) =>
      b.eventId === eventId &&
      (b.status === "booked" || b.status === "completed"),
  );
  if (hasActiveBookings) {
    return {
      ok: false,
      error: "Cancel or complete all bookings before deleting this event",
    };
  }
  savePtm({
    ...state,
    events: state.events.filter((e) => e.id !== eventId),
    slots: state.slots.filter((s) => s.eventId !== eventId),
    bookings: state.bookings.filter((b) => b.eventId !== eventId),
    feedback: state.feedback.filter((f) => {
      const booking = state.bookings.find((b) => b.id === f.bookingId);
      return booking?.eventId !== eventId;
    }),
  });
  return { ok: true };
}

export function deletePtmSlot(
  slotId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadPtm();
  const slot = state.slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: "Slot not found" };
  const booked = state.bookings.some(
    (b) =>
      b.slotId === slotId &&
      (b.status === "booked" || b.status === "completed"),
  );
  if (booked) {
    return {
      ok: false,
      error: "Slot has active bookings — cancel them first",
    };
  }
  savePtm({
    ...state,
    slots: state.slots.filter((s) => s.id !== slotId),
    bookings: state.bookings.filter((b) => b.slotId !== slotId),
  });
  return { ok: true };
}

export function createPtmEvent(input: {
  academicYearCode: string;
  name: string;
  date: string;
  endDate?: string;
  classIds: string[];
  mode: PtmMode;
  note?: string;
}): { ok: true; event: PtmEvent } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Name required" };
  if (!input.date) return { ok: false, error: "Date required" };
  if (!input.classIds.length) return { ok: false, error: "Select at least one class" };
  const state = loadPtm();
  const event: PtmEvent = {
    id: nid("ptme"),
    academicYearCode: input.academicYearCode,
    name: input.name.trim(),
    date: input.date,
    endDate: input.endDate || input.date,
    classIds: input.classIds,
    mode: input.mode,
    note: input.note || "",
    isActive: true,
    createdAt: nowIso(),
  };
  savePtm({ ...state, events: [event, ...state.events] });
  return { ok: true, event };
}

export function addPtmSlots(input: {
  eventId: string;
  teacherStaffId: string;
  teacherName: string;
  /** e.g. ["10:00","10:15","10:30"] */
  starts: string[];
  durationMinutes?: number;
  capacity?: number;
  roomOrLink?: string;
}): { ok: true; slots: PtmSlot[] } | { ok: false; error: string } {
  const state = loadPtm();
  if (!state.events.some((e) => e.id === input.eventId)) {
    return { ok: false, error: "Event not found" };
  }
  if (!input.starts.length) return { ok: false, error: "Add at least one start time" };
  const dur = input.durationMinutes ?? 15;
  const created: PtmSlot[] = input.starts.map((startAt) => {
    const [hh, mm] = startAt.split(":").map(Number);
    const total = (hh || 0) * 60 + (mm || 0) + dur;
    const endAt = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    return {
      id: nid("ptms"),
      eventId: input.eventId,
      teacherStaffId: input.teacherStaffId,
      teacherName: input.teacherName,
      startAt,
      endAt,
      capacity: input.capacity ?? 1,
      roomOrLink: input.roomOrLink || "",
    };
  });
  savePtm({ ...state, slots: [...created, ...state.slots] });
  return { ok: true, slots: created };
}

export function slotBookedCount(
  state: PtmState,
  slotId: string,
): number {
  return state.bookings.filter(
    (b) => b.slotId === slotId && (b.status === "booked" || b.status === "completed"),
  ).length;
}

export function activeBookingForStudent(
  state: PtmState,
  eventId: string,
  studentId: string,
): PtmBooking | undefined {
  return state.bookings.find(
    (b) =>
      b.eventId === eventId &&
      b.studentId === studentId &&
      (b.status === "booked" || b.status === "completed"),
  );
}

export function bookPtmSlot(input: {
  eventId: string;
  slotId: string;
  studentId: string;
  parentName: string;
  householdId: string;
}): { ok: true; booking: PtmBooking } | { ok: false; error: string } {
  const state = loadPtm();
  const event = state.events.find((e) => e.id === input.eventId);
  const slot = state.slots.find((s) => s.id === input.slotId);
  if (!event || !event.isActive) return { ok: false, error: "PTM event not found" };
  if (!slot || slot.eventId !== input.eventId) {
    return { ok: false, error: "Slot not found" };
  }
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  if (
    event.classIds.length &&
    !event.classIds.includes(student.classId)
  ) {
    return { ok: false, error: "Student class not included in this PTM" };
  }
  if (activeBookingForStudent(state, input.eventId, input.studentId)) {
    return {
      ok: false,
      error: "Already booked for this PTM — cancel first to reschedule",
    };
  }
  if (slotBookedCount(state, input.slotId) >= slot.capacity) {
    return { ok: false, error: "Slot full" };
  }
  const booking: PtmBooking = {
    id: nid("ptmb"),
    eventId: input.eventId,
    slotId: input.slotId,
    studentId: input.studentId,
    parentName: input.parentName,
    householdId: input.householdId,
    status: "booked",
    bookedAt: nowIso(),
  };
  savePtm({ ...state, bookings: [booking, ...state.bookings] });
  return { ok: true, booking };
}

export function cancelPtmBooking(
  bookingId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadPtm();
  const i = state.bookings.findIndex((b) => b.id === bookingId);
  if (i < 0) return { ok: false, error: "Booking not found" };
  const bookings = [...state.bookings];
  bookings[i] = { ...bookings[i], status: "cancelled" };
  savePtm({ ...state, bookings });
  return { ok: true };
}

export function setPtmBookingStatus(
  bookingId: string,
  status: PtmBookingStatus,
): { ok: true } | { ok: false; error: string } {
  const state = loadPtm();
  const i = state.bookings.findIndex((b) => b.id === bookingId);
  if (i < 0) return { ok: false, error: "Booking not found" };
  const bookings = [...state.bookings];
  bookings[i] = { ...bookings[i], status };
  savePtm({ ...state, bookings });
  return { ok: true };
}

export function savePtmFeedback(input: {
  bookingId: string;
  studentId: string;
  strengths: string;
  areas: string;
  followUp: string;
  createdBy: string;
}): { ok: true; feedback: PtmFeedback } | { ok: false; error: string } {
  const state = loadPtm();
  if (!state.bookings.some((b) => b.id === input.bookingId)) {
    return { ok: false, error: "Booking not found" };
  }
  const feedback: PtmFeedback = {
    id: nid("ptmf"),
    bookingId: input.bookingId,
    studentId: input.studentId,
    strengths: input.strengths,
    areas: input.areas,
    followUp: input.followUp,
    createdAt: nowIso(),
    createdBy: input.createdBy,
  };
  savePtm({ ...state, feedback: [feedback, ...state.feedback] });
  setPtmBookingStatus(input.bookingId, "completed");
  return { ok: true, feedback };
}

export function modeLabel(mode: PtmMode): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}

export function composeWhatsAppPtmConfirm(input: {
  childName: string;
  eventName: string;
  date: string;
  startAt: string;
  teacherName: string;
  roomOrLink: string;
}): string {
  return [
    `*${TENANT.shortName}*`,
    `PTM booked`,
    "",
    `${input.childName}`,
    `${input.eventName} · ${input.date} ${input.startAt}`,
    `With: ${input.teacherName}`,
    input.roomOrLink ? `Where: ${input.roomOrLink}` : "",
    "",
    "Please arrive 5 minutes early. Thank you.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeWhatsAppPtmReminder(input: {
  childName: string;
  eventName: string;
  date: string;
  startAt: string;
  teacherName: string;
  roomOrLink: string;
}): string {
  return [
    `*${TENANT.shortName}*`,
    `PTM reminder`,
    "",
    `${input.childName} — please join tomorrow/today`,
    `${input.eventName} · ${input.date} ${input.startAt}`,
    `With: ${input.teacherName}`,
    input.roomOrLink ? `Where: ${input.roomOrLink}` : "",
    "",
    "See you soon.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ptmBookingMobile(
  booking: PtmBooking,
  sis?: ReturnType<typeof loadSis>,
): string {
  const state = sis ?? loadSis();
  const hh = state.households.find((h) => h.id === booking.householdId);
  return householdWhatsApp(hh) || "";
}

export function markPtmWhatsApp(
  bookingId: string,
  kind: "confirmed" | "reminded",
): void {
  const state = loadPtm();
  const i = state.bookings.findIndex((b) => b.id === bookingId);
  if (i < 0) return;
  const bookings = [...state.bookings];
  const patch =
    kind === "confirmed"
      ? { whatsappConfirmedAt: nowIso() }
      : { whatsappRemindedAt: nowIso() };
  bookings[i] = { ...bookings[i], ...patch };
  savePtm({ ...state, bookings });
}

export type PtmReportId = "bookings_register" | "slot_fill" | "feedback_list";

export const PTM_REPORTS: { id: PtmReportId; label: string; hint?: string }[] = [
  { id: "bookings_register", label: "Bookings register", hint: "All bookings for event" },
  { id: "slot_fill", label: "Slot fill rate", hint: "Booked vs capacity" },
  { id: "feedback_list", label: "Feedback list", hint: "Strengths / areas / follow-up" },
];

export function runPtmReport(
  id: PtmReportId,
  filters: {
    eventId?: string;
    format: "excel" | "pdf";
    ptm?: PtmState;
    masters?: MastersState;
    students?: SisStudent[];
  },
): { ok: true; message: string } | { ok: false; error: string } {
  const ptm = filters.ptm ?? loadPtm();
  const masters = filters.masters ?? loadMasters();
  const sis = loadSis();
  const students = filters.students ?? sis.students;
  const event = filters.eventId
    ? ptm.events.find((e) => e.id === filters.eventId)
    : ptm.events[0];
  const note = describeFilters([
    event ? `Event ${event.name}` : "All events",
  ]);

  function nameOf(id: string) {
    return students.find((s) => s.id === id)?.fullName || id;
  }
  function classOf(id: string) {
    const s = students.find((x) => x.id === id);
    if (!s) return "";
    const c = masters.classes.find((x) => x.id === s.classId);
    const sec = masters.sections.find((x) => x.id === s.sectionId);
    return [c?.name, sec?.name].filter(Boolean).join(" · ");
  }

  switch (id) {
    case "bookings_register": {
      const rows = ptm.bookings
        .filter((b) => !event || b.eventId === event.id)
        .map((b) => {
          const slot = ptm.slots.find((s) => s.id === b.slotId);
          return {
            student: nameOf(b.studentId),
            class: classOf(b.studentId),
            parent: b.parentName,
            time: slot ? `${slot.startAt}–${slot.endAt}` : "",
            teacher: slot?.teacherName || "",
            status: b.status,
          };
        });
      const cols: ReportColumn[] = [
        { key: "student", header: "Student" },
        { key: "class", header: "Class" },
        { key: "parent", header: "Parent" },
        { key: "time", header: "Slot" },
        { key: "teacher", header: "Teacher" },
        { key: "status", header: "Status" },
      ];
      const r = exportFilterReport(
        {
          title: "PTM bookings",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: cols,
          rows,
          fileBaseName: "ptm_bookings",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Bookings: ${rows.length} row(s)` }
        : r;
    }
    case "slot_fill": {
      const slots = ptm.slots.filter((s) => !event || s.eventId === event.id);
      const rows = slots.map((s) => {
        const booked = slotBookedCount(ptm, s.id);
        return {
          teacher: s.teacherName,
          time: `${s.startAt}–${s.endAt}`,
          booked,
          capacity: s.capacity,
          pct: s.capacity
            ? `${Math.round((booked / s.capacity) * 100)}%`
            : "—",
        };
      });
      const r = exportFilterReport(
        {
          title: "PTM slot fill",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: [
            { key: "teacher", header: "Teacher" },
            { key: "time", header: "Slot" },
            { key: "booked", header: "Booked", align: "right" },
            { key: "capacity", header: "Capacity", align: "right" },
            { key: "pct", header: "Fill %", align: "right" },
          ],
          rows,
          fileBaseName: "ptm_slot_fill",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Slots: ${rows.length} row(s)` }
        : r;
    }
    case "feedback_list": {
      const rows = ptm.feedback.map((f) => ({
        student: nameOf(f.studentId),
        strengths: f.strengths,
        areas: f.areas,
        followUp: f.followUp,
        by: f.createdBy,
        at: f.createdAt.slice(0, 10),
      }));
      const r = exportFilterReport(
        {
          title: "PTM feedback",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: [
            { key: "student", header: "Student" },
            { key: "strengths", header: "Strengths" },
            { key: "areas", header: "Areas" },
            { key: "followUp", header: "Follow-up" },
            { key: "by", header: "By" },
            { key: "at", header: "Date" },
          ],
          rows,
          fileBaseName: "ptm_feedback",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Feedback: ${rows.length} row(s)` }
        : r;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}
