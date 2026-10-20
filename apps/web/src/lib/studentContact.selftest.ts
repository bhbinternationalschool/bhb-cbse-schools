/**
 * Calling and messaging one student's family from the staff app.
 * Run: npx tsx src/lib/studentContact.selftest.ts
 */
import assert from "node:assert/strict";
import {
  callTargetFor,
  checkNewWhatsAppNumber,
  composeStudentMessage,
  maskMobile,
  messageTargetFor,
  realMobile10,
  renderTemplateText,
} from "./studentContact";

// A placeholder is never a number to dial or message (PR #377).
for (const ph of ["0000000000", "9999999999", "+91 00000 00000", "1234567890", "9876543210", "", "12345"]) {
  assert.equal(realMobile10(ph), "", `placeholder/invalid "${ph}"`);
}
assert.equal(realMobile10("+91 98391-24567"), "9839124567");
assert.equal(realMobile10("09839124567"), "9839124567");

// Call: the guardian's mobile first, then WhatsApp, then nothing.
assert.deepEqual(callTargetFor({ mobile: "9839124567", whatsappMobile: "7007001234" }), { number: "9839124567", source: "guardian" });
assert.deepEqual(callTargetFor({ mobile: "0000000000", whatsappMobile: "7007001234" }), { number: "7007001234", source: "whatsapp" });
assert.deepEqual(callTargetFor({ mobile: "0000000000", whatsappMobile: "0000000000" }), { number: "", source: "none" });
assert.deepEqual(callTargetFor(null), { number: "", source: "none" });

// Message: WhatsApp first, then the guardian's mobile.
assert.equal(messageTargetFor({ mobile: "9839124567", whatsappMobile: "7007001234" }), "7007001234");
assert.equal(messageTargetFor({ mobile: "9839124567", whatsappMobile: "9999999999" }), "9839124567");
assert.equal(messageTargetFor({ mobile: "", whatsappMobile: "" }), "");

assert.equal(maskMobile("9839124567"), "98•••••567");
assert.equal(maskMobile(""), "");

// A new WhatsApp number: Indian 10-digit, real, and an actual change.
assert.deepEqual(checkNewWhatsAppNumber("+91 70070 01234", "9839124567"), { ok: true, number: "7007001234" });
assert.equal(checkNewWhatsAppNumber("", "").ok, false);
assert.equal(checkNewWhatsAppNumber("98391", "").ok, false);
assert.equal(checkNewWhatsAppNumber("5839124567", "").ok, false, "must start 6–9");
assert.equal(checkNewWhatsAppNumber("0000000000", "").ok, false, "placeholder");
assert.equal(checkNewWhatsAppNumber("9999999999", "").ok, false, "placeholder");
assert.equal(checkNewWhatsAppNumber("9839124567", "+91 98391 24567").ok, false, "unchanged");

// The family reads the teacher's words on one line, under the teacher's name.
const m = composeStudentMessage({ teacherName: "Shipra", classLabel: "V A", childName: "Aarav", text: "Please send the\n\nscience copy tomorrow" });
assert.ok(m.ok);
if (m.ok) {
  assert.equal(m.body.includes("\n"), false);
  assert.equal(m.body, "Please send the · science copy tomorrow");
  assert.equal(m.title, "Shipra (V A) — about Aarav");
}
assert.equal(composeStudentMessage({ teacherName: "S", classLabel: "", childName: "", text: "  hi " }).ok, false);
assert.equal(composeStudentMessage({ teacherName: "S", classLabel: "", childName: "", text: "x".repeat(1200) }).ok, false, "never cut silently");

assert.equal(renderTemplateText("Notice from {{schoolName}}: {{ noticeBody }} {{missing}}", { schoolName: "BHB", noticeBody: "hello" }), "Notice from BHB: hello —");

console.log("studentContact: ok");
