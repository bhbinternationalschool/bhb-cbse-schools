/**
 * Linking an unknown number by WhatsApp questions — the pure rules.
 * Run: npx tsx src/lib/waNumberVerify.selftest.ts
 */
import assert from "node:assert/strict";
import {
  advance,
  afterFailedCheck,
  canInvite,
  emptyWaVerifyState,
  isNo,
  isYes,
  liveSession,
  looksLikeName,
  newInvite,
  normalizeWaVerifyState,
  parseClassName,
  parseDob,
  verifyAnswers,
  withSession,
  type WaVerifySession,
} from "./waNumberVerify";
import type { SisStudent } from "./sis";

console.log("waNumberVerify.selftest.ts");

// Yes / no, Hindi and English, with punctuation and the template button.
for (const y of ["हाँ", "हां", "Haan", "ha ji", "Yes", "yes!", "जी", "हाँ, नंबर जोड़ें", "Yes, add my number", "ok 🙏"]) assert.ok(isYes(y), y);
for (const n of ["नहीं", "nahi", "No", "not me", "गलत नंबर", "wrong number"]) assert.ok(isNo(n), n);
assert.ok(!isYes("Rahul Kumar"));
assert.ok(!isNo("Neha"), "a name that starts with N is not a no");

// Dates.
assert.equal(parseDob("05-08-2018", 2026), "2018-08-05");
assert.equal(parseDob("5/8/18", 2026), "2018-08-05");
assert.equal(parseDob("05.08.2018", 2026), "2018-08-05");
assert.equal(parseDob("5 Aug 2018", 2026), "2018-08-05");
assert.equal(parseDob("5 अगस्त 2018", 2026), "2018-08-05");
assert.equal(parseDob("०५-०८-२०१८", 2026), "2018-08-05");
assert.equal(parseDob("31-02-2018", 2026), "", "no 31 February");
assert.equal(parseDob("05-08-1990", 2026), "", "not a schoolchild");
assert.equal(parseDob("2018", 2026), "");
assert.equal(parseDob("kal", 2026), "");

// Classes, in the school's own names.
assert.equal(parseClassName("3"), "III");
assert.equal(parseClassName("class 5"), "V");
assert.equal(parseClassName("कक्षा ७"), "VII");
assert.equal(parseClassName("III"), "III");
assert.equal(parseClassName("ukg"), "UKG");
assert.equal(parseClassName("L.K.G"), "LKG");
assert.equal(parseClassName("नर्सरी"), "Nursery");
assert.equal(parseClassName("दूसरी"), "II");
assert.equal(parseClassName("pata nahi"), "");

assert.ok(looksLikeName("Aarav Singh"));
assert.ok(looksLikeName("आरव सिंह"));
assert.ok(!looksLikeName("12345"));
assert.ok(!looksLikeName("a"));

// The conversation: invite → five questions → verify.
const now = "2026-10-14T10:00:00Z";
let s: WaVerifySession = newInvite("9876543210", "login", now);
let r = advance(s, "हाँ", now);
assert.equal(r.session.step, "name");
assert.match(r.reply, /1\/5/);
r = advance(r.session, "123", now);
assert.equal(r.session.step, "name", "unreadable → asked again");
assert.equal(r.session.reasks, 1);
r = advance(r.session, "Aarav Singh", now);
assert.equal(r.session.step, "dob");
assert.equal(r.session.reasks, 0);
r = advance(r.session, "05-08-2018", now);
assert.equal(r.session.step, "class");
r = advance(r.session, "UKG", now);
assert.equal(r.session.step, "father");
r = advance(r.session, "Ramesh Singh", now);
assert.equal(r.session.step, "mother");
r = advance(r.session, "Sunita Devi", now);
assert.equal(r.action, "verify");
assert.deepEqual(r.session.answers, { childName: "Aarav Singh", dob: "2018-08-05", className: "UKG", fatherName: "Ramesh Singh", motherName: "Sunita Devi" });
s = r.session;

