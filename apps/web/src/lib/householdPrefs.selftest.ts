import assert from "node:assert/strict";

import {
  householdLanguage,
  isInQuietHours,
  languageChoiceConfirmation,
  languageMenuText,
  parseLanguageChoice,
  normalizeHouseholdChannel,
  normalizeHouseholdLanguage,
  normalizeQuietTime,
  quietHoursLabel,
  sarvamTargetFor,
  SCHOOL_DEFAULT_WA_LANGUAGE,
  waTemplateLanguageFor,
} from "./householdPrefs";

console.log("householdPrefs.selftest.ts");

// Unknown must not become fact: "" stays "", garbage stays "".
assert.equal(normalizeHouseholdLanguage(""), "");
assert.equal(normalizeHouseholdLanguage("fr"), "");
assert.equal(normalizeHouseholdLanguage(" HI "), "hi");
assert.equal(normalizeHouseholdChannel("WhatsApp"), "whatsapp");
assert.equal(normalizeHouseholdChannel("pigeon"), "");
assert.equal(normalizeQuietTime("9:05"), "09:05");
assert.equal(normalizeQuietTime("24:00"), "");
assert.equal(normalizeQuietTime("21"), "");

// Default is labelled as default, not as the family's choice.
assert.deepEqual(householdLanguage(null), { language: "en", source: "default" });
assert.deepEqual(householdLanguage({ preferredLanguage: "" }, "hi"), { language: "hi", source: "default" });
assert.deepEqual(householdLanguage({ preferredLanguage: "bho" }), { language: "bho", source: "household" });

// Regional collapses to Hindi templates; en/hi pass through; unset → school default.
assert.equal(waTemplateLanguageFor({ preferredLanguage: "mai" }), "hi");
assert.equal(waTemplateLanguageFor({ preferredLanguage: "en" }, "hi"), "en");
assert.equal(waTemplateLanguageFor({ preferredLanguage: "" }, "hi"), "hi");
// A family we know nothing about gets the SCHOOL's language, not English.
// Hindi since 2026-09-07: all 198 households had a blank preference, so the
// old hardcoded "en" meant every parent was written to in English. Asserted
// against the constant rather than the literal, so the school can change its
// mind in one place without this test having to be edited to agree.
assert.equal(waTemplateLanguageFor(undefined), SCHOOL_DEFAULT_WA_LANGUAGE);
assert.equal(
  waTemplateLanguageFor({ preferredLanguage: "" }),
  SCHOOL_DEFAULT_WA_LANGUAGE,
  "a blank preference is not a preference for English",
);
// A family that HAS chosen still overrides the school default, both ways.
assert.equal(waTemplateLanguageFor({ preferredLanguage: "en" }), "en");

// Sarvam only for languages beyond en/hi that it can actually produce.
assert.equal(sarvamTargetFor({ preferredLanguage: "en" }), null);
assert.equal(sarvamTargetFor({ preferredLanguage: "hi" }), null);
assert.equal(sarvamTargetFor({ preferredLanguage: "bn" }), "bn-IN");
assert.equal(sarvamTargetFor({ preferredLanguage: "bho" }), null, "Bhojpuri: no Sarvam target → send Hindi");

// Quiet hours in IST, crossing midnight.
const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 7, 18, utcHour, utcMin));
const night = { quietHoursStart: "21:00", quietHoursEnd: "07:00" };
assert.equal(isInQuietHours(night, at(17, 0)), true, "22:30 IST is quiet");
assert.equal(isInQuietHours(night, at(0, 0)), true, "05:30 IST is quiet");
assert.equal(isInQuietHours(night, at(6, 0)), false, "11:30 IST is not");
assert.equal(isInQuietHours(night, at(1, 30)), false, "07:00 IST — window end is exclusive");
const lunch = { quietHoursStart: "13:00", quietHoursEnd: "14:00" };
assert.equal(isInQuietHours(lunch, at(8, 0)), true, "13:30 IST");
assert.equal(isInQuietHours(lunch, at(9, 0)), false, "14:30 IST");
assert.equal(isInQuietHours({}, at(17, 0)), false, "no window → never quiet");
assert.equal(isInQuietHours({ quietHoursStart: "21:00", quietHoursEnd: "" }, at(17, 0)), false, "half a window is no window");
assert.equal(quietHoursLabel(night), "21:00–07:00");
assert.equal(quietHoursLabel({}), "");

// Language menu flow parsing
{
  assert.equal(parseLanguageChoice("2"), "hi");
  assert.equal(parseLanguageChoice("2."), "hi");
  assert.equal(parseLanguageChoice("Hindi"), "hi");
  assert.equal(parseLanguageChoice("हिन्दी"), "hi");
  assert.equal(parseLanguageChoice("bangla"), "bn");
  assert.equal(parseLanguageChoice("7"), null);
  assert.equal(parseLanguageChoice("kids"), null);
  assert.match(languageMenuText(), /^Which language should the school message you in\?/);
  assert.match(languageMenuText(), /2 — हिंदी \(Hindi\)/);
  assert.match(languageChoiceConfirmation("ur"), /LANG/);
}

console.log("OK — householdPrefs.selftest.ts");
