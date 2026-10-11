import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aadhaarSlot, popupOutcome, sortResponses, type ResponseRow } from "./appPopupResponses";

console.log("appPopupResponses.selftest.ts");

// What a family did.
assert.equal(popupOutcome({ shown: 2, dismissed: 1, done: 1 }, false), "completed");
assert.equal(popupOutcome({ shown: 1, dismissed: 0, done: 1 }, true), "saved_some", "saved, but a sibling's number still missing");
assert.equal(popupOutcome({ shown: 3, dismissed: 2, done: 0 }, true), "later");
assert.equal(popupOutcome({ shown: 1, dismissed: 0, done: 0 }, true), "seen");
assert.equal(popupOutcome({ shown: 0, dismissed: 0, done: 0 }, true), "not_seen");

// Never the full number in a list.
assert.deepEqual(aadhaarSlot("234567890123", "", "received"), { last4: "0123", status: "received" });
assert.deepEqual(aadhaarSlot("", "4321", "verified_udise"), { last4: "4321", status: "verified_udise" });
assert.deepEqual(aadhaarSlot("", "", "received"), { last4: "", status: "missing" }, "no number = missing, whatever the flag says");
assert.deepEqual(aadhaarSlot("2345 6789 0123", undefined, undefined), { last4: "0123", status: "received" });

const row = (family: string, outcome: ResponseRow["outcome"], doneAt = "", lastSeen = ""): ResponseRow => ({
  householdId: family, family, outcome, shown: 0, later: 0, firstSeen: "", lastSeen, doneAt, gave: [], children: [],
});
assert.deepEqual(
  sortResponses([row("B", "later"), row("A", "not_seen"), row("C", "completed", "2026-10-10"), row("D", "completed", "2026-10-11")]).map((r) => r.family),
  ["D", "C", "B", "A"],
  "answered first, newest first",
);

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const route = read("../app/api/comms/app-popups/responses/route.ts");
assert.ok(/requireStaffPermission\(req, "students", "view"\)/.test(route), "the list needs student access too");
assert.ok(/requireStaffPermission\(req, "students", "edit"\)/.test(route), "verifying needs student edit");
const server = read("appPopups.server.ts");
const fn = server.slice(server.indexOf("export async function popupResponses"));
assert.ok(!/aadhaarNumber:|AadhaarNumber:/.test(fn.slice(0, fn.indexOf("export async function markAadhaarVerified"))), "rows carry slots, not numbers");
assert.ok(/from\("sis_students"\)/.test(fn), "reads stored rows, not a cached copy");
assert.ok(/Aadhaar marked verified on UDISE\+/.test(server), "verifying is audited");

console.log("appPopupResponses.selftest: all assertions passed");
