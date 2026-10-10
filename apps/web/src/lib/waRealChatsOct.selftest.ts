/**
 * Run: npx tsx src/lib/waRealChatsOct.selftest.ts
 *
 * Every case here is a real WhatsApp message from 17 Sep – 2 Oct 2026 that
 * the bot answered wrongly (names left out). See the PR "WhatsApp: roles,
 * photos, complaints".
 */
import assert from "node:assert/strict";
import { defaultRoleKind, shouldShowUnifiedMenu, staffSidePhrase } from "./waUnifiedBotEngine";
import { detectSisComplaintLetter, detectSisFeeQuestion } from "./sisParentBotEngine";
import { formatAttendanceSummaryReply, parseErpCommandLocal } from "./erpCommands";

// ── The principal: Director + Teacher is one person at work ───────────────
assert.equal(defaultRoleKind([{ kind: "owner" }, { kind: "teacher" }]), "owner", "no profile question");
assert.equal(defaultRoleKind([{ kind: "staff" }, { kind: "teacher" }]), "staff");
assert.equal(defaultRoleKind([{ kind: "teacher" }]), "teacher");
// A teacher who is also a parent here: two people's business — still asked.
assert.equal(defaultRoleKind([{ kind: "teacher" }, { kind: "parent" }]), null);
assert.equal(defaultRoleKind([{ kind: "owner" }, { kind: "vendor" }]), null);

// Her class-9 attendance sheet, sent as photos: never the menu again.
const photo = { text: "", known: true, hasSession: true, hasAudio: false, hasLocation: false };
assert.equal(shouldShowUnifiedMenu({ ...photo, staff: true }), false, "staff photo keeps the role");
assert.equal(shouldShowUnifiedMenu({ ...photo, staff: true, text: "menu" }), true, "typed menu still resets");
assert.equal(shouldShowUnifiedMenu({ ...photo, staff: false }), true, "a parent's bare photo is unchanged");

// ── "Teacher attendance आज का क्या है?" is the staff register ─────────────
const ask = parseErpCommandLocal("Teacher attendance आज का क्या है?");
assert.equal(ask?.commandId, "attendance_summary");
assert.equal(ask?.fields.text, "staff");
const plain = parseErpCommandLocal("aaj ki attendance");
assert.equal(plain?.commandId, "attendance_summary");
assert.equal(plain?.fields.text, undefined, "a plain attendance ask stays school-wide");
const reply = formatAttendanceSummaryReply({
  date: "2026-10-03",
  todayIso: "2026-10-03",
  scope: "school",
  focus: "staff",
  classes: [{ className: "IX", sections: [{ label: "IX A", total: 30, marked: false, holiday: false, present: 0, absent: 0, leave: 0, late: 0, halfDay: 0 }] }],
  staff: {
    activeStaff: 18,
    registerMarked: true,
    present: 16,
    absent: 0,
    leave: 2,
    notPunched: [],
    leaveNames: ["Kiran Patel", "Vishnu Tripathi"],
    absentNames: [],
    lateNames: [],
  },
});
assert.match(reply, /^\*Staff attendance\* · today/);
assert.match(reply, /Present \*16\* · On leave 2 of 18/);
assert.match(reply, /On leave: Kiran Patel, Vishnu Tripathi/);
assert.match(reply, /Students: no section marked yet \(1 pending\)/, "the classes come second, in one line");

// ── A teacher on a parent's number ─────────────────────────────────────────
for (const t of ["Show my class", "Show my class students", "My attendance today", "Mai class 1 ki class teacher hu", "IN"]) {
  assert.equal(staffSidePhrase(t), true, t);
}
for (const t of ["attendance", "Riya ki attendance", "KIDS", "Show my child's class", "fees kitni hai"]) {
  assert.equal(staffSidePhrase(t), false, t);
}

// ── A parent's written complaint goes to a person ─────────────────────────
const letterHi =
  "सेवा में,\n*प्रधानाचार्य महोदय,*\n[बी एच बी इंटरनेशन स्कूल ]\n\n*विषय: शुल्क भुगतान के संबंध में गलत संदेश प्राप्त होने हेतु*\n\nमान्यवर,\n\nसविनय निवेदन है कि मेरा पुत्र कक्षा LKG में अध्ययनरत है, उसका अगस्त 2026 तक का संपूर्ण शुल्क जमा है।";
const letterEn =
  "To,\nThe Principal,\nBHB International School\n\n*Subject: Regarding receiving incorrect messages for fee payment*\n\nRespected Sir,\n\nThis is to humbly submit that my son, who is studying in Class LKG in your school, his complete fees has been paid";
assert.equal(detectSisComplaintLetter(letterHi), true);
assert.equal(detectSisComplaintLetter(letterEn), true);
assert.equal(detectSisComplaintLetter("Mujhe galat message aa raha hai fees ka, maine jama kar diya"), true);
// Ordinary questions are not letters.
for (const t of ["DUES", "fees kitni hai class 5 ki", "थोड़ा समय चाहिए", "Security deposit kya hai", "Hindi", "bus kab aayegi"]) {
  assert.equal(detectSisComplaintLetter(t), false, t);
}

console.log("OK — waRealChatsOct.selftest.ts");
