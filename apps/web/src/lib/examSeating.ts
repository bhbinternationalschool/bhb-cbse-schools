/**
 * Exam seating — rooms, benches, and who sits where.
 *
 * The arrangement the school actually uses: a bench seats two or three, and
 * each seat position down a room belongs to ONE class, so a child never sits
 * beside somebody writing the same paper.
 *
 * The rule is about ADJACENCY, not about columns. On a three-seater, seats 1
 * and 2 are neighbours and so are 2 and 3 — but 1 and 3 are not, and a class
 * may hold both of them with a different class in the middle. That is the
 * standard sandwich, and a rule written as "one class per column" would
 * refuse it and waste a third of the hall.
 *
 * And a BENCH never mixes CLASS GROUPS. A six-year-old writing rhymes does
 * not sit beside a Class 8 child writing Science, whatever the anti-copying
 * rule would happily allow. Each group takes a contiguous BLOCK of benches —
 * benches 1–13 Pre-Primary, 14–20 Primary — so a room reads in bands from
 * the door and an invigilator can see at a glance where one group ends.
 *
 * A block, not a whole room: giving each group its own rooms left 48 of this
 * school's 229 children standing with 245 seats in the building, because
 * three groups cannot divide five rooms without waste.
 *
 * Everything here is pure and every number is shown rather than smoothed:
 * this school's classes run from 31 children down to 2, so a room never
 * comes out even, and a seating plan that quietly drops the remainder is a
 * child with nowhere to sit on the morning of a paper.
 */

export type ExamRoom = {
  id: string;
  /** "Room 12", "Hall A" — what is painted on the door. */
  name: string;
  benches: number;
  /** 2 or 3. Rooms differ; this school has both. */
  seatsPerBench: number;
  isActive: boolean;
  note: string;
  sortOrder: number;
};

export type SeatingStudent = {
  id: string;
  classId: string;
  name: string;
  /** Roll number when the office has filled one; "" otherwise. */
  rollNo: string;
  admissionNo: string;
};

export type SeatOccupant = {
  studentId: string;
  classId: string;
  className: string;
  /** "Primary", "Middle" — a bench never mixes two of these. */
  groupLabel: string;
  name: string;
  /** What goes on the slip: the roll number, or the admission number. */
  label: string;
  /** True when the label had to fall back to the admission number. */
  rollMissing: boolean;
};

export type BenchPlan = {
  /** 1-based within its room. */
  number: number;
  seats: (SeatOccupant | null)[];
};

export type RoomPlan = {
  roomId: string;
  roomName: string;
  seatsPerBench: number;
  /** The class groups in this room, in bench order: "Pre-Primary · Primary". */
  groupLabel: string;
  /** Which benches belong to which group — the bands a room reads in. */
  bands: { groupLabel: string; fromBench: number; toBench: number }[];
  benches: BenchPlan[];
};

export type ClassTally = {
  classId: string;
  className: string;
  groupLabel: string;
  total: number;
  seated: number;
  /** Rooms this class ended up spread across, in order. */
  rooms: string[];
};

export type SeatingPlan = {
  rooms: RoomPlan[];
  tallies: ClassTally[];
  /** Children with no seat, named — never a count on its own. */
  unseated: SeatOccupant[];
  /** Seats left empty, and the honest reason. */
  notes: string[];
  capacity: number;
  toSeat: number;
};

export const SEATS_PER_BENCH_ALLOWED = [2, 3];

export function roomCapacity(room: ExamRoom): number {
  return Math.max(0, Math.floor(room.benches)) * Math.max(0, Math.floor(room.seatsPerBench));
}

/**
 * The order children sit in.
 *
 * Roll number first, as every exam hall does it — but a roll number is text
 * in this ERP and 25 of 229 children have none, so it sorts numerically when
 * it can, then by name, and the ones with no roll number go last rather than
 * being scattered through the line under an empty string.
 */
export function seatingOrder(a: SeatingStudent, b: SeatingStudent): number {
  const ra = (a.rollNo || "").trim();
  const rb = (b.rollNo || "").trim();
  if (ra && !rb) return -1;
  if (!ra && rb) return 1;
  if (ra && rb) {
    const na = Number(ra);
    const nb = Number(rb);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (ra !== rb) return ra.localeCompare(rb, undefined, { numeric: true });
  }
  return (a.name || "").localeCompare(b.name || "");
}

function occupantOf(s: SeatingStudent, className: string, groupLabel: string): SeatOccupant {
  const roll = (s.rollNo || "").trim();
  return {
    studentId: s.id,
    classId: s.classId,
    className,
    groupLabel,
    name: s.name,
    label: roll || s.admissionNo || "—",
    rollMissing: !roll,
  };
}

