import assert from "node:assert/strict";
// The routing gate lives in the server module but is a pure predicate,
// and it is the thing that decides whether a command reaches the desk.
import { shouldRouteStaffAttendance } from "./waStaffAttendanceBotServer";
import {
  composeStaffAttPunchSuccess,
  detectStaffAttBotIntent,
  isEarlyOutConfirm,
  parseStaffAttLanguage,
  staffAttAskLocationText,
  staffAttBotWelcomeText,
  staffAttEarlyOutWarningText,
  staffAttLanguageConfirmText,
  staffAttLanguageMenuText,
} from "./waStaffAttendanceBotEngine";

console.log("waStaffAttendanceBotEngine.selftest.ts");
// Language: 1/2, names, scripts; garbage → null (ask again).
assert.equal(parseStaffAttLanguage("1"), "en");
assert.equal(parseStaffAttLanguage("2."), "hi");
assert.equal(parseStaffAttLanguage("हिंदी"), "hi");
assert.equal(parseStaffAttLanguage("English"), "en");
assert.equal(parseStaffAttLanguage("bengali"), null);
assert.match(staffAttLanguageMenuText("Ravi"), /\*1\* — English[\s\S]*\*2\* — हिंदी/);
assert.match(staffAttLanguageConfirmText("hi"), /हिंदी/);

// Intents incl. Hindi aliases + LANG.
assert.equal(detectStaffAttBotIntent("IN"), "in");
assert.equal(detectStaffAttBotIntent("punch out"), "out");
assert.equal(detectStaffAttBotIntent("छुट्टी"), "out");
assert.equal(detectStaffAttBotIntent("भाषा"), "lang");
assert.equal(detectStaffAttBotIntent("STATUS"), "status");
assert.equal(detectStaffAttBotIntent("random text"), "unknown");
assert.equal(detectStaffAttBotIntent("attendance"), "attend");
assert.equal(detectStaffAttBotIntent("language"), "lang");
assert.equal(detectStaffAttBotIntent("my attendance"), "status");

// Regression: this bot runs BEFORE the ERP command desk, and on a thread
// with no saved language it answered with the language menu and dropped
// the intent. Every message below was taken by an UNANCHORED alias on
// live traffic — `/hr/` inside "Mishra", `/help/`, `/आज/`, `/today/`,
// `/attendance/`, `/office/` — so the command never ran and the same
// language menu came back each time. Each of these belongs to the desk.
for (const desk of [
  "help",
  "Help",
  "मदद",
  "Kavya mishra",
  "Kavya mishra ki fees pending",
  "Yatharth mishra ka kitna bakaya hai",
  "Today's collection",
  "Today’s collection",
  "आज 5A में कौन अनुपस्थित है",
  "attendance summary",
  "attendance summary 5A",
  "5A ki attendance",
  "उपस्थिति सारांश",
  "office me kaun hai",
  "Shreya Sharma",
  "3 free teachers",
]) {
  assert.equal(
    detectStaffAttBotIntent(desk),
    "unknown",
    `attendance bot must not claim "${desk}" — it is a desk command`,
  );
}

// Early-out confirm words.
assert.equal(isEarlyOutConfirm("YES"), true);
assert.equal(isEarlyOutConfirm("हाँ"), true);
assert.equal(isEarlyOutConfirm("no"), false);

// Bilingual texts carry the essentials.
assert.match(staffAttBotWelcomeText("R", "hi"), /पंच इन|पंच आउट|IN/);
assert.match(staffAttAskLocationText("out", "en"), /Send your current location/);
const warnEn = staffAttEarlyOutWarningText({ now: "12:10", end: "15:30", lang: "en" });
assert.match(warnEn, /12:10[\s\S]*15:30[\s\S]*early checkout/i);
const warnHi = staffAttEarlyOutWarningText({ now: "12:10", end: "15:30", lang: "hi" });
assert.match(warnHi, /स्कूल समय[\s\S]*12:10[\s\S]*15:30/);
const okOut = composeStaffAttPunchSuccess({ kind: "out", time: "12:15", distanceM: 40, staffName: "Ravi", earlyOut: true, schoolEnd: "15:30", lang: "en" });
assert.match(okOut, /Early checkout within school timing \(till 15:30\)/);
const okHi = composeStaffAttPunchSuccess({ kind: "in", time: "08:05", distanceM: 900, staffName: "Ravi", lang: "hi" });
assert.match(okHi, /पंच IN दर्ज हुआ[\s\S]*900 m/);
console.log("OK — waStaffAttendanceBotEngine.selftest.ts");

// ── Who owns the turn ─────────────────────────────────────────────────
// This bot runs before the ERP command desk. A `true` here takes the
// message away from every command, so the gate has to be narrow.
assert.equal(shouldRouteStaffAttendance({ text: "IN" }), true);
assert.equal(shouldRouteStaffAttendance({ text: "OUT" }), true);
assert.equal(shouldRouteStaffAttendance({ text: "", location: { lat: 25.3, lng: 82.9 } }), true);
assert.equal(shouldRouteStaffAttendance({ text: "help" }), false);
assert.equal(shouldRouteStaffAttendance({ text: "Kavya mishra ki fees pending" }), false);
assert.equal(shouldRouteStaffAttendance({ text: "attendance summary 5A" }), false);

// A pending punch waits for a location pin, not for the rest of the day.
// It used to claim every message while it waited, which took the command
// desk away from anyone who typed IN and never sent the pin.
assert.equal(shouldRouteStaffAttendance({ text: "help", hasPending: true }), false);
assert.equal(shouldRouteStaffAttendance({ text: "Today's collection", hasPending: true }), false);
assert.equal(shouldRouteStaffAttendance({ text: "YES", hasPending: true }), true);
assert.equal(shouldRouteStaffAttendance({ text: "CANCEL", hasPending: true }), true);
assert.equal(shouldRouteStaffAttendance({ text: "1", hasPending: true }), true);
assert.equal(shouldRouteStaffAttendance({ text: "", location: { lat: 25.3, lng: 82.9 }, hasPending: true }), true);

console.log("OK — attendance bot claims only attendance turns");
