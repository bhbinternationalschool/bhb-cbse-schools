import assert from "node:assert/strict";
import { bestStatus, istDay, istTime, mergeTimeline, renderTemplate, templateLabel, type TimelineMsg } from "./waTimeline";

console.log("waTimeline.selftest.ts");

const m = (over: Partial<TimelineMsg>): TimelineMsg => ({
  id: Math.random().toString(36),
  direction: "out",
  at: "2026-10-09T10:20:00.000Z",
  text: "",
  label: "",
  kind: "text",
  waMessageId: "",
  status: "",
  replyToText: "",
  replyToWaMessageId: "",
  error: "",
  source: "log",
  ...over,
});

// The same bot reply in the full log and in the bot thread → one bubble, labelled "Bot".
const t = mergeTimeline([
  [m({ text: "इसकी जानकारी मेरे पास नहीं है", waMessageId: "", source: "log", label: "School", status: "read" })],
  [m({ text: "इसकी जानकारी मेरे पास नहीं है", at: "2026-10-09T10:20:01.000Z", source: "thread", label: "Bot" })],
]);
assert.equal(t.length, 1);
assert.equal(t[0]!.label, "Bot");
assert.equal(t[0]!.status, "read", "the tick from the log survives the merge");

// Same WhatsApp id wins regardless of text; different ids stay apart.
assert.equal(mergeTimeline([[m({ waMessageId: "w1", text: "a" }), m({ waMessageId: "w1", text: "b", source: "automation", label: "Homework" })]]).length, 1);
assert.equal(mergeTimeline([[m({ waMessageId: "w1", text: "x" }), m({ waMessageId: "w2", text: "x" })]]).length, 2);

// Same words ten minutes apart are two messages (a reminder sent twice).
assert.equal(mergeTimeline([[m({ text: "Fee due" }), m({ text: "Fee due", at: "2026-10-09T10:30:00.000Z" })]]).length, 2);

// Time order, and "replying to" filled from the message it points at.
const r = mergeTimeline([
  [m({ direction: "in", at: "2026-10-09T10:21:00.000Z", text: "for this year", replyToWaMessageId: "w9" })],
  [m({ at: "2026-10-09T09:00:00.000Z", waMessageId: "w9", text: "Homework for II A: …", label: "Homework" })],
]);
assert.equal(r[0]!.label, "Homework");
assert.match(r[1]!.replyToText, /Homework for II A/);

assert.equal(templateLabel("bhb_homework_full"), "Homework");
assert.equal(templateLabel("bhb_fee_receipt_pdf"), "Fee receipt");
assert.equal(templateLabel("bhb_daily_brief"), "Daily brief");
assert.equal(templateLabel("something_new"), "Automation");
assert.equal(renderTemplate("Dear {{1}}, {{2}} is due.", ["Ravi", "₹500"]), "Dear Ravi, ₹500 is due.");
// Desk templates name their blanks; values follow the template's variable order.
assert.equal(renderTemplate("Dear {{guardianName}}, {{childName}}'s fee", ["Ravi", "Manya"], ["guardianName", "childName"]), "Dear Ravi, Manya's fee");
assert.equal(renderTemplate("Dear {{guardianName}} ({{stage}})", []), "Dear … (…)", "old rows kept no values");
assert.equal(bestStatus(["sent", "read", "delivered"]), "read");
assert.equal(bestStatus(["sent", "failed"]), "failed");

// IST: 10:20 UTC is 3:50 pm in India.
assert.match(istTime("2026-10-09T10:20:00.000Z"), /3:50\s?pm/i);
assert.equal(istDay("2026-10-09T19:00:00.000Z"), "2026-10-10", "after 6:30 pm UTC it is the next day in India");

console.log("waTimeline.selftest: all assertions passed");
