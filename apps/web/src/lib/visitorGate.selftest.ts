/**
 * The gate, as the guard's phone sees it.
 *
 * Two things here are worth a test rather than a careful reading.
 *
 * The gate board must show everyone still on campus REGARDLESS of the day
 * they arrived. A "today only" filter looks right and is wrong: the visitor
 * who never checked out last night is exactly the one the guard needs on
 * screen, and hiding them is how somebody stays on the register forever.
 *
 * And releasing a child is the only thing in this app that hands a person to
 * another person. Approved only, today only, once only, never without a name.
 *
 * Run: npx tsx src/lib/visitorGate.selftest.ts
 */
import assert from "node:assert/strict";

import {
  gateBoard,
  gatePassesForDay,
  releaseRefusal,
} from "./api/v1/staffVisitors.server";
import { defaultMobileAccess, resolveMobileFeatures } from "./mobileFeatures";
import type { GatePass, VisitorEntry, VisitorState } from "./visitors";

console.log("visitorGate.selftest.ts");

function istDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const now = new Date();
const today = istDayKey(now);
const yesterday = istDayKey(new Date(now.getTime() - 86_400_000));

function visit(p: Partial<VisitorEntry> & { id: string }): VisitorEntry {
  return {
    visitorNo: p.id.toUpperCase(),
    source: "reception",
    visitorName: "Visitor",
    mobile: "9000000000",
    purpose: "meeting",
    personToMeet: "",
    inTime: now.toISOString(),
    outTime: null,
    idProofNote: "",
    qrPayload: "",
    createdBy: "gate",
    createdAt: now.toISOString(),
    ...p,
  } as VisitorEntry;
}

// ── The board ─────────────────────────────────────────────────────────
const stillHereFromYesterday = visit({
  id: "v_stale",
  visitorName: "Never left",
  inTime: new Date(now.getTime() - 20 * 3_600_000).toISOString(),
});
const hereNow = visit({ id: "v_now", visitorName: "Here now" });
const leftToday = visit({
  id: "v_gone",
  visitorName: "Gone today",
  outTime: now.toISOString(),
});
const leftYesterday = visit({
  id: "v_old",
  visitorName: "Gone yesterday",
  inTime: new Date(now.getTime() - 30 * 3_600_000).toISOString(),
  outTime: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
});

const state: VisitorState = {
  version: 1,
  visitorLog: [stillHereFromYesterday, hereNow, leftToday, leftYesterday],
  gatePasses: [],
};

const board = gateBoard(state);
assert.deepEqual(
  board.onCampus.map((v) => v.id),
  ["v_now", "v_stale"],
  "on-campus must carry yesterday's un-checked-out visitor, newest first",
);
assert.deepEqual(
  board.departedToday.map((v) => v.id),
  ["v_gone"],
  "departed is today's only — yesterday's exits are not the guard's problem",
);
assert.equal(board.onCampus[0].onCampus, true);
assert.equal(board.departedToday[0].onCampus, false);

// ── The passes ────────────────────────────────────────────────────────
function pass(p: Partial<GatePass> & { id: string }): GatePass {
  return {
    studentId: "stu_1",
    academicYearCode: "2026-27",
    date: today,
    requestedPickupTime: "13:00",
    reason: "Doctor",
    requestedByStaffId: "stf_1",
    status: "approved",
    pickedUpByName: "",
    actualPickupTime: null,
    notifiedParentAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...p,
  } as GatePass;
}

const approved = pass({ id: "gp_ok" });
const requested = pass({ id: "gp_req", status: "requested" });
const cancelled = pass({ id: "gp_cancel", status: "cancelled" });
const collected = pass({
  id: "gp_done",
  status: "picked_up",
  pickedUpByName: "Uncle",
});
const stale = pass({ id: "gp_yday", date: yesterday });
const otherDay = pass({ id: "gp_other", date: yesterday, status: "approved" });

const passState: VisitorState = {
  version: 1,
  visitorLog: [],
  gatePasses: [approved, requested, cancelled, collected, stale, otherDay],
};

const naming = {
  studentName: () => "Aarav",
  classLabel: () => "IV A",
  staffName: () => "Meera",
};

