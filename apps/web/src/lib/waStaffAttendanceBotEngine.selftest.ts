import assert from "node:assert/strict";
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
