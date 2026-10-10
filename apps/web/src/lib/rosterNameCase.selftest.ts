/**
 * One convention for names and places, enforced where every write passes.
 *
 * The student form has upper-cased as the office types since it was
 * written, and 234 of the school's 239 students follow it. But the rule
 * lived in that ONE form, so every other way in kept whatever case it was
 * handed — the admissions desk copies a child's name straight off the
 * public enquiry form, and so does RTE. That produced "Yatharth Singh",
 * "Rudraksha Yadav" and "Anjal" (whose father reads "VINAY GUPTA", because
 * the father was typed at the counter and the child came from an enquiry),
 * and left 118 of 199 guardian names and 112 city names in mixed case.
 *
 * Run: npx tsx src/lib/rosterNameCase.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeHousehold, normalizeStudent, toRosterCase } from "./sis";

console.log("rosterNameCase.selftest.ts");

/* ── The three real records that slipped through admissions ── */
for (const [given, want] of [
  ["Yatharth Singh", "YATHARTH SINGH"],
  ["Rudraksha Yadav", "RUDRAKSHA YADAV"],
  ["Anjal", "ANJAL"],
  ["Aarav Sharma", "AARAV SHARMA"],
] as const) {
  assert.equal(normalizeStudent({ id: "s1", fullName: given }).fullName, want);
}

/* Already in the convention: untouched. */
assert.equal(normalizeStudent({ id: "s1", fullName: "ARADHYA KUMARI" }).fullName, "ARADHYA KUMARI");
/* Parents' names follow the child's. */
const s = normalizeStudent({ id: "s1", fullName: "Anjal", fatherName: "Vinay Gupta", motherName: "sunita devi" });
assert.equal(s.fatherName, "VINAY GUPTA");
assert.equal(s.motherName, "SUNITA DEVI");
/* Empty stays empty — the convention never invents a name. */
assert.equal(normalizeStudent({ id: "s1", fullName: "" }).fullName, "");
assert.equal(normalizeStudent({ id: "s1" }).motherName, "");

/* The de-duplication that already ran still runs, and its result is cased. */
assert.equal(normalizeStudent({ id: "s1", fullName: "Ravi Kumar / Ravi Kumar" }).fullName, "RAVI KUMAR");

/* ── Households: guardian and place, not the email ── */
const h = normalizeHousehold({
  id: "hh1",
  guardianName: "Mr. Satya Prakash Singh",
  address: "Vill Ayar, Post Ayar",
  locality: "Ayar",
  landmark: "near the temple",
  city: "Varanasi",
  state: "Uttar Pradesh",
  email: "Satya.Prakash@Example.COM",
});
assert.equal(h.guardianName, "MR. SATYA PRAKASH SINGH");
assert.equal(h.address, "VILL AYAR, POST AYAR");
assert.equal(h.locality, "AYAR");
assert.equal(h.landmark, "NEAR THE TEMPLE");
assert.equal(h.city, "VARANASI");
assert.equal(h.state, "UTTAR PRADESH");
assert.equal(h.email, "Satya.Prakash@Example.COM", "an address is a name; an email is an identifier and is left alone");
/* The default state is written in the convention too. */
assert.equal(normalizeHousehold({ id: "hh2" }).state, "UTTAR PRADESH");
/* Digits are never touched by a case rule. */
assert.equal(normalizeHousehold({ id: "hh3", pincode: "221007" }).pincode, "221007");

/* ── Scripts without case pass through unharmed ── */
assert.equal(toRosterCase("आराध्या कुमारी"), "आराध्या कुमारी");
assert.equal(normalizeStudent({ id: "s1", fullName: "आराध्या कुमारी" }).fullName, "आराध्या कुमारी");
assert.equal(toRosterCase(""), "");

console.log("ok");
