/**
 * Events & academic calendar (Phase 6) — school-authored events with WhatsApp
 * RSVP, plus a unified "what's coming up" merge across the four data sources
 * that were fragmented before this module: holidays, exam datesheet, PTM
 * events and fee due dates. Events/RSVPs are server-authoritative (Supabase
 * `school_events` / `event_rsvps`) — the WA webhook that records an RSVP has
 * no access to browser localStorage, so unlike most modules here there is no
 * local-first desk-sync layer for these two tables.
 */
import type { MastersState } from "@/lib/masters";
import { formatInr } from "@/lib/masters";
import { previewHolidayDates } from "@/lib/holidayPolicy";
import { listExamDateSheet, type ExamsState } from "@/lib/exams";
import type { PtmState } from "@/lib/ptm";
import { computeStudentDues, type FeesState } from "@/lib/fees";
import type { SisState } from "@/lib/sis";

export type EventKind = "function" | "sports_day" | "trip" | "other";

export const EVENT_KINDS: { id: EventKind; label: string }[] = [
  { id: "function", label: "Function / celebration" },
  { id: "sports_day", label: "Sports day" },
  { id: "trip", label: "Trip / excursion" },
  { id: "other", label: "Other" },
];

export function eventKindLabel(kind: EventKind): string {
  return EVENT_KINDS.find((k) => k.id === kind)?.label ?? "Event";
}

