/**
 * Self-test: the parent bot against what parents actually sent (11–13 Sep
 * 2026, production chats). Each line is a real message and the handling it
 * should have got; names and numbers are left out.
 * Run: npx tsx src/lib/parentBotRealChats.selftest.ts
 */

import assert from "node:assert/strict";

import {
  classLabelMatches,
  composeSisFeeStructureReply,
  detectSisBotIntent,
  detectSisFeeQuestion,
  detectSisFeeReplyIntent,
  isSisAcknowledgement,
  isSisGreeting,
  looksLikeAutoReply,
} from "./sisParentBotEngine";
import { parseWaTutorCommand } from "./waTutorBotEngine";

console.log("parentBotRealChats.selftest.ts");

/* ── "How much is the fee?" was answered with the dues list ─────── */

for (const q of [
  "Ukg ka fees kitna hai",
  "UKG ke bacche ka total fees kitna hai please hamen bataen",
  "Monthly school fees kitna hai transport kitna hai",
  "Aur fees mein kuchh discount",
  "Transport ka",
  "bus ki fees kitni hai",
  "फीस कितनी है",
]) {
  assert.ok(detectSisFeeQuestion(q), `fee question: "${q}"`);
  assert.equal(detectSisFeeReplyIntent(q), null, `not a payment reply: "${q}"`);
}
assert.equal(detectSisFeeQuestion("Ukg ka fees kitna hai")!.namedClass, "UKG");
assert.equal(detectSisFeeQuestion("Monthly school fees kitna hai transport kitna hai")!.transport, true);
assert.equal(detectSisFeeQuestion("Aur fees mein kuchh discount")!.discount, true);
// Still DUES / PAY, not a fee question.
for (const t of ["DUES", "fees", "PAY", "fees baki", "मेरी फीस"]) {
  assert.equal(detectSisFeeQuestion(t), null, `not a fee question: "${t}"`);
}
assert.equal(detectSisBotIntent("DUES"), "dues");

/* ── "Already paid", said the ways parents say it ─────────────────── */

for (const t of ["भुगतान हो गया", "Exam fees jama h", "Pass dal di hu", "1500 dina", "fees jama kar di hai", "maine 2000 de diya hai"]) {
  assert.equal(detectSisFeeReplyIntent(t), "claims_paid", `claims paid: "${t}"`);
}
// A question about paying is not a claim to have paid.
for (const t of ["fees kab jama hai?", "kitna jama hai", "jama karo 5 aur 7"]) {
  assert.notEqual(detectSisFeeReplyIntent(t), "claims_paid", `not a claim: "${t}"`);
}
assert.equal(detectSisFeeReplyIntent("थोड़ा समय चाहिए"), "need_time");
assert.equal(detectSisFeeReplyIntent("Mam 2-3din me kr dete h"), null, "unclear — left to the model, not mis-filed as paid");

/* ── Study help must not grab fee talk ────────────────────────────── */

assert.equal(parseWaTutorCommand("Exam fees jama h", false).kind, "none");
assert.equal(parseWaTutorCommand("Pass dal di hu", false).kind, "none");
assert.equal(parseWaTutorCommand("PASS", false).kind, "plans", "PASS alone still shows the plans");
assert.equal(parseWaTutorCommand("PASS 2", false).kind, "buy");
assert.equal(parseWaTutorCommand("EXAM fractions", true).kind, "mode");
assert.equal(parseWaTutorCommand("5 aur 7 jama karo", true).kind, "question", "a maths question keeps 'jama'");

/* ── Small talk ───────────────────────────────────────────────────── */

for (const t of ["Ok", "ok", "Thank you", "ठीक है", "👍", "ji"]) assert.ok(isSisAcknowledgement(t), `ack: "${t}"`);
for (const t of ["Hlw", "Hi sir", "hello mam", "namaskar", "Good morning", "नमस्ते"]) assert.ok(isSisGreeting(t), `greeting: "${t}"`);
assert.ok(!isSisGreeting("Hindi and English"));
assert.ok(!isSisAcknowledgement("Ok fees kitna hai"));

/* ── Another business's auto-reply ─────────────────────────────────── */

assert.ok(looksLikeAutoReply("🙏 Hello!\nYou have contacted Aqua RO Service.\nWe are currently unavailable, but we have received your message."));
assert.ok(looksLikeAutoReply("मैसेज के लिए धन्यवाद 🌸\nBooking और कैटलॉग देखकर अपनी बुकिंग कंफर्म कराए।।"));
assert.ok(!looksLikeAutoReply("Thank you, maine fees jama kar di hai kal"));
assert.ok(!looksLikeAutoReply("Ok"));

/* ── The fee answer itself ────────────────────────────────────────── */

const child = {
  name: "MANYA",
  classLabel: "UKG-A",
  heads: [
    { head: "ट्यूशन फीस", transport: false, eachPaise: 150000, count: 12, totalPaise: 1800000 },
    { head: "परीक्षा शुल्क", transport: false, eachPaise: 50000, count: 3, totalPaise: 150000 },
  ],
  concessionPaise: 0,
  totalPaise: 1950000,
  paidPaise: 900000,
  balancePaise: 1050000,
  dueNowPaise: 200000,
};
const ukg = composeSisFeeStructureReply({
  academicYear: "2026-27",
  children: [child],
  question: detectSisFeeQuestion("Ukg ka fees kitna hai")!,
  hindi: true,
});
assert.match(ukg.text, /₹1,500 × 12 = \*₹18,000\*/);
assert.match(ukg.text, /₹19,500/);
assert.match(ukg.text, /₹10,500/);
assert.equal(ukg.escalate, false, "their own child's class — answered, no office needed");

const bus = composeSisFeeStructureReply({
  academicYear: "2026-27",
  children: [child],
  question: detectSisFeeQuestion("Transport ka")!,
  hindi: true,
});
assert.equal(bus.escalate, true, "no bus on record — the office is asked");
assert.match(bus.text, /बस/);

const other = composeSisFeeStructureReply({
  academicYear: "2026-27",
  children: [child],
  question: detectSisFeeQuestion("class 5 ki fees kitni hai")!,
  hindi: true,
});
assert.equal(other.escalate, true, "a class none of their children are in goes to the office");

const disc = composeSisFeeStructureReply({
  academicYear: "2026-27",
  children: [child],
  question: detectSisFeeQuestion("Aur fees mein kuchh discount")!,
  hindi: true,
});
assert.equal(disc.escalate, true, "discount requests always reach a person");

// "Transport ka" shows only the children who ride, and only the bus line.
const twoKids = composeSisFeeStructureReply({
  academicYear: "2026-27",
  children: [
    { ...child, name: "RIDER", heads: [...child.heads, { head: "परिवहन शुल्क", transport: true, eachPaise: 70000, count: 11, totalPaise: 770000 }] },
    { ...child, name: "WALKER" },
  ],
  question: detectSisFeeQuestion("Transport ka")!,
  hindi: true,
});
assert.match(twoKids.text, /RIDER/);
assert.doesNotMatch(twoKids.text, /WALKER/);
assert.doesNotMatch(twoKids.text, /ट्यूशन/);
assert.equal(twoKids.escalate, false);

assert.ok(classLabelMatches("Class 5 B", "5"));
assert.ok(classLabelMatches("V-A", "5"));
assert.ok(!classLabelMatches("UKG-A", "5"));
assert.ok(classLabelMatches("UKG-A", "UKG"));

console.log("  ok");