/**
 * Lay the hall out.
 *
 * Down each seat column, a class takes a CONTIGUOUS run of benches — which
 * is what makes a hall readable from the door and an invigilator's sheet
 * worth carrying. When a class runs out part-way down, the column carries on
 * with the next class rather than leaving the rest of it empty: keeping a
 * column pure to one class cost 23 children their seat on this school's real
 * numbers, with 245 seats free, because a class of 12 cannot fill a column
 * of 20 benches.
 *
 * The rule enforced at every seat is the one that matters — the child to the
 * LEFT on the same bench is never from the same class. When the only class
 * with children left is the one already sitting beside a seat, that seat is
 * LEFT EMPTY and said so. An empty seat is a cost the office can see and
 * decide about; two children of one class side by side is the thing the
 * whole arrangement exists to prevent.
 */
export function buildSeatingPlan(input: {
  rooms: ExamRoom[];
  studentsByClass: {
    classId: string;
    className: string;
    /** "Primary", "Middle" — classes only ever share a bench within one. */
    groupLabel: string;
    students: SeatingStudent[];
  }[];
}): SeatingPlan {
  const rooms = input.rooms
    .filter((r) => r.isActive && roomCapacity(r) > 0)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  type Queue = {
    classId: string;
    className: string;
    groupLabel: string;
    total: number;
    queue: SeatingStudent[];
    rooms: string[];
  };
  const queues: Queue[] = input.studentsByClass
    .map((c) => ({
      classId: c.classId,
      className: c.className,
      groupLabel: c.groupLabel,
      total: c.students.length,
      queue: c.students.slice().sort(seatingOrder),
      rooms: [] as string[],
    }))
    .filter((c) => c.total > 0);

  const toSeat = queues.reduce((n, c) => n + c.total, 0);
  const capacity = rooms.reduce((n, r) => n + roomCapacity(r), 0);
  const notes: string[] = [];
  const plans: RoomPlan[] = [];

  // Groups in the order the classes were handed to us — the caller sorts
  // them the way the school reads them (Pre-Primary first).
  const groupOrder: string[] = [];
  for (const q of queues) if (!groupOrder.includes(q.groupLabel)) groupOrder.push(q.groupLabel);

  const remainingOf = (label: string) =>
    queues.filter((q) => q.groupLabel === label).reduce((n, q) => n + q.queue.length, 0);

  for (const room of rooms) {
    if (groupOrder.every((g) => remainingOf(g) === 0)) break;
    const seats = Math.floor(room.seatsPerBench);
    const benches = Math.floor(room.benches);
    const grid: (SeatOccupant | null)[][] = Array.from({ length: benches }, () =>
      new Array<SeatOccupant | null>(seats).fill(null),
    );
    const bands: { groupLabel: string; fromBench: number; toBench: number }[] = [];
    let blocked = 0;
    let bench = 0;

    while (bench < benches) {
      const groupLabel = groupOrder.find((g) => remainingOf(g) > 0);
      if (!groupLabel) break;
      const groupQueues = queues.filter((q) => q.groupLabel === groupLabel);
      // Benches this group still needs, capped by what is left in the room.
      const need = Math.ceil(remainingOf(groupLabel) / seats);
      const blockTo = Math.min(bench + Math.max(1, need), benches);

      for (let col = 0; col < seats; col += 1) {
        // The class running down this column WITHIN the block, so its run
        // stays contiguous rather than interleaving with every other class.
        let running: Queue | null = null;
        for (let b = bench; b < blockTo; b += 1) {
          const left = col > 0 ? grid[b]![col - 1]?.classId ?? null : null;
          let pick: Queue | null =
            running && running.queue.length > 0 && running.classId !== left ? running : null;
          if (!pick) {
            pick =
              groupQueues
                .filter((c) => c.queue.length > 0 && c.classId !== left)
                .sort((a, b2) => b2.queue.length - a.queue.length)[0] ?? null;
          }
          if (!pick) {
            // Either this group is seated, or the only class of it left is
            // the one already beside this seat.
            if (groupQueues.some((c) => c.queue.length > 0)) blocked += 1;
            running = null;
            continue;
          }
          const student = pick.queue.shift()!;
          grid[b]![col] = occupantOf(student, pick.className, pick.groupLabel);
          if (!pick.rooms.includes(room.name)) pick.rooms.push(room.name);
          running = pick;
        }
      }

      // A group can need a second block in the same room (its first was
      // capped by the benches left). "Middle 1–15, Middle 16–16" is two
      // bands only to the code; to anyone reading the room it is one.
      const last = bands[bands.length - 1];
      if (last && last.groupLabel === groupLabel && last.toBench === bench) {
        last.toBench = blockTo;
      } else {
        bands.push({ groupLabel, fromBench: bench + 1, toBench: blockTo });
      }
      bench = blockTo;
    }

    if (blocked > 0) {
      notes.push(
        `${room.name}: ${blocked} seat${blocked === 1 ? "" : "s"} left empty — the only class still to seat in that band would have sat beside itself.`,
      );
    }

    const benchPlans: BenchPlan[] = grid
      .map((row, i) => ({ number: i + 1, seats: row }))
      // A bench nobody sits on is not printed.
      .filter((b2) => b2.seats.some(Boolean));

    if (benchPlans.length > 0) {
      plans.push({
        roomId: room.id,
        roomName: room.name,
        seatsPerBench: seats,
        groupLabel: bands.map((b2) => b2.groupLabel).join(" · "),
        bands,
        benches: benchPlans,
      });
    }
  }

  const unseated: SeatOccupant[] = [];
  for (const c of queues) {
    for (const s of c.queue) unseated.push(occupantOf(s, c.className, c.groupLabel));
  }
  if (unseated.length > 0) {
    const byGroup = [...new Set(unseated.map((u) => u.groupLabel))].join(", ");
    notes.push(
      capacity < toSeat
        ? `${unseated.length} of ${toSeat} children have no seat (${byGroup}) — the rooms hold ${capacity}. Add a room or more benches.`
        : `${unseated.length} children (${byGroup}) could not be seated. A room holds one class group only, so a group needs enough rooms of its own — add one, or move a room to this group.`,
    );
  }

  const tallies: ClassTally[] = queues.map((c) => ({
    classId: c.classId,
    className: c.className,
    groupLabel: c.groupLabel,
    total: c.total,
    seated: c.total - c.queue.length,
    rooms: c.rooms,
  }));

  return { rooms: plans, tallies, unseated, notes, capacity, toSeat };
}

