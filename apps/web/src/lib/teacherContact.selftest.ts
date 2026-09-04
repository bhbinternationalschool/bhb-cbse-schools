/**
 * Self-test: teacher contact hours and the WhatsApp relay format.
 * Run: npx tsx apps/web/src/lib/teacherContact.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildTeacherForwardText,
  buildTeacherWaText,
  nextTeacherWindowOpen,
  parseTeacherWaText,
  teacherHoursOpen,
  teacherRelayAck,
} from "@/lib/teacherContact";

// --- hours (IST = UTC+5:30)
{
  assert.equal(teacherHoursOpen(new Date("2026-09-05T02:29:00.000Z")), false, "7:59 AM IST is closed");
  assert.equal(teacherHoursOpen(new Date("2026-09-05T02:30:00.000Z")), true, "8:00 AM IST opens");
  assert.equal(teacherHoursOpen(new Date("2026-09-05T14:29:00.000Z")), true, "7:59 PM IST still open");
  assert.equal(teacherHoursOpen(new Date("2026-09-05T14:30:00.000Z")), false, "8:00 PM IST closes");
  assert.equal(nextTeacherWindowOpen(new Date("2026-09-05T16:00:00.000Z")), "2026-09-06T02:30:00.000Z", "9:30 PM → next morning 8 AM");
  assert.equal(nextTeacherWindowOpen(new Date("2026-09-05T01:00:00.000Z")), "2026-09-05T02:30:00.000Z", "6:30 AM → today 8 AM");
  assert.equal(nextTeacherWindowOpen(new Date("2026-09-05T10:00:00.000Z")), "2026-09-05T10:00:00.000Z", "inside hours → now");
}

// --- relay text round-trips through WhatsApp
{
  const t = buildTeacherWaText({ teacherName: "Priya Verma", role: "Maths", childName: "Amay Singh", classLabel: "LKG A", studentId: "stu_1", staffId: "stf_9" });
  assert.ok(t.startsWith("Message for teacher\nTeacher: Priya Verma (Maths)"));
  const sent = t + "Amay could not finish the worksheet, please guide.";
  assert.deepEqual(parseTeacherWaText(sent), { studentId: "stu_1", staffId: "stf_9", message: "Amay could not finish the worksheet, please guide." });
  const hi = buildTeacherWaText({ teacherName: "Priya", role: "गणित", childName: "Amay", classLabel: "LKG A", studentId: "stu_1", staffId: "stf_9", hindi: true });
  assert.ok(hi.startsWith("शिक्षक के लिए संदेश"));
  assert.equal(parseTeacherWaText(hi + "कृपया मार्गदर्शन करें")?.message, "कृपया मार्गदर्शन करें", "the Hindi hint line is dropped too");
  assert.equal(parseTeacherWaText("DUES"), null, "ordinary bot traffic is not a relay");
  assert.equal(parseTeacherWaText(t)?.message, "", "template sent untouched = empty message");
}

// --- what each side is told
{
  const fwd = buildTeacherForwardText({ childName: "Amay Singh", classLabel: "LKG A", guardianName: "Ramesh Singh", guardianMobile: "94519 38805", message: "Hello", heldSince: "2026-09-05T16:00:00.000Z" });
  assert.ok(fwd.includes("delivered this morning") && fwd.includes("Ramesh Singh · 94519 38805") && fwd.includes("8 AM – 8 PM"));
  assert.ok(teacherRelayAck({ teacherName: "Priya", open: true }).includes("has been sent to Priya"));
  assert.ok(teacherRelayAck({ teacherName: "Priya", open: false }).includes("at 8 AM"));
  assert.ok(teacherRelayAck({ teacherName: "Priya", open: false, hindi: true }).includes("सुबह 8 बजे"));
}
console.log("teacherContact.selftest: ok");
