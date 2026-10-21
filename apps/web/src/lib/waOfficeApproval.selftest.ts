/**
 * Self-test: an office approval reply is acknowledged, never looked up.
 *
 * 22 Oct 2026: the director answered the n8n office's draft with "APPROVE 9"
 * and the ERP bot replied "I couldn't find an active student matching
 * 'approve class 9'". The webhook now recognises the reply ahead of every
 * lookup and only acknowledges it; the office poller owns approval_state.
 *
 * Run: npx tsx src/lib/waOfficeApproval.selftest.ts
 *   or npm run -w web test:wa-office-approval
 */
import assert from "node:assert/strict";

import { formatStudentMatchesAsk } from "./erpCommands";
import { parseStaffLinkDecision } from "./staffOnboarding";
import { parseLeaveCodeDecision } from "./staffLeaveWa";
import {
  composeOfficeApprovalAck,
  looksLikeOfficeApprovalReply,
  officeApprovalReply,
  parseOfficeApprovalReply,
} from "./waOfficeApproval";

console.log("waOfficeApproval.selftest.ts");

const LOOKUP_NOISE = formatStudentMatchesAsk([], "approve class 9");
assert.match(LOOKUP_NOISE, /couldn't find an active student/, "the noise this guards against");

/* ── Reading the reply ─────────────────────────────────────────────── */

for (const [text, approve, id] of [
  ["APPROVE 9", true, 9],
  ["approve 9", true, 9],
  ["  Approved #12 ", true, 12],
  ["ok 3", true, 3],
  ["yes, send 7", true, 7],
  ["send 7", true, 7],
  ["haan 4", true, 4],
  ["हाँ 4", true, 4],
  ["ठीक है 5", true, 5],
  ["भेज दो 6", true, 6],
  ["REJECT 9", false, 9],
  ["rejected 2", false, 2],
  ["no 2", false, 2],
  ["cancel #15", false, 15],
  ["nahi 8", false, 8],
  ["नहीं 8", false, 8],
  ["रद्द 11", false, 11],
  ["approve draft 9", true, 9],
] as const) {
  assert.deepEqual(parseOfficeApprovalReply(text), { approve, id }, `"${text}"`);
  assert.equal(looksLikeOfficeApprovalReply(text), true, `"${text}" is an office reply`);
}

// Not office replies: ordinary staff talk, lookups and the other decision
// codes stay with their own handlers.
for (const text of [
  "",
  "approve",
  "9",
  "Amay Gupta 4B",
  "okay 9",          // not a listed word
  "yesterday 9",     // "yes" inside a word
  "approve 9 please",
  "please approve 9",
  "fees of class 9",
  "LEAVE OK 4821",
  "LINK OK 4821",
  "no 0",
]) {
  assert.equal(parseOfficeApprovalReply(text), null, `"${text}" is not an office reply`);
}

// The LINK and LEAVE decisions run first in the webhook and must not
// claim an office reply; the office gate must not claim theirs.
assert.equal(parseStaffLinkDecision("APPROVE 9"), null);
assert.equal(parseLeaveCodeDecision("APPROVE 9"), null);
assert.equal(looksLikeOfficeApprovalReply("LEAVE OK 4821"), false);
assert.equal(looksLikeOfficeApprovalReply("LINK OK 4821"), false);

/* ── The director's message, end to end ────────────────────────────── */

{
  const out = officeApprovalReply({ text: "APPROVE 9", isStaff: true, state: "pending", hindi: false });
  assert.ok(out, "a staff number's APPROVE 9 is handled");
  assert.deepEqual(out.decision, { approve: true, id: 9 });
  assert.equal(out.reply, "Noted — approve for draft #9; the office will act within 5 minutes.");
  assert.doesNotMatch(out.reply, /couldn't find/, "never the lookup error");
  assert.notEqual(out.reply, LOOKUP_NOISE);
}
{
  const out = officeApprovalReply({ text: "REJECT 9", isStaff: true, state: "pending", hindi: false });
  assert.equal(out?.reply, "Noted — reject for draft #9; the office will act within 5 minutes.");
}
{
  const out = officeApprovalReply({ text: "APPROVE 42", isStaff: true, state: "missing", hindi: false });
  assert.equal(out?.reply, "No draft #42 is waiting.");
}
{
  // A row that exists but was never put up for approval is not waiting either.
  const out = officeApprovalReply({ text: "APPROVE 42", isStaff: true, state: "none", hindi: false });
  assert.equal(out?.reply, "No draft #42 is waiting.");
}
{
  const out = officeApprovalReply({ text: "approve 9", isStaff: true, state: "approved", hindi: false });
  assert.equal(out?.reply, "Draft #9 was already approved.");
}
{
  // The DB could not be read: the reply is still in wa_messages for the
  // poller, so say that rather than guess — and still never the lookup.
  const out = officeApprovalReply({ text: "approve 9", isStaff: true, state: "unknown", hindi: false });
  assert.equal(out?.reply, "Your reply on draft #9 is logged; the office will act within 5 minutes.");
}

// A parent or an unknown number saying "ok 9" is not giving an office
// decision: null means "carry on to the next handler".
assert.equal(officeApprovalReply({ text: "APPROVE 9", isStaff: false, state: "pending", hindi: false }), null);
assert.equal(officeApprovalReply({ text: "Amay Gupta 4B", isStaff: true, state: "pending", hindi: false }), null);

/* ── Hindi ─────────────────────────────────────────────────────────── */

assert.equal(
  composeOfficeApprovalAck({ decision: { approve: true, id: 9 }, state: "pending", hindi: true }),
  "नोट कर लिया — ड्राफ़्ट #9 के लिए मंज़ूरी; ऑफ़िस 5 मिनट के भीतर कार्रवाई करेगा।",
);
assert.equal(
  composeOfficeApprovalAck({ decision: { approve: false, id: 9 }, state: "pending", hindi: true }),
  "नोट कर लिया — ड्राफ़्ट #9 के लिए अस्वीकृति; ऑफ़िस 5 मिनट के भीतर कार्रवाई करेगा।",
);
assert.equal(
  composeOfficeApprovalAck({ decision: { approve: true, id: 3 }, state: "missing", hindi: true }),
  "ड्राफ़्ट #3 कोई प्रतीक्षा में नहीं है।",
);

console.log("waOfficeApproval.selftest.ts OK");
