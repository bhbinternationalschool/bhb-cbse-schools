import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SisStudent } from "./sis";
import {
  admissionAgrees,
  emptyParentLinkState,
  linkedHousehold,
  livePending,
  maskMobile,
  matchChild,
  namesAgree,
  normalizeParentLinkState,
  withLinked,
} from "./parentNumberLink";

console.log("parentNumberLink.selftest.ts");

/**
 * A parent links a phone the school never recorded: the child (admission
 * number OR name) + exact date of birth must match one child on roll; then
 * the family's registered phone (code) or the office decides.
 */

const kid = (id: string, name: string, dob: string, adm: string, hh: string, cls = "c4") =>
  ({ id, fullName: name, dob, admissionNo: adm, householdId: hh, classId: cls, status: "active", academicYearCode: "2026-27" }) as unknown as SisStudent;
const roll = [
  kid("s1", "SHREYA PATEL", "2015-05-27", "BHB-2024-25-1139", "hhA", "c4"),
  kid("s2", "AARAV SINGH", "2018-03-02", "BHB-2023-24-1001", "hhB", "c2"),
  kid("s3", "AARAV SINGH", "2018-03-02", "BHB-2025-26-1200", "hhC", "c3"),
];
const cls = (id: string) => ({ c2: "II", c3: "III", c4: "IV" })[id] ?? "";

// ── Names and admission numbers as parents type them ──────────────────────
assert.equal(namesAgree("shreya", "SHREYA PATEL"), true, "first name alone");
assert.equal(namesAgree("Sreya Patel", "SHREYA PATEL"), true, "sh/s spelling");
assert.equal(namesAgree("Shreya Kumari Patel", "SHREYA PATEL"), true, "kumari ignored");
assert.equal(namesAgree("Riya", "SHREYA PATEL"), false);
assert.equal(admissionAgrees("1139", "BHB-2024-25-1139"), true, "serial only");
assert.equal(admissionAgrees("bhb 2024 25 1139", "BHB-2024-25-1139"), true);
assert.equal(admissionAgrees("1138", "BHB-2024-25-1139"), false);

// ── Matching: date of birth always required ────────────────────────────────
assert.equal(matchChild(roll, { childName: "Shreya", dob: "2015-05-27" }, cls).kind, "one");
assert.equal(matchChild(roll, { admissionNo: "1139", dob: "2015-05-27" }, cls).kind, "one", "admission number instead of name");
assert.equal(matchChild(roll, { childName: "Shreya", dob: "2015-05-28" }, cls).kind, "none", "wrong date of birth never matches");
assert.equal(matchChild(roll, { childName: "Shreya", dob: "" }, cls).kind, "none");
assert.equal(matchChild(roll, { dob: "2015-05-27" }, cls).kind, "none", "a date of birth alone is not enough");
const many = matchChild(roll, { childName: "Aarav Singh", dob: "2018-03-02" }, cls);
assert.equal(many.kind, "many");
if (many.kind === "many") assert.deepEqual(many.classes.sort(), ["II", "III"], "asks the class");
const picked = matchChild(roll, { childName: "Aarav Singh", dob: "2018-03-02", className: "III" }, cls);
assert.ok(picked.kind === "one" && picked.student.householdId === "hhC");

// ── State ──────────────────────────────────────────────────────────────────
let s = emptyParentLinkState();
s = withLinked(s, { mobile10: "9876543210", householdId: "hhA", childName: "SHREYA PATEL", via: "registered_code", linkedAt: "x", by: "code" });
assert.equal(linkedHousehold(s, "9876543210"), "hhA");
s = withLinked(s, { mobile10: "9876543210", householdId: "hhB", childName: "x", via: "office", linkedAt: "y", by: "office" });
assert.equal(s.linked.length, 1, "a number belongs to one family");
assert.equal(maskMobile("9120294536"), "******4536");
const now = Date.parse("2026-10-10T10:00:00Z");
const st = normalizeParentLinkState({
  pending: [
    { id: "a", mobile10: "9876543210", householdId: "h", registeredMobile10: "9120294536", createdAt: "2026-10-10T09:55:00Z" },
    { id: "b", mobile10: "9876543211", householdId: "h", registeredMobile10: "9120294536", createdAt: "2026-10-10T09:40:00Z" },
  ],
});
assert.deepEqual(livePending(st, now).map((p) => p.id), ["a"], "a code lasts 10 minutes");
assert.equal(normalizeParentLinkState({ linked: [{ mobile10: "123", householdId: "h" }] }).linked.length, 0, "bad numbers dropped");

// ── Wiring ─────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const server = read("parentNumberLink.server.ts");
assert.ok(/issueParentOtp\(\{ mobile: registered, householdId: household\.id \}\)/.test(server), "the code goes to the REGISTERED number");
assert.ok(/verifyParentOtp\(\{ mobile: p\.registeredMobile10, code \}\)/.test(server), "and is checked against it");
assert.ok(/childrenOnRoll\(loadSis\(\)\.students, ay\)/.test(server), "only children on roll (an inactive family never matches)");
assert.ok(/tooMany\(`m:\$\{mobile10\}`, 6\) \|\| tooMany\(`ip:\$\{input\.ip\}`, 15\)/.test(server), "rate-limited");
assert.ok(/fetchLinkedHousehold\(mobile10\)/.test(read("parentHousehold.server.ts")), "a linked number logs in");
assert.ok(/code: "unknown_number"/.test(read("../app/api/auth/otp/request/route.ts")), "the app is told to offer linking");
assert.ok(/code: "invalid_number"/.test(read("../app/api/auth/otp/request/route.ts")), "a mistyped number is said so at once");
assert.ok(/parentSessionResponse\(\{/.test(read("../app/api/auth/link/verify/route.ts")), "signs in the same way an OTP login does");
const app = readFileSync(join(__dirname, "../../../../cbse_school_mobile/lib/features/auth/login_screen.dart"), "utf8");
assert.ok(/_errorCode == "unknown_number"/.test(app) && /LinkNumberScreen\(/.test(app), "the login screen offers it");

console.log("parentNumberLink.selftest: all assertions passed");
