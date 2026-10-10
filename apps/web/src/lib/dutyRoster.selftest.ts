/**
 * Run: npx tsx src/lib/dutyRoster.selftest.ts
 *
 * loadDutyRoster()/saveDutyRoster() are localStorage-gated (empty outside a
 * browser, per this app's convention), so this drives the pure in-memory
 * pieces directly: template/assignment normalization, week generation
 * (fairness rotation + idempotency), and message building. The full
 * generate → notify flow against real localStorage is verified live in the
 * browser instead.
 */
import assert from "node:assert/strict";

import {
  buildDutyNotifyMessages,
  generateWeekFromTemplates,
  normalizeDutyRosterState,
  type DutyAssignment,
  type DutyRosterState,
} from "./dutyRoster";
import { emptyMastersShell } from "./masters";

console.log("dutyRoster.selftest.ts");

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_a",
    empCode: "A1",
    fullName: "Staff A",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000001",
    email: "a@example.com",
    status: "active",
  },
  {
    id: "stf_b",
    empCode: "A2",
    fullName: "Staff B",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000002",
    email: "b@example.com",
    status: "active",
  },
  {
    id: "stf_c",
    empCode: "A3",
    fullName: "Staff C (no mobile)",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "",
    email: "c@example.com",
    status: "active",
  },
] as unknown as typeof masters.staff;

// --- normalizeDutyRosterState: drops malformed rows, keeps valid ones ----
{
  const raw = {
    version: 1,
    templates: [
      { id: "t1", dutyType: "gate", weekdays: [1, 1, 8, -1, 3], staffPool: ["stf_a", "", 5], slotsPerDay: "2" },
      { id: "t2", dutyType: "not_a_type" },
      { dutyType: "gate" }, // no id
    ],
    assignments: [
      { id: "d1", date: "2026-09-01", dutyType: "gate", staffId: "stf_a" },
      { id: "d2", date: "bad-date", dutyType: "gate", staffId: "stf_a" },
      { id: "d3", date: "2026-09-01", dutyType: "nope", staffId: "stf_a" },
    ],
  };
  const state = normalizeDutyRosterState(raw);
  assert.equal(state.templates.length, 1, "invalid dutyType and missing id must be dropped");
  assert.deepEqual(state.templates[0]!.weekdays, [1, 3], "weekdays deduped/sorted/range-checked");
  assert.deepEqual(state.templates[0]!.staffPool, ["stf_a"], "non-string pool entries dropped");
  assert.equal(state.templates[0]!.slotsPerDay, 2, "slotsPerDay coerced from string");
  assert.equal(state.assignments.length, 1, "bad date and invalid dutyType rows must be dropped");
}

// --- generateWeekFromTemplates: fills matching weekdays only, respects
// slotsPerDay, and is idempotent on re-run -------------------------------
{
  // 2026-09-07 is a Monday.
  let state: DutyRosterState = {
    version: 1,
    templates: [
      {
        id: "tpl_gate",
        dutyType: "gate",
        label: "Gate duty",
        weekdays: [1, 2, 3, 4, 5], // Mon-Fri
        staffPool: ["stf_a", "stf_b"],
        slotsPerDay: 1,
        active: true,
      },
    ],
    assignments: [],
  };

  const first = generateWeekFromTemplates(state, "2026-09-07");
  state = first.state;
  assert.equal(first.outcome.created.length, 5, "Mon-Fri = 5 gate assignments, weekend skipped");
  assert.ok(
    first.outcome.created.every((a) => a.dutyType === "gate"),
    "all created rows match the template's duty type",
  );

  const again = generateWeekFromTemplates(state, "2026-09-07");
  assert.equal(again.outcome.created.length, 0, "re-running must not duplicate existing slots");
  assert.equal(again.outcome.skippedExisting, 5, "all 5 already-filled slots reported as skipped");
}

// --- generateWeekFromTemplates: rotates fairly (lighter-loaded staff
// picked first) rather than always picking pool[0] -----------------------
{
  const heavyPriorLoad: DutyAssignment[] = Array.from({ length: 10 }, (_, i) => ({
    id: `prior_${i}`,
    date: "2026-09-01",
    dutyType: "gate",
    staffId: "stf_a",
    templateId: null,
    source: "manual",
    note: "",
    createdAt: "",
  }));
  const state: DutyRosterState = {
    version: 1,
    templates: [
      {
        id: "tpl_gate",
        dutyType: "gate",
        label: "Gate duty",
        weekdays: [1],
        staffPool: ["stf_a", "stf_b"],
        slotsPerDay: 1,
        active: true,
      },
    ],
    assignments: heavyPriorLoad,
  };
  const { outcome } = generateWeekFromTemplates(state, "2026-09-07");
  assert.equal(outcome.created.length, 1);
  assert.equal(
    outcome.created[0]!.staffId,
    "stf_b",
    "stf_a has 10 recent duties vs stf_b's 0 — stf_b must be picked",
  );
}

// --- buildDutyNotifyMessages: groups multiple duties per staff into one
// message, skips staff with no mobile on file -----------------------------
{
  const created: DutyAssignment[] = [
    {
      id: "d1",
      date: "2026-09-07",
      dutyType: "assembly",
      staffId: "stf_a",
      templateId: null,
      source: "auto",
      note: "",
      createdAt: "",
    },
    {
      id: "d2",
      date: "2026-09-07",
      dutyType: "gate",
      staffId: "stf_a",
      templateId: null,
      source: "auto",
      note: "",
      createdAt: "",
    },
    {
      id: "d3",
      date: "2026-09-07",
      dutyType: "lunch",
      staffId: "stf_c", // no mobile on file
      templateId: null,
      source: "auto",
      note: "",
      createdAt: "",
    },
  ];
  const messages = buildDutyNotifyMessages(created, masters, "2026-09-07");
  assert.equal(
    messages.length,
    1,
    "one message per staff (2 duties merged into 1 msg); mobile-less staff must be skipped",
  );
  assert.equal(messages[0]!.mobile, "9000000001");
  assert.ok(messages[0]!.body.includes("Morning assembly"));
  assert.ok(messages[0]!.body.includes("Gate duty"));
  assert.ok(!messages[0]!.body.includes("Lunch"), "stf_c's duty must not leak into stf_a's message");
}

console.log("OK — dutyRoster.selftest.ts");
