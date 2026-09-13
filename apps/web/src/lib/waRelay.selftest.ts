/**
 * Self-test: the office relay's routing and reply codes.
 * Run: npx tsx apps/web/src/lib/waRelay.selftest.ts
 */

import assert from "node:assert/strict";

import {
  formatRelayForward,
  isRelayOfficeNumber,
  makeRelayCode,
  normalizeRelayRoute,
  parseRelayReplyCode,
  relayCategoryFor,
  relayMobile10,
  routesFor,
  templateSafe,
  type RelayRoute,
} from "./waRelay";

console.log("waRelay.selftest.ts");

/* ── numbers ───────────────────────────────────────────────── */

assert.equal(relayMobile10("+91 94515 08585"), "9451508585");
assert.equal(relayMobile10("09451508585"), "9451508585");
assert.equal(relayMobile10("0000000000"), "", "a placeholder is not a phone");
assert.equal(relayMobile10("12345"), "");

/* ── routes ────────────────────────────────────────────────── */

const route = (id: string, mobile: string, categories: string[], active = true) =>
  normalizeRelayRoute({ id, name: id, mobile, categories, active })!;

const routes: RelayRoute[] = [
  route("fees-desk", "9000000011", ["fee_enquiry", "parent"]),
  route("admissions", "9000000022", ["admission_enquiry"]),
  route("principal", "9000000033", ["general", "complaint"]),
  route("accounts-2", "9000000044", ["fee_enquiry"]),
  route("switched-off", "9000000055", ["transport"], false),
];

// A category taken by two phones reaches both.
assert.deepEqual(
  routesFor("fee_enquiry", routes).map((r) => r.id).sort(),
  ["accounts-2", "fees-desk"],
);
assert.deepEqual(routesFor("admission_enquiry", routes).map((r) => r.id), ["admissions"]);

// Nobody took transport (the only transport route is switched off), so it
// falls to the catch-all rather than nowhere.
assert.deepEqual(routesFor("transport", routes).map((r) => r.id), ["principal"]);
assert.deepEqual(routesFor("staff", routes).map((r) => r.id), ["principal"]);

// No catch-all and no direct route: nothing — the caller records it as
// undelivered instead of pretending.
assert.deepEqual(routesFor("staff", [route("a", "9000000011", ["fee_enquiry"])]), []);

// The same phone listed twice is messaged once.
assert.equal(
  routesFor("fee_enquiry", [
    route("x", "9000000011", ["fee_enquiry"]),
    route("y", "9000000011", ["fee_enquiry"]),
  ]).length,
  1,
);

// Bad input is dropped, not guessed.
assert.equal(normalizeRelayRoute({ mobile: "123" }), null);
assert.deepEqual(
  normalizeRelayRoute({ mobile: "9000000011", categories: ["fee_enquiry", "nonsense", "fee_enquiry"] })!.categories,
  ["fee_enquiry"],
);

assert.equal(isRelayOfficeNumber("919000000011", routes), true);
assert.equal(isRelayOfficeNumber("9000000055", routes), false, "a switched-off phone is not a relay phone");
assert.equal(isRelayOfficeNumber("9876543210", routes), false);

/* ── codes ─────────────────────────────────────────────────── */

const code = makeRelayCode(() => 0.5);
assert.match(code, /^[23456789A-HJ-NP-Z]{4}$/);

assert.deepEqual(parseRelayReplyCode("#K7Q2 fees received, thank you"), {
  code: "K7Q2",
  body: "fees received, thank you",
});
assert.deepEqual(parseRelayReplyCode("# k7q2: aapki fees mil gayi"), {
  code: "K7Q2",
  body: "aapki fees mil gayi",
});
assert.deepEqual(parseRelayReplyCode("#K7Q2 - ok"), { code: "K7Q2", body: "ok" });
// A hash inside a sentence is not a coded reply.
assert.equal(parseRelayReplyCode("He came #1 in class"), null);
assert.equal(parseRelayReplyCode("fees received"), null);
// Ambiguous letters are not in the alphabet, so a typo cannot hit a real code.
assert.equal(parseRelayReplyCode("#O1IL hello"), null);

/* ── categories ────────────────────────────────────────────── */

assert.equal(relayCategoryFor({ audience: "sis_parent", roleKinds: ["parent"], feeReply: true }), "fee_enquiry");
assert.equal(relayCategoryFor({ audience: "sis_parent", roleKinds: ["parent"], feeReply: false }), "parent");
assert.equal(relayCategoryFor({ audience: "crm_admission_parent", roleKinds: [], feeReply: false }), "admission_enquiry");
assert.equal(relayCategoryFor({ audience: "visitor_job", roleKinds: [], feeReply: false }), "job_enquiry");
assert.equal(relayCategoryFor({ audience: "vendor", roleKinds: [], feeReply: false }), "vendor_enquiry");
assert.equal(relayCategoryFor({ audience: "transport_driver", roleKinds: ["transport"], feeReply: false }), "transport");
assert.equal(relayCategoryFor({ audience: "staff_quiet", roleKinds: ["staff"], feeReply: false }), "staff");
assert.equal(relayCategoryFor({ audience: "voice_note_handoff", roleKinds: ["parent"], feeReply: false }), "parent");
assert.equal(relayCategoryFor({ audience: "voice_note_handoff", roleKinds: ["teacher"], feeReply: false }), "staff");
assert.equal(relayCategoryFor({ audience: "visitor_parked", roleKinds: [], feeReply: false }), "general");

/* ── what the office sees ──────────────────────────────────── */

const forward = formatRelayForward({
  code: "K7Q2",
  category: "fee_enquiry",
  senderName: "DEEPAK YADAV",
  senderMobile10: "9451408585",
  context: "AARAV YADAV · V-A",
  text: "maine fees jama kar di hai",
  mediaNote: "",
  reason: "the bot could not answer",
});
assert.match(forward, /#K7Q2/);
assert.match(forward, /DEEPAK YADAV/);
assert.match(forward, /maine fees jama kar di hai/);
assert.match(forward, /Swipe right/);

// Template parameters: no newlines, no long space runs, never empty.
assert.equal(templateSafe("line one\nline two\t\tx"), "line one / line two / x");
assert.equal(templateSafe(""), "—");
assert.ok(!templateSafe("a        b").includes("    "));

console.log("  ok");
