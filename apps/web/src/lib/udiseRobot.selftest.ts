/**
 * The UDISE robot's to-do list: one next step per fact, never per guess.
 *
 * Run: npx tsx src/lib/udiseRobot.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type SisStudent } from "@/lib/sis";
import {
  buildUdiseRobotBoard,
  formatUdiseSummaryReply,
  udiseMissing,
  udiseQuestionFocus,
  udiseRobotTasksFor,
} from "@/lib/udiseRobot";

function student(patch: Partial<SisStudent>): SisStudent {
  return normalizeStudent({
    id: "stu_t",
    admissionNo: "T-1",
    fullName: "TEST CHILD",
    status: "active",
    ...patch,
  } as Partial<SisStudent> as SisStudent);
}
const kinds = (s: SisStudent) => udiseRobotTasksFor(s).map((t) => t.kind);
const AADHAAR = { aadhaarNumber: "234123412346", aadhaarLast4: "2346" };

// Complete children have nothing to do — PEN + APAAR, or PEN + a declined APAAR.
assert.deepEqual(kinds(student({ pen: "1234567890", apaarId: "111122223333" })), []);
assert.deepEqual(kinds(student({ pen: "1234567890", apaarConsent: "refused" })), []);

// No PEN: the office adds the child — with no Aadhaar, using the portal's
// 999999999999 "not available", while the family is asked for the real one.
assert.deepEqual(kinds(student({ ...AADHAAR })), ["add_on_portal", "ask_apaar_consent"]);
assert.deepEqual(kinds(student({})), ["add_on_portal", "collect_child_aadhaar", "ask_apaar_consent"]);
assert.match(udiseRobotTasksFor(student({}))[0]!.note || "", /999999999999/);
// A placeholder PEN is not a PEN.
assert.ok(kinds(student({ pen: "NA", ...AADHAAR })).includes("add_on_portal"));

// Aadhaar on file, portal never reported on it: enter and validate — not "failed".
assert.deepEqual(
  kinds(student({ pen: "1234567890", ...AADHAAR, aadhaarVerification: "received", udiseAadhaarValidationStatus: "Not Defined" })),
  ["validate_aadhaar", "ask_apaar_consent"],
);
// The portal said it failed.
assert.deepEqual(
  kinds(student({ pen: "1234567890", ...AADHAAR, aadhaarVerification: "received", udiseAadhaarValidationStatus: "Verification Failed From UIDAI" })),
  ["fix_aadhaar_failed", "ask_apaar_consent"],
);
// Verified per the portal export even when the ERP flag lags.
assert.deepEqual(
  kinds(student({ pen: "1234567890", ...AADHAAR, udiseAadhaarValidationStatus: "Verified From UIDAI against Name, Gender" })),
  ["ask_apaar_consent"],
);

// Parent said YES with their own Aadhaar on file: the office creates the APAAR.
const yes = student({
  pen: "1234567890",
  ...AADHAAR,
  aadhaarVerification: "verified_udise",
  apaarConsent: "given",
  apaarConsentBy: "RAM KUMAR · WhatsApp +91…",
  fatherName: "RAM KUMAR",
  fatherAadhaarNumber: "345634563452",
});
assert.deepEqual(kinds(yes), ["create_apaar"]);
// YES but no parent card: the family's turn.
assert.deepEqual(
  kinds(student({ pen: "1234567890", ...AADHAAR, aadhaarVerification: "verified_udise", apaarConsent: "given" })),
  ["collect_parent_aadhaar"],
);

// Transfer pending replaces "add on portal" — the child already has a PEN elsewhere.
assert.equal(kinds(student({ udiseInboundTransferPending: true }))[0], "accept_transfer");
assert.ok(!kinds(student({ udiseInboundTransferPending: true })).includes("add_on_portal"));

// Board counts children, not tasks, for done/open.
const board = buildUdiseRobotBoard([
  student({ id: "a", pen: "1234567890", apaarId: "111122223333" }),
  student({ id: "b" }),
  student({ id: "c", pen: "1234567890", ...AADHAAR }),
]);
assert.equal(board.total, 3);
assert.equal(board.done, 1);
assert.equal(board.open, 2);
assert.equal(board.byKind.find((g) => g.kind === "add_on_portal")?.children.length, 1);
assert.equal(board.byKind.find((g) => g.kind === "collect_child_aadhaar")?.children.length, 1);
assert.equal(board.byKind.find((g) => g.kind === "ask_apaar_consent")?.children.length, 2);

// Questions.
assert.equal(udiseQuestionFocus("class 3 without PEN"), "pen");
assert.equal(udiseQuestionFocus("kiska apaar nahi bana"), "apaar");
assert.equal(udiseQuestionFocus("aadhar missing 5A"), "aadhaar");
assert.equal(udiseQuestionFocus("aadhaar validation failed list"), "failed");
assert.equal(udiseQuestionFocus("udise status"), "");
// A declined APAAR is not "without APAAR" — APAAR is voluntary.
assert.equal(udiseMissing(student({ pen: "1", apaarConsent: "refused" }), "apaar"), false);
assert.equal(udiseMissing(student({ pen: "1" }), "apaar"), true);

const reply = formatUdiseSummaryReply({
  scopeLabel: "Class 3",
  focus: "pen",
  board,
  matching: [{ fullName: "TEST CHILD", classLabel: "3 A" }],
});
assert.match(reply, /1 without a PEN/);
assert.match(formatUdiseSummaryReply({ scopeLabel: "School", focus: "pen", board, matching: [] }), /None/);

console.log("udiseRobot selftest: ok");
