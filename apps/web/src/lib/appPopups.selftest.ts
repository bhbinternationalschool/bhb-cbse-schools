import assert from "node:assert/strict";
import { isValidAadhaar, maskAadhaarNumber, normalizeAppPopup, popupApplies, type AppPopup, type RuleFacts } from "./appPopups";

console.log("appPopups.selftest.ts");

const base = normalizeAppPopup({ id: "p1", title: "Annual day", audience: "parents", frequency: "once" }) as AppPopup;
const none: RuleFacts = { missingDocs: [], missingAadhaar: [], pendingConsents: [] };
const who = { audience: "parents" as const, classIds: ["c5"], facts: none, today: "2026-10-10" };

// Audience, dates, classes
assert.equal(popupApplies(base, who, []), true);
assert.equal(popupApplies(base, { ...who, audience: "staff" }, []), false);
assert.equal(popupApplies({ ...base, startsOn: "2026-10-11" }, who, []), false);
assert.equal(popupApplies({ ...base, endsOn: "2026-10-09" }, who, []), false);
assert.equal(popupApplies({ ...base, targetMode: "classes", classIds: ["c6"] }, who, []), false);
assert.equal(popupApplies({ ...base, targetMode: "classes", classIds: ["c5"] }, who, []), true);
assert.equal(popupApplies({ ...base, active: false }, who, []), false);

// Frequency
const shown = [{ popupId: "p1", event: "shown" as const, createdAt: "2026-10-10T08:00:00Z" }];
assert.equal(popupApplies(base, who, shown), false, "once: never after shown");
assert.equal(popupApplies({ ...base, frequency: "daily" }, who, shown), false, "daily: not twice a day");
assert.equal(popupApplies({ ...base, frequency: "daily" }, { ...who, today: "2026-10-11" }, shown), true);
assert.equal(popupApplies({ ...base, frequency: "until_done" }, who, shown), true, "until done: every open");
assert.equal(popupApplies({ ...base, frequency: "until_done" }, who, [{ popupId: "p1", event: "done", createdAt: "x" }]), false);

// Rules read the live record
const aad = normalizeAppPopup({ id: "a", title: "Aadhaar", targetMode: "rule", rule: "missing_aadhaar", form: "aadhaar", frequency: "until_done" }) as AppPopup;
assert.equal(aad.kind, "form");
assert.equal(popupApplies(aad, who, []), false, "nothing missing → never shown");
assert.equal(popupApplies(aad, { ...who, facts: { ...none, missingAadhaar: ["father"] } }, []), true);
const apaar = normalizeAppPopup({ id: "c", title: "APAAR", targetMode: "rule", rule: "consent_pending", form: "consent", consentKey: "APAAR" }) as AppPopup;
assert.equal(apaar.consentKey, "apaar");
assert.equal(popupApplies(apaar, { ...who, facts: { ...none, pendingConsents: ["apaar"] } }, []), true);
assert.equal(popupApplies(apaar, { ...who, facts: { ...none, pendingConsents: ["photo"] } }, []), false);

// Bad input is cleaned
assert.equal(normalizeAppPopup({ id: "", title: "x" }), null);
assert.equal(normalizeAppPopup({ id: "x", title: "y", imageUrl: "javascript:alert(1)" })!.imageUrl, "");
assert.equal(normalizeAppPopup({ id: "x", title: "y", ctaRoute: "https://evil" })!.ctaRoute, "");
assert.equal(normalizeAppPopup({ id: "x", title: "y", targetMode: "rule" })!.targetMode, "all", "a rule mode with no rule is everyone");

// Aadhaar checksum (UIDAI's published test number) and masking
assert.equal(isValidAadhaar("234123412346"), true);
assert.equal(isValidAadhaar("2341 2341 2346"), true);
assert.equal(isValidAadhaar("234123412345"), false, "one digit wrong");
assert.equal(isValidAadhaar("123412341234"), false, "cannot start with 1");
assert.equal(isValidAadhaar("23412341234"), false, "11 digits");
assert.equal(maskAadhaarNumber("234123412346"), "XXXX-XXXX-2346");

console.log("appPopups.selftest: all assertions passed");
