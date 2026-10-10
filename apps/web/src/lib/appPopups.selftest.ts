import assert from "node:assert/strict";
import { aadhaarInScope, countAadhaarGaps, isValidAadhaar, maskAadhaarNumber, normalizeAppPopup, popupApplies, type AppPopup, type RuleFacts } from "./appPopups";

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

// An Aadhaar / documents form ends when the record is complete, not when
// something was saved (10 Oct 2026): one child's number saved, a sibling's
// still missing → asked again, for the sibling.
{
  const done = [{ popupId: "a", event: "done" as const, createdAt: "2026-10-10T08:00:00Z" }];
  assert.equal(popupApplies(aad, { ...who, facts: { ...none, missingAadhaar: ["stu_sibling"] } }, done), true, "a sibling still missing → asked again");
  assert.equal(popupApplies(aad, who, done), false, "record complete → never again");
  const docs = normalizeAppPopup({ id: "d", title: "Docs", targetMode: "rule", rule: "missing_docs", form: "documents", frequency: "until_done" }) as AppPopup;
  const docsDone = [{ popupId: "d", event: "done" as const, createdAt: "x" }];
  assert.equal(popupApplies(docs, { ...who, facts: { ...none, missingDocs: ["stu1"] } }, docsDone), true);
  // A consent is answered once — done still ends it.
  assert.equal(popupApplies(apaar, { ...who, facts: { ...none, pendingConsents: ["apaar"] } }, [{ popupId: "c", event: "done", createdAt: "x" }]), false);
}

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

// Aadhaar scope (director, 10 Oct 2026): child only, parents only, or both.
assert.equal(normalizeAppPopup({ id: "a", title: "t" })!.aadhaarScope, "all", "old pop-ups ask for everyone, as before");
assert.equal(normalizeAppPopup({ id: "a", title: "t", aadhaarScope: "parents" })!.aadhaarScope, "parents");
assert.deepEqual(aadhaarInScope(["stu1", "father"], "parents"), ["father"]);
assert.deepEqual(aadhaarInScope(["stu1", "father"], "child"), ["stu1"]);
assert.deepEqual(aadhaarInScope(["stu1", "father"], "all"), ["stu1", "father"]);
{
  const base = normalizeAppPopup({ id: "aa", title: "Aadhaar", targetMode: "rule", rule: "missing_aadhaar", form: "aadhaar", frequency: "until_done", aadhaarScope: "parents" })!;
  const who = (missing: string[]) => ({ audience: "parents" as const, classIds: [], today: "2026-10-10", facts: { missingDocs: [], missingAadhaar: missing, pendingConsents: [] } });
  assert.equal(popupApplies(base, who(["stu1"]), []), false, "parents-only pop-up skips a family missing only the child's");
  assert.equal(popupApplies(base, who(["stu1", "mother"]), []), true);
}
assert.deepEqual(
  countAadhaarGaps([
    { children: 2, missing: ["s1", "s2", "father"] },
    { children: 1, missing: ["mother"] },
    { children: 1, missing: [] },
    { children: 0, missing: ["father"] },
  ]),
  { families: 3, children: 4, childrenMissing: 2, familiesChildMissing: 1, fatherMissing: 1, motherMissing: 1, familiesParentMissing: 2, reach: { all: 2, child: 1, parents: 2 } },
);

console.log("appPopups.selftest: all assertions passed");
