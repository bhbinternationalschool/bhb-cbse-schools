/**
 * Run: npx tsx src/lib/events.selftest.ts
 *
 * Exercises only the pure logic:
 * - listUpcomingCalendarItems() — merges holidays/exam datesheet/PTM events/
 *   school events into one range-filtered, sorted list. Fee-due aggregation
 *   is exercised live (it depends on the fee-engine's full masters/fees
 *   shape) rather than with a fixture here.
 * - buildEventRsvpButtonId()/parseEventRsvpButtonId() — the WA button-id
 *   round trip the inbound webhook guard clause depends on.
 */
import assert from "node:assert/strict";

import {
  buildEventRsvpButtonId,
  listUpcomingCalendarItems,
  parseEventRsvpButtonId,
  type SchoolEvent,
} from "./events";
import { defaultExamPolicy, type ExamsState } from "./exams";
import type { MastersState } from "./masters";
import type { PtmState } from "./ptm";
import type { SisState } from "./sis";
import type { FeesState } from "./fees";
import type { Holiday } from "./foundationMasters";

console.log("events.selftest.ts");

const sis: SisState = {
  version: 1,
  households: [],
  students: [],
  curriculumRequests: [],
  tags: [],
  classUpgrades: [],
};
const fees = {} as FeesState; // never dereferenced — sis.students is empty
const masters = { holidays: [] as Holiday[] } as unknown as MastersState;

function holiday(over: Partial<Holiday>): Holiday {
  return {
    id: "hol-1",
    academicYearCode: "2026-27",
    title: "Diwali",
    startsOn: "2026-08-10",
    endsOn: "2026-08-10",
    kind: "school",
    scope: "school",
    groupCode: "",
    classIds: [],
    appliesTo: "everyone",
    mode: "one_off",
    weekday: null,
    dayType: "full",
    paidForStaff: true,
    exceptionDates: [],
    workingOverride: false,
    isPublished: true,
    publishedAt: null,
    publishedBy: "",
    note: "",
    ...over,
  };
}