const rows = gatePassesForDay(passState, today, naming);
assert.deepEqual(
  rows.map((r) => r.id).sort(),
  ["gp_cancel", "gp_done", "gp_ok", "gp_req"],
  "the day's list is scoped to that day",
);
assert.equal(
  rows.find((r) => r.id === "gp_ok")?.releasable,
  true,
  "an approved pass dated today is releasable",
);
for (const id of ["gp_req", "gp_cancel", "gp_done"]) {
  assert.equal(
    rows.find((r) => r.id === id)?.releasable,
    false,
    `${id} must not be releasable`,
  );
}
assert.equal(
  gatePassesForDay(passState, yesterday, naming).find((r) => r.id === "gp_other")
    ?.releasable,
  false,
  "an approved pass from another day is never releasable, even when listed",
);
// The already-collected row still shows WHO took the child — that is the
// question asked when a second person turns up for the same student.
assert.equal(rows.find((r) => r.id === "gp_done")?.pickedUpByName, "Uncle");

// ── The release itself ────────────────────────────────────────────────
assert.equal(
  releaseRefusal(approved, "Grandfather", today),
  null,
  "an approved pass, today, with a name, releases",
);
assert.equal(releaseRefusal(undefined, "Grandfather", today)?.status, 404);
assert.equal(
  releaseRefusal(approved, "   ", today)?.status,
  400,
  "no name = no release",
);
assert.equal(
  releaseRefusal(collected, "Somebody else", today)?.status,
  409,
  "a used pass must not release a second time",
);
assert.match(
  String(releaseRefusal(collected, "Somebody else", today)?.message),
  /Uncle/,
  "and it should say who already took them",
);
assert.equal(
  releaseRefusal(requested, "Grandfather", today)?.status,
  403,
  "requested-but-not-approved must not release",
);
assert.equal(releaseRefusal(cancelled, "Grandfather", today)?.status, 403);
assert.equal(
  releaseRefusal(otherDay, "Grandfather", today)?.status,
  403,
  "yesterday's approved pass must not release a child today",
);

// ── Who gets the gate at all ──────────────────────────────────────────
const access = defaultMobileAccess();
const everything = () => true;

const office = resolveMobileFeatures({
  roleCodes: ["office"],
  access,
  can: everything,
});
assert.ok(
  office.features.includes("visitor_gate") &&
    office.features.includes("gate_pass_release"),
  "reception is the gate desk on a small campus",
);

const support = resolveMobileFeatures({
  roleCodes: ["support"],
  access,
  can: everything,
});
assert.equal(
  support.features.includes("visitor_gate"),
  false,
  "a sweeper does not get the gate by default — the office grants it by name",
);

const teacher = resolveMobileFeatures({
  roleCodes: ["teacher"],
  access,
  can: everything,
});
assert.equal(teacher.features.includes("visitor_gate"), false);
assert.equal(teacher.features.includes("gate_pass_release"), false);

// Switched on for one person, but RBAC still says no: blocked, not granted.
const grantedByName = resolveMobileFeatures({
  roleCodes: ["support"],
  staffId: "stf_peon",
  access: {
    ...access,
    staffRules: [
      { staffId: "stf_peon", allow: ["visitor_gate"], deny: [], note: "gate duty" },
    ],
  },
  can: (m) => m !== "visitors",
});
assert.equal(grantedByName.features.includes("visitor_gate"), false);
assert.ok(
  grantedByName.blockedByRbac.includes("visitor_gate"),
  "the panel must be able to offer the personal permission grant",
);

// …and with the module permission, it opens for that one person.
const grantedFully = resolveMobileFeatures({
  roleCodes: ["support"],
  staffId: "stf_peon",
  access: {
    ...access,
    staffRules: [
      { staffId: "stf_peon", allow: ["visitor_gate"], deny: [], note: "gate duty" },
    ],
  },
  can: everything,
});
assert.ok(grantedFully.features.includes("visitor_gate"));
assert.equal(
  grantedFully.features.includes("gate_pass_release"),
  false,
  "letting somebody log visitors is not letting them hand over a child",
);

console.log("OK");
