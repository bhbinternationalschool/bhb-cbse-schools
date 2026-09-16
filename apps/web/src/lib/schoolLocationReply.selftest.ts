/**
 * Self-test: "where is the school?" gets an answer.
 * Run: npx tsx apps/web/src/lib/schoolLocationReply.selftest.ts
 *
 * From the real chats, 2026-09-16. Two parents wrote *"लोकेशन भेजें"* —
 * Ashish Kumar Gond on 14 Sep, Amitabh Yadav on 16 Sep — and both were
 * answered "धन्यवाद 🙏 आपका उत्तर विद्यालय कार्यालय तक पहुँच गया है", which
 * is what the bot says when it has not understood. Neither was ever sent an
 * address. The school's address and coordinates were on record all along.
 *
 * The two things that must not break:
 *  - the BUS keeps its own answer. "बस कहाँ है" is a parent watching for the
 *    van, and handing them the campus address instead would be worse than
 *    the silence this replaces;
 *  - a bare "कहाँ" is not a map question. "फीस कहाँ जमा करें" is about fees.
 */

import assert from "node:assert/strict";

import {
  composeSchoolLocationReply,
  detectSchoolLocationRequest,
  schoolLocationPin,
  schoolMapsLink,
} from "./schoolLocationReply";

console.log("schoolLocationReply.selftest.ts");

/* ── 1. The messages that were actually sent to us ──────────────────── */

for (const asked of [
  "लोकेशन भेजें", // both parents, verbatim
  "location bhejiye",
  "school ka address kya hai",
  "स्कूल का पता बताइये",
  "send me the location",
  "map link",
  "school kahan hai",
  "स्कूल कहाँ है",
  "kaise pahuche school",
  "how to reach school",
  "नक्शा भेजिए",
]) {
  assert.ok(
    detectSchoolLocationRequest(asked),
    `must be understood as a location question: ${asked}`,
  );
}

/* ── 2. The bus keeps its own answer ────────────────────────────────── */

for (const bus of [
  "बस कहाँ है",
  "bus kaha hai",
  "van location",
  "गाड़ी कहाँ पहुँची",
  "bus ka location bhejo",
]) {
  assert.equal(
    detectSchoolLocationRequest(bus),
    false,
    `the van has its own live answer: ${bus}`,
  );
}

/* ── 3. Other questions are left alone ──────────────────────────────── */

for (const other of [
  "फीस कहाँ जमा करें",
  "fees kaha jama kare",
  "कल छुट्टी है क्या",
  "DUES",
  "PAY",
  "my son is sick today",
  "",
]) {
  assert.equal(
    detectSchoolLocationRequest(other),
    false,
    `not a map question: ${other || "(empty)"}`,
  );
}

/* ── 4. The answer carries an address and a tappable link ───────────── */

const hi = composeSchoolLocationReply({ hindi: true });
assert.ok(hi.includes("Ayar") || hi.includes("Varanasi"), "the address is in the reply");
assert.ok(hi.includes("https://www.google.com/maps"), "with a map link");
assert.ok(hi.includes("नक्शे पर खोलें"), "in Hindi, which is the school default");

const en = composeSchoolLocationReply({ hindi: false });
assert.ok(en.includes("Open in maps:"), "and in English when the family chose it");
assert.ok(en.includes("Varanasi") || en.includes("Ayar"));

// The link must point at coordinates, not a name a map app might mis-guess.
assert.match(
  schoolMapsLink(),
  /query=\d+\.\d+,\d+\.\d+$/,
  "the link carries the campus coordinates",
);

/* ── 5. The pin is the same place as the link ───────────────────────── */

const pin = schoolLocationPin(null);
assert.ok(Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude));
assert.ok(
  schoolMapsLink().includes(`${pin.latitude},${pin.longitude}`),
  "the pin and the link must be the same place — two answers is worse than none",
);
assert.ok(pin.address.length > 10, "the pin carries the address too");
assert.ok(pin.name.length > 0);

console.log("  ok — the school's location is answered, and the bus keeps its own");