/**
 * Does any bench sit two children of one class next to each other?
 *
 * The invariant the whole arrangement exists for, checked over a finished
 * plan rather than trusted from the code that built it. Returns the benches
 * that break it — empty is the only acceptable answer.
 */
export function adjacencyBreaches(plan: SeatingPlan): string[] {
  const bad: string[] = [];
  for (const room of plan.rooms) {
    for (const bench of room.benches) {
      for (let i = 1; i < bench.seats.length; i += 1) {
        const left = bench.seats[i - 1];
        const right = bench.seats[i];
        if (left && right && left.classId === right.classId) {
          bad.push(`${room.roomName} bench ${bench.number}: seats ${i} and ${i + 1} are both ${left.className}`);
        }
      }
    }
  }
  return bad;
}

/**
 * Does any bench seat two class GROUPS together?
 *
 * The other invariant, checked the same way: a six-year-old writing rhymes
 * must not find a Class 8 child writing Science beside them, whatever the
 * anti-copying rule would happily allow.
 */
export function groupBreaches(plan: SeatingPlan): string[] {
  const bad: string[] = [];
  for (const room of plan.rooms) {
    for (const bench of room.benches) {
      const groups = [...new Set(bench.seats.filter(Boolean).map((s) => s!.groupLabel))];
      if (groups.length > 1) {
        bad.push(`${room.roomName} bench ${bench.number}: ${groups.join(" and ")} on one bench`);
      }
    }
  }
  return bad;
}

/* ── what gets printed ───────────────────────────────────────────── */

export type BenchSlip = {
  roomName: string;
  benchNumber: number;
  /** "Class 5 · 12 · AAROHI KUMARI" per seat, in seat order. */
  lines: string[];
  /** Seats with nobody in them, so a slip still shows the bench's shape. */
  seats: number;
};

export function benchSlips(plan: SeatingPlan): BenchSlip[] {
  const out: BenchSlip[] = [];
  for (const room of plan.rooms) {
    for (const bench of room.benches) {
      out.push({
        roomName: room.roomName,
        benchNumber: bench.number,
        seats: room.seatsPerBench,
        lines: bench.seats.map((s, i) =>
          s ? `${i + 1}. ${s.className} · ${s.label} · ${s.name}` : `${i + 1}. —`,
        ),
      });
    }
  }
  return out;
}

export type SeatingExportRow = {
  room: string;
  bench: string;
  seat: string;
  className: string;
  rollOrAdmission: string;
  studentName: string;
};

/** One row per seated child — what CSV, Excel and the PDF all render from. */
export function seatingExportRows(plan: SeatingPlan): SeatingExportRow[] {
  const rows: SeatingExportRow[] = [];
  for (const room of plan.rooms) {
    for (const bench of room.benches) {
      bench.seats.forEach((s, i) => {
        if (!s) return;
        rows.push({
          room: room.roomName,
          bench: String(bench.number),
          seat: String(i + 1),
          className: s.className,
          rollOrAdmission: s.label,
          studentName: s.name,
        });
      });
    }
  }
  return rows;
}

/** The children whose slip will show an admission number, for the office. */
export function missingRollNumbers(plan: SeatingPlan): SeatOccupant[] {
  const out: SeatOccupant[] = [];
  for (const room of plan.rooms) {
    for (const bench of room.benches) {
      for (const s of bench.seats) if (s?.rollMissing) out.push(s);
    }
  }
  return out;
}
