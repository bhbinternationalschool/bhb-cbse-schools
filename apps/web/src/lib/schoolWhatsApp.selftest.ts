/**
 * Self-test: the WhatsApp chat link the parent app is handed.
 * Run: npx tsx apps/web/src/lib/schoolWhatsApp.selftest.ts
 */
import assert from "node:assert/strict";
import { schoolWhatsAppContactFromDisplay } from "@/lib/schoolWhatsApp";

const meta = schoolWhatsAppContactFromDisplay("+91 94519 38805");
assert.ok(meta);
assert.equal(meta!.number, "919451938805");
assert.equal(meta!.display, "+91 94519 38805");
assert.equal(meta!.chatUrl, "https://wa.me/919451938805?text=Hi");

const tenDigit = schoolWhatsAppContactFromDisplay("9451938805");
assert.equal(tenDigit!.number, "919451938805", "a bare 10-digit number is Indian");

assert.equal(schoolWhatsAppContactFromDisplay(""), null, "blank must not become a number");
assert.equal(schoolWhatsAppContactFromDisplay(null), null);
assert.equal(schoolWhatsAppContactFromDisplay("12345"), null, "too short is not a number");

console.log("schoolWhatsApp.selftest: ok");
