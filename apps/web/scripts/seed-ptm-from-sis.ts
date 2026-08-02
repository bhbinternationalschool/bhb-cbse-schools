#!/usr/bin/env npx tsx
/**
 * Seed ptm_desk_* — one term PTM event, slots, and demo bookings from SIS.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-ptm-from-sis.ts
 */

import {
  emptyPtmState,
  type PtmBooking,
  type PtmEvent,
  type PtmSlot,
  type PtmState,
} from "../src/lib/ptm";
import { DEFAULT_AY, loadMasters } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchPtmDeskFromDb,
  pushPtmDeskToDb,
} from "../src/lib/ptmNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function slotTimes(count: number): { startAt: string; endAt: string }[] {
  const slots: { startAt: string; endAt: string }[] = [];
  let h = 10;
  let m = 0;
  for (let i = 0; i < count; i++) {
    const startAt = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    m += 15;
    if (m >= 60) {
      h += 1;
      m -= 60;
    }
    const endAt = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slots.push({ startAt, endAt });
  }
  return slots;
}

async function main() {
  const date = todayYmd();
  const now = new Date().toISOString();
  const masters = loadMasters();
  const staff =
    (masters.staff ?? []).find((s) => s.stream === "teaching" && s.status === "active") ||
    (masters.staff ?? []).find((s) => s.status === "active");

  const { bundle } = await fetchSisFromDb();
  const active = bundle.students.filter(
    (s) => s.status === "active" && s.classId && s.householdId,
  );
  if (!active.length) {
    throw new Error("No active SIS students with households — seed SIS first.");
  }

  const classIds = [...new Set(active.map((s) => s.classId))].slice(0, 6);
  const eventId = `ptme_seed_${date}`;
  const event: PtmEvent = {
    id: eventId,
    academicYearCode: active[0]!.academicYearCode || DEFAULT_AY,
    name: "Term PTM",
    date,
    endDate: date,
    classIds,
    mode: "in_person",
    note: "Seeded PTM for desk cutover — 15 min slots",
    isActive: true,
    createdAt: now,
  };

  const times = slotTimes(8);
  const slots: PtmSlot[] = times.map((t, i) => ({
    id: `ptms_seed_${eventId}_${i}`,
    eventId,
    teacherStaffId: staff?.id || "",
    teacherName: staff?.fullName || "Class teacher",
    startAt: t.startAt,
    endAt: t.endAt,
    capacity: 1,
    roomOrLink: "Room 12",
  }));

  const bookings: PtmBooking[] = active.slice(0, Math.min(5, slots.length)).map((st, i) => ({
    id: `ptmb_seed_${st.id}`,
    eventId,
    slotId: slots[i]!.id,
    studentId: st.id,
    parentName: st.fatherName || st.motherName || "Parent",
    householdId: st.householdId,
    status: "booked" as const,
    bookedAt: now,
  }));

  const state: PtmState = {
    ...emptyPtmState(),
    events: [event],
    slots,
    bookings,
  };

  console.log(
    `Seeding 1 event, ${slots.length} slots, ${bookings.length} bookings`,
  );

  const before = await fetchPtmDeskFromDb();
  console.log(`DB before: ${before.bundle.events.length} events`);

  const result = await pushPtmDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchPtmDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.events.length} events, ${after.bundle.slots.length} slots, ${after.bundle.bookings.length} bookings`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
