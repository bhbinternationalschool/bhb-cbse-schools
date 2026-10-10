import assert from "node:assert/strict";
import { commsTabIsOfficeOnly, commsTabOfHref } from "./commsTabAccess";

console.log("commsTabAccess.selftest.ts");
// A teacher's view grant reads these…
for (const t of ["notices", "news", "gallery", "inbox"]) assert.equal(commsTabIsOfficeOnly(t), false, t);
// …and never these: family chats, phone numbers, app pop-ups.
for (const t of ["whatsapp", "onapp", "popups", "email", "social", "answers", "reports", "dashboard"]) assert.equal(commsTabIsOfficeOnly(t), true, t);
assert.equal(commsTabOfHref("/comms?tab=whatsapp&wa=classes"), "whatsapp");
assert.equal(commsTabOfHref("/comms"), "notices");
assert.equal(commsTabOfHref("/attendance"), null);
assert.equal(commsTabIsOfficeOnly(commsTabOfHref("/attendance")), false);
console.log("commsTabAccess.selftest: all assertions passed");
