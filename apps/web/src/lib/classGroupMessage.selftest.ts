/**
 * Run: npx tsx src/lib/classGroupMessage.selftest.ts
 */
import assert from "node:assert/strict";
import { composeClassGroupMessage, groupDate, waShareUrl } from "@/lib/classGroupMessage";

const m = composeClassGroupMessage({
  kind: "homework",
  classLabel: "Class III · A",
  date: "2026-10-08",
  subject: "Maths",
  title: "Maths",
  bodyEn: "Exercise 4.2, Q1–5 in the notebook.",
  bodyHi: "अभ्यास 4.2, प्रश्न 1–5 कॉपी में।",
  dueAt: "2026-10-09",
  schoolName: "BHB International School",
});
assert.match(m, /^📚 \*Homework \/ गृहकार्य — Class III · A\* \(Thu 8 Oct\)/);
assert.match(m, /\*Subject \/ विषय:\* Maths/);
assert.ok(!/\*Maths\*\n/.test(m), "a title equal to the subject is not repeated");
assert.match(m, /Exercise 4\.2/);
assert.match(m, /अभ्यास 4\.2/);
assert.match(m, /\*Due \/ जमा करें:\* Fri 9 Oct/);
assert.match(m, /— BHB International School/);
assert.match(m, /school's WhatsApp number/);
assert.ok(!/Dear|प्रिय/.test(m), "a group message names no child or parent");

const notice = composeClassGroupMessage({ kind: "notice", classLabel: "Class V", title: "PTM on Saturday", bodyEn: "Parents meet 10 am.", schoolName: "BHB" });
assert.match(notice, /📢 \*Notice \/ सूचना — Class V\*\n\*PTM on Saturday\*/);
assert.ok(!/Due/.test(notice));

assert.equal(groupDate("not a date"), "not a date");
assert.equal(groupDate(""), "");
assert.equal(waShareUrl("a b&c"), "https://wa.me/?text=a%20b%26c");
console.log("classGroupMessage selftest: ok");