export type SchoolEvent = {
  id: string;
  academicYearCode: string;
  title: string;
  description: string;
  kind: EventKind;
  startsOn: string; // ISO yyyy-mm-dd
  endsOn: string; // ISO yyyy-mm-dd
  startTime: string;
  location: string;
  classIds: string[];
  rsvpEnabled: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RsvpChoice = "yes" | "no" | "maybe";

export type EventRsvp = {
  id: string; // `${eventId}:${householdId}`
  eventId: string;
  householdId: string;
  choice: RsvpChoice | null;
  respondedAt: string | null;
  remindedAt: string | null;
  updatedAt: string;
};

export function normalizeEventKind(v: unknown): EventKind {
  return EVENT_KINDS.some((k) => k.id === v) ? (v as EventKind) : "other";
}

export function normalizeRsvpChoice(v: unknown): RsvpChoice | null {
  return v === "yes" || v === "no" || v === "maybe" ? v : null;
}

/**
 * Build the WA button id for an RSVP option. Household ids aren't always
 * this app's own `nid()` shape (imported households can carry arbitrary
 * codes with their own underscores), so eventId/householdId are "|"-joined
 * rather than "_"-joined — a plain `_`-split would be ambiguous the moment
 * either id itself contains an underscore. The `evt_rsvp_` prefix stays the
 * cheap, cheap-to-check marker the inbound-webhook guard clause looks for.
 */
export function buildEventRsvpButtonId(
  eventId: string,
  householdId: string,
  choice: RsvpChoice,
): string {
  return `evt_rsvp_${eventId}|${householdId}|${choice}`;
}

/** Parse a WA button id back into its parts. See buildEventRsvpButtonId. */
export function parseEventRsvpButtonId(
  id: string,
): { eventId: string; householdId: string; choice: RsvpChoice } | null {
  if (!id.startsWith("evt_rsvp_")) return null;
  const rest = id.slice("evt_rsvp_".length);
  const parts = rest.split("|");
  if (parts.length !== 3) return null;
  const [eventId, householdId, choiceRaw] = parts;
  const choice = normalizeRsvpChoice(choiceRaw);
  if (!eventId || !householdId || !choice) return null;
  return { eventId, householdId, choice };
}

export type CalendarItemKind = "holiday" | "exam" | "ptm" | "fee_due" | "event";

export type CalendarItem = {
  id: string;
  kind: CalendarItemKind;
  title: string;
  date: string; // ISO yyyy-mm-dd — start date, used for sorting/grouping
  endDate?: string;
  detail: string;
  href: string;
};

function inRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

function rangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Merge holidays, exam datesheet, PTM events, fee due dates and school
 * events into one sorted list within [from, to] (inclusive, ISO dates).
 * Pure — every source is passed in already-loaded so this stays testable
 * with fixtures and the caller controls where each source comes from.
 */
export function listUpcomingCalendarItems(input: {
  from: string;
  to: string;
  academicYearCode: string;
  masters: MastersState;
  sis: SisState;
  fees: FeesState;
  examsState: ExamsState;
  ptmState: PtmState;
  events: SchoolEvent[];
}): CalendarItem[] {
  const { from, to, academicYearCode, masters, sis, fees, examsState, ptmState, events } =
    input;
  const items: CalendarItem[] = [];

  for (const h of masters.holidays ?? []) {
    if (h.academicYearCode && h.academicYearCode !== academicYearCode) continue;
    // Generous cap: covers well over a year of weekly occurrences so a
    // holiday defined at session-start isn't truncated before it reaches
    // whatever range is being viewed.
    for (const iso of previewHolidayDates(h, 400)) {
      if (!inRange(iso, from, to)) continue;
      items.push({
        id: `holiday:${h.id}:${iso}`,
        kind: "holiday",
        title: h.title || "Holiday",
        date: iso,
        detail: "Holiday",
        href: "/masters?tab=policies",
      });
    }
  }

  for (const entry of listExamDateSheet(academicYearCode, undefined, examsState)) {
    if (!inRange(entry.date, from, to)) continue;
    const term = examsState.terms.find((t) => t.id === entry.examTermId);
    const subject = examsState.subjects.find((s) => s.id === entry.subjectId);
    items.push({
      id: `exam:${entry.id}`,
      kind: "exam",
      title: subject?.name ? `${subject.name} exam` : "Exam",
      date: entry.date,
      detail: term?.label ?? "",
      href: "/exams?tab=datesheet",
    });
  }

  for (const e of ptmState.events) {
    if (e.academicYearCode !== academicYearCode || !e.isActive) continue;
    const endDate = e.endDate || e.date;
    if (!rangesOverlap(e.date, endDate, from, to)) continue;
    items.push({
      id: `ptm:${e.id}`,
      kind: "ptm",
      title: e.name || "Parent-teacher meeting",
      date: e.date,
      endDate: endDate !== e.date ? endDate : undefined,
      detail: "PTM",
      href: "/ptm",
    });
  }

  const feeDueTotals = new Map<string, { count: number; totalPaise: number }>();
  for (const student of sis.students) {
    if (student.status !== "active") continue;
    const dues = computeStudentDues(student, masters, fees, { includeFuture: true });
    for (const d of dues) {
      if (d.balancePaise <= 0) continue;
      if (!inRange(d.dueOn, from, to)) continue;
      const agg = feeDueTotals.get(d.dueOn) ?? { count: 0, totalPaise: 0 };
      agg.count += 1;
      agg.totalPaise += d.balancePaise;
      feeDueTotals.set(d.dueOn, agg);
    }
  }
  for (const [dueOn, agg] of feeDueTotals) {
    items.push({
      id: `fee_due:${dueOn}`,
      kind: "fee_due",
      title: `Fees due — ${agg.count} student${agg.count === 1 ? "" : "s"}`,
      date: dueOn,
      detail: formatInr(agg.totalPaise),
      href: "/fees/defaulters",
    });
  }

  for (const e of events) {
    if (e.academicYearCode !== academicYearCode || !e.isActive) continue;
    if (!rangesOverlap(e.startsOn, e.endsOn, from, to)) continue;
    items.push({
      id: `event:${e.id}`,
      kind: "event",
      title: e.title,
      date: e.startsOn,
      endDate: e.endsOn !== e.startsOn ? e.endsOn : undefined,
      detail: eventKindLabel(e.kind),
      href: "/events?tab=events",
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Client-side cache of the last successful events/RSVP fetch — events are
 * server-authoritative (no localStorage store), so unlike every other
 * module's loadX() this has nothing to read until a workspace has fetched
 * at least once in this session. Dashboard tiles degrade to zero, not an
 * error, until then. */
let clientEventsCache: SchoolEvent[] = [];
let clientRsvpsCache: EventRsvp[] = [];

export function setEventsClientCache(events: SchoolEvent[], rsvps: EventRsvp[]): void {
  clientEventsCache = events;
  clientRsvpsCache = rsvps;
}

export function getEventsClientCache(): SchoolEvent[] {
  return clientEventsCache;
}

export function getRsvpsClientCache(): EventRsvp[] {
  return clientRsvpsCache;
}