const examsState: ExamsState = {
  version: 1,
  terms: [
    {
      id: "term-1",
      code: "HY",
      label: "Half Yearly",
      academicYearCode: "2026-27",
      maxMarks: 100,
      sortOrder: 1,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: true,
      countsTowardFinal: false,
      weightInHy: 1,
      weightInFinal: 0,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: false,
    },
  ],
  subjects: [
    { id: "sub-1", code: "MATH", name: "Mathematics", classIds: [], maxMarks: 100, sortOrder: 1, isActive: true },
  ],
  dateSheet: [
    {
      id: "ds-1",
      academicYearCode: "2026-27",
      examTermId: "term-1",
      classId: "class-9",
      subjectId: "sub-1",
      date: "2026-08-12",
      startTime: "09:00",
      durationMinutes: 90,
      note: "",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  sheets: [],
  policy: defaultExamPolicy(),
  promotions: [],
};

const ptmState: PtmState = {
  version: 1,
  events: [
    {
      id: "ptm-1",
      academicYearCode: "2026-27",
      name: "Term 1 PTM",
      date: "2026-08-14",
      endDate: "2026-08-14",
      classIds: [],
      mode: "in_person",
      note: "",
      isActive: true,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  slots: [],
  bookings: [],
  feedback: [],
};

const schoolEvents: SchoolEvent[] = [
  {
    id: "evt_1",
    academicYearCode: "2026-27",
    title: "Annual Day",
    description: "",
    kind: "function",
    startsOn: "2026-08-15",
    endsOn: "2026-08-15",
    startTime: "17:00",
    location: "Auditorium",
    classIds: [],
    rsvpEnabled: true,
    isActive: true,
    createdBy: "office",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "evt_2",
    academicYearCode: "2026-27",
    title: "Inactive event (must be excluded)",
    description: "",
    kind: "other",
    startsOn: "2026-08-13",
    endsOn: "2026-08-13",
    startTime: "",
    location: "",
    classIds: [],
    rsvpEnabled: false,
    isActive: false,
    createdBy: "office",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "evt_3",
    academicYearCode: "2025-26",
    title: "Wrong-year event (must be excluded)",
    description: "",
    kind: "other",
    startsOn: "2026-08-13",
    endsOn: "2026-08-13",
    startTime: "",
    location: "",
    classIds: [],
    rsvpEnabled: false,
    isActive: true,
    createdBy: "office",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "evt_4",
    academicYearCode: "2026-27",
    title: "Out-of-range event (must be excluded)",
    description: "",
    kind: "other",
    startsOn: "2026-09-30",
    endsOn: "2026-09-30",
    startTime: "",
    location: "",
    classIds: [],
    rsvpEnabled: false,
    isActive: true,
    createdBy: "office",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

const range = { from: "2026-08-10", to: "2026-08-20", academicYearCode: "2026-27" };

// --- merges all four sources + events, sorted by date ----------------------
{
  const items = listUpcomingCalendarItems({
    ...range,
    masters: { holidays: [holiday({})] } as unknown as MastersState,
    sis,
    fees,
    examsState,
    ptmState,
    events: schoolEvents,
  });
  assert.deepEqual(
    items.map((i) => i.kind),
    ["holiday", "exam", "ptm", "event"],
    "one item per in-range source, sorted by date (holiday 10th, exam 12th, ptm 14th, event 15th)",
  );
  assert.deepEqual(items.map((i) => i.date), [
    "2026-08-10",
    "2026-08-12",
    "2026-08-14",
    "2026-08-15",
  ]);
  const exam = items.find((i) => i.kind === "exam")!;
  assert.equal(exam.title, "Mathematics exam");
  assert.equal(exam.detail, "Half Yearly");
}

// --- inactive / wrong-year / out-of-range events are excluded --------------
{
  const items = listUpcomingCalendarItems({
    ...range,
    masters,
    sis,
    fees,
    examsState: { ...examsState, dateSheet: [] },
    ptmState: { ...ptmState, events: [] },
    events: schoolEvents,
  });
  assert.deepEqual(items.map((i) => i.id), ["event:evt_1"]);
}

// --- a holiday entirely outside the range is excluded -----------------------
{
  const items = listUpcomingCalendarItems({
    ...range,
    masters: { holidays: [holiday({ startsOn: "2026-01-01", endsOn: "2026-01-01" })] } as unknown as MastersState,
    sis,
    fees,
    examsState: { ...examsState, dateSheet: [] },
    ptmState: { ...ptmState, events: [] },
    events: [],
  });
  assert.deepEqual(items, []);
}

// --- empty range across all sources -> empty output, not a crash -----------
{
  const items = listUpcomingCalendarItems({
    from: "2030-01-01",
    to: "2030-01-31",
    academicYearCode: "2026-27",
    masters,
    sis,
    fees,
    examsState: { ...examsState, dateSheet: [] },
    ptmState: { ...ptmState, events: [] },
    events: [],
  });
  assert.deepEqual(items, []);
}

// --- RSVP button id round trip ----------------------------------------------
{
  const id = buildEventRsvpButtonId("evt_ab12cd34", "hh_xy98zw76", "yes");
  assert.equal(id, "evt_rsvp_evt_ab12cd34|hh_xy98zw76|yes");
  const parsed = parseEventRsvpButtonId(id);
  assert.deepEqual(parsed, {
    eventId: "evt_ab12cd34",
    householdId: "hh_xy98zw76",
    choice: "yes",
  });
}

// --- round trip survives a household id that itself contains underscores ---
// (the whole reason for "|"-joining instead of "_"-joining: imported
// households can carry arbitrary codes, not just this app's own nid() shape)
{
  const id = buildEventRsvpButtonId("evt_1", "hh_import_2024_003", "maybe");
  const parsed = parseEventRsvpButtonId(id);
  assert.deepEqual(parsed, {
    eventId: "evt_1",
    householdId: "hh_import_2024_003",
    choice: "maybe",
  });
}

// --- ids that aren't RSVP button ids parse to null, not a throw ------------
{
  assert.equal(parseEventRsvpButtonId("menu_main"), null);
  assert.equal(parseEventRsvpButtonId(""), null);
  assert.equal(parseEventRsvpButtonId("evt_rsvp_missing_pipes"), null);
  assert.equal(parseEventRsvpButtonId("evt_rsvp_evt_1|hh_1|not_a_choice"), null);
}

console.log("OK — events.selftest.ts");