// "No" to the invitation ends it politely.
assert.equal(advance(newInvite("9876543210", "login", now), "नहीं", now).session.step, "declined");
// Straight into a name is taken as yes + the first answer.
assert.equal(advance(newInvite("9876543210", "login", now), "Priya Sharma", now).session.step, "dob");
// Three unreadable dates → office, with what was said.
let d = advance(newInvite("9876543210", "login", now), "हाँ", now);
d = advance(d.session, "Priya", now);
d = advance(d.session, "pata nahi", now);
d = advance(d.session, "kal", now);
d = advance(d.session, "?", now);
assert.equal(d.action, "office");
assert.equal(d.session.step, "office");

// A failed check: one more round (answers cleared), then the office.
const f1 = afterFailedCheck(s, "no child on roll", now);
assert.equal(f1.session.step, "name");
assert.equal(f1.session.rounds, 1);
assert.equal(f1.session.answers.childName, "");
assert.doesNotMatch(f1.reply, /father|पिता|DOB/i, "never says which answer was wrong");
const f2 = afterFailedCheck(f1.session, "no child on roll", now);
assert.equal(f2.action, "office");

// The check itself.
const child = (over: Partial<SisStudent>): SisStudent =>
  ({ id: "s1", fullName: "AARAV SINGH", dob: "2018-08-05", classId: "c_ukg", householdId: "h1", fatherName: "RAMESH SINGH", motherName: "SUNITA DEVI", admissionNo: "BHB-1", status: "active", ...over }) as SisStudent;
const cls = (id: string) => ({ c_ukg: "UKG", c_lkg: "LKG" })[id] ?? "";
const roll = [child({}), child({ id: "s2", fullName: "PRIYA SHARMA", dob: "2017-01-10", householdId: "h2", fatherName: "MOHAN SHARMA", motherName: "GITA" })];
assert.equal(verifyAnswers(roll, s.answers, cls).kind, "verified");
// Father wrong but mother right → verified (either parent).
assert.equal(verifyAnswers(roll, { ...s.answers, fatherName: "Somebody Else" }, cls).kind, "verified");
// Both parents wrong → no.
const both = verifyAnswers(roll, { ...s.answers, fatherName: "X Y", motherName: "Z W" }, cls);
assert.equal(both.kind, "no_match");
// Wrong class → no, even with everything else right.
assert.equal(verifyAnswers(roll, { ...s.answers, className: "LKG" }, cls).kind, "no_match");
// Wrong DOB → no.
assert.equal(verifyAnswers(roll, { ...s.answers, dob: "2018-08-06" }, cls).kind, "no_match");
// An inactive child is never matched, even with every answer right.
assert.equal(verifyAnswers([child({ status: "inactive" } as Partial<SisStudent>)], s.answers, cls).kind, "no_match");
// …and an inactive twin does not make an active child "ambiguous".
assert.equal(verifyAnswers([child({}), child({ id: "s9", status: "inactive" } as Partial<SisStudent>)], s.answers, cls).kind, "verified");

// Spelling: "Arav" ~ "AARAV", "Rmesh" no.
assert.equal(verifyAnswers(roll, { ...s.answers, childName: "Arav" }, cls).kind, "verified");

// Sessions: live, expiry, re-invite rules.
let st = withSession(emptyWaVerifyState(), newInvite("9876543210", "login", now));
const t0 = Date.parse(now);
assert.ok(liveSession(st, "9876543210", t0 + 86_400_000));
assert.equal(liveSession(st, "9876543210", t0 + 8 * 86_400_000), null, "invite expires after a week");
assert.equal(canInvite(st, "9876543210", t0 + 86_400_000).ok, false, "mid-conversation");
assert.equal(canInvite(st, "9876543210", t0 + 8 * 86_400_000).ok, true, "expired invite can be sent again");
assert.equal(canInvite(st, "1940892168", t0).ok, false, "mistyped number");
st = withSession(st, { ...newInvite("9876543210", "login", now), step: "linked" });
assert.equal(canInvite(st, "9876543210", t0 + 30 * 86_400_000, true).ok, false, "linked numbers are never asked again");
assert.deepEqual(normalizeWaVerifyState(JSON.parse(JSON.stringify(st))), st, "round-trips");
assert.equal(normalizeWaVerifyState({ sessions: [{ mobile10: "x", step: "name" }] }).sessions.length, 0);

console.log("ok");
