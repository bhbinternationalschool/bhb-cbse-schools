/**
 * Run: npx tsx src/lib/studentTransport.selftest.ts
 *
 * The two answers this record must never blur:
 *   * a SUSPENDED seat is not a cancelled one — the child is still on the
 *     list and must not be let on the bus;
 *   * an unmarked bus register is not a child who failed to board.
 */
import assert from "node:assert/strict";
import type { TransportAssignment, TransportState } from "./transport";
import {
  studentTransportRecord,
  transportRecordIsEmpty,
} from "./studentTransport";

console.log("studentTransport.selftest.ts");

const AY = "2026-27";
const TODAY = "2026-09-11";

function asg(p: Partial<TransportAssignment>): TransportAssignment {
  return {
    id: "a1",
    studentId: "st1",
    householdId: "hh1",
    routeId: "r1",
    stopId: "s1",
    academicYearCode: AY,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    serviceMode: "both",
    monthlyFeePaise: 0,
    feeOverrideReason: "",
    boardingSuspended: false,
    createdAt: "2026-04-01T05:00:00.000Z",
    ...p,
  };
}

function state(p: Partial<TransportState>): TransportState {
  return {
    routes: [
      {
        id: "r1",
        code: "R3",
        name: "Gandhi Chowk – School",
        busNo: "UP70 AB 1234",
        vehicleReg: "",
        vehicleId: "",
        isActive: true,
        stops: [
          {
            id: "s1",
            name: "Gandhi Chowk",
            sequence: 1,
            distanceKm: 4,
            distanceSource: "manual",
            monthlyFeePaise: 90000,
          },
          {
            id: "s2",
            name: "Civil Lines",
            sequence: 2,
            distanceKm: 2,
            distanceSource: "manual",
            monthlyFeePaise: 70000,
          },
        ],
      },
    ],
    assignments: [],
    boardingEvents: [],
    ...p,
  } as unknown as TransportState;
}

const student = { id: "st1", academicYearCode: AY };

// --- a child who has nothing to do with the bus ------------------------
{
  const r = studentTransportRecord(state({}), student, { today: TODAY });
  assert.equal(r.seat, null);
  assert.equal(r.boardedRate, null, "no register → no rate, never 0%");
  assert.ok(transportRecordIsEmpty(r), "the profile shows no card at all");
}

// --- the seat in force, named properly ---------------------------------
{
  const r = studentTransportRecord(
    state({ assignments: [asg({})] }),
    student,
    { today: TODAY },
  );
  assert.ok(r.seat);
  assert.equal(r.seat.routeName, "Gandhi Chowk – School");
  assert.equal(r.seat.stopName, "Gandhi Chowk");
  assert.equal(r.seat.busNo, "UP70 AB 1234");
  assert.equal(r.seat.serviceLabel, "Both ways");
  assert.equal(r.seat.monthlyFeePaise, 90000, "stop price when no override");
  assert.equal(r.seat.current, true);
  assert.equal(r.seat.suspended, false);
  assert.equal(r.past.length, 0);
}

// --- suspended is still assigned, and must say so ----------------------
{
  const r = studentTransportRecord(
    state({ assignments: [asg({ boardingSuspended: true })] }),
    student,
    { today: TODAY },
  );
  assert.equal(r.seat?.current, true, "the seat is still theirs");
  assert.equal(
    r.seat?.suspended,
    true,
    "and the attendant must not let them on",
  );
}

// --- an unresolved stop is named as missing, never guessed -------------
{
  const r = studentTransportRecord(
    state({ assignments: [asg({ stopId: "gone" })] }),
    student,
    { today: TODAY },
  );
  assert.match(
    r.seat?.stopName || "",
    /not on this route/,
    "the desk once fell back to the route's first stop and billed for it",
  );
  assert.equal(r.seat?.monthlyFeePaise, 0, "and no price is invented either");
}

// --- a changed stop mid-year: newest seat wins, old one kept -----------
{
  const r = studentTransportRecord(
    state({
      assignments: [
        asg({
          id: "old",
          stopId: "s2",
          effectiveFrom: "2026-04-01",
          effectiveTo: "2026-07-31",
        }),
        asg({
          id: "new",
          stopId: "s1",
          effectiveFrom: "2026-08-01",
          createdAt: "2026-08-01T05:00:00.000Z",
        }),
      ],
    }),
    student,
    { today: TODAY },
  );
  assert.equal(r.seat?.assignment.id, "new");
  assert.equal(r.seat?.stopName, "Gandhi Chowk");
  assert.deepEqual(
    r.past.map((s) => s.assignment.id),
    ["old"],
  );
  assert.equal(r.past[0]?.current, false);
}

// --- a seat that ended: still the answer to "did they come by bus?" ----
{
  const r = studentTransportRecord(
    state({
      assignments: [asg({ effectiveTo: "2026-08-31", serviceMode: "pickup" })],
    }),
    student,
    { today: TODAY },
  );
  assert.equal(r.seat?.current, false, "not in force today");
  assert.ok(r.seat, "but still shown — the seat was real");
  assert.equal(r.seat?.serviceLabel, "Pickup only");
}

// --- boarding counts, and the safety one -------------------------------
{
  const ev = (
    date: string,
    trip: "AM" | "PM",
    status: "boarded" | "absent" | "unauthorized",
  ) => ({
    id: `${date}${trip}`,
    date,
    routeId: "r1",
    trip,
    studentId: "st1",
    status,
    note: "",
    createdAt: `${date}T03:00:00.000Z`,
  });
  const r = studentTransportRecord(
    state({
      assignments: [asg({})],
      boardingEvents: [
        ev("2026-09-09", "AM", "boarded"),
        ev("2026-09-09", "PM", "boarded"),
        ev("2026-09-10", "AM", "absent"),
        ev("2026-09-10", "PM", "unauthorized"),
        // Another child's event must not land on this record.
        { ...ev("2026-09-10", "AM", "boarded"), id: "x", studentId: "st9" },
      ],
    }),
    student,
    { today: TODAY },
  );
  assert.equal(r.marked, 4, "four events for this child");
  assert.equal(r.boarded, 2);
  assert.equal(r.absent, 1);
  assert.equal(r.unauthorized, 1, "got on a bus that was not theirs");
  assert.equal(r.boardedRate, 50);
  assert.equal(r.lastSeenOnBus, "2026-09-09");
  assert.deepEqual(
    r.events.map((e) => `${e.date}${e.trip}`),
    ["2026-09-10PM", "2026-09-10AM", "2026-09-09PM", "2026-09-09AM"],
    "newest first, PM before AM within a day",
  );
  assert.equal(transportRecordIsEmpty(r), false);
}

// --- last year's seat stays out ----------------------------------------
{
  const r = studentTransportRecord(
    state({ assignments: [asg({ academicYearCode: "2025-26" })] }),
    student,
    { today: TODAY },
  );
  assert.equal(r.seat, null, "this session only");
}

console.log("  all student-transport assertions passed");
