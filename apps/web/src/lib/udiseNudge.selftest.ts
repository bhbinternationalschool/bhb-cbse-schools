/**
 * Self-test: the UDISE+ / APAAR message to parents, and whose Aadhaar a card is.
 * Run: npx tsx src/lib/udiseNudge.selftest.ts
 *
 * What must hold:
 *  - a family is told exactly what each child still needs, and nothing for
 *    a child who is complete;
 *  - the message never calls APAAR compulsory (the Ministry says it is
 *    voluntary) and cites the Ministry for what it does claim;
 *  - at most weekly, at most four times, never at night;
 *  - a parent's Aadhaar card, which never prints "father" or "mother", is
 *    filed under the parent whose name it carries.
 */

import assert from "node:assert/strict";

import {
  composeUdiseNudge,
  udiseNudgeDue,
  udiseNudgeLogLine,
  udiseNudgeNeeds,
  UDISE_NUDGE_MAX,
} from "./udiseNudge";
import { planUdiseCorrections, resolveDocPerson, type UdiseDocExtract } from "./udiseDocIntakeAi";
import type { SisStudent } from "./sis";

console.log("udiseNudge.selftest.ts");

/* ── What each child needs ───────────────────────────────────────── */
{
  const needs = udiseNudgeNeeds(
    [
      { name: "Aarav Singh", classLabel: "V A", gaps: ["student_aadhaar", "pen", "apaar", "parent_aadhaar"], hasDob: true, hasAddress: true },
      { name: "Riya Singh", classLabel: "II A", gaps: ["apaar"], hasDob: false, hasAddress: true },
      { name: "Done Child", classLabel: "I A", gaps: [], hasDob: false, hasAddress: false },
    ],
    "en",
  );
  assert.deepEqual(needs.map((n) => n.name), ["Aarav Singh", "Riya Singh"], "a complete child needs nothing and is left out");
  assert.deepEqual(needs[0]!.docs, ["child's Aadhaar card", "father's or mother's Aadhaar card"]);
  assert.equal(needs[0]!.consent, true);
  assert.deepEqual(needs[1]!.docs, ["birth certificate"]);
  assert.equal(needs[1]!.consent, true, "no APAAR yet: the consent form is needed even when every card is on file");
  assert.equal(udiseNudgeLogLine(needs), "Aarav Singh: child's Aadhaar card, father's or mother's Aadhaar card, APAAR consent form · Riya Singh: birth certificate, APAAR consent form");
  // Aadhaar received but not yet verified on the portal: the school's job, not the parent's.
  assert.deepEqual(udiseNudgeNeeds([{ name: "Shruti", classLabel: "VII A", gaps: ["student_aadhaar_unverified", "apaar"], hasDob: true, hasAddress: true }], "en")[0]!.docs, [], "never asked to resend a card we hold");
  // A PEN missing on the portal side, APAAR already made: nothing the parent can send.
  assert.deepEqual(udiseNudgeNeeds([{ name: "X", classLabel: "I", gaps: ["pen"], hasDob: true, hasAddress: true }], "en"), []);
}

/* ── The message ─────────────────────────────────────────────────── */
{
  const needs = udiseNudgeNeeds([{ name: "Aarav Singh", classLabel: "V A", gaps: ["student_aadhaar", "apaar"], hasDob: true, hasAddress: true }], "hi");
  const hi = composeUdiseNudge({ guardianName: "Ramesh Singh", needs, language: "hi", consentAttached: true });
  assert.match(hi, /^📋 \*UDISE\+ \/ APAAR ID — ज़रूरी दस्तावेज़\*\nनमस्ते Ramesh Singh जी/);
  assert.match(hi, /\*Aarav Singh\* \(V A\)\n• बच्चे का आधार कार्ड\n• APAAR सहमति फ़ॉर्म — भरकर व हस्ताक्षर करके \(साथ में भेजा है\)/);
  assert.match(hi, /जल्द से जल्द/, "urgent, as the school asked");
  assert.match(hi, /PEN\* \(Permanent Education Number\)/);
  assert.match(hi, /One Nation One Student ID/);
  assert.match(hi, /apaar\.education\.gov\.in/, "the source is named");
  assert.match(hi, /आपकी सहमति से बनती है/, "consent is said, as the Ministry says it");
  assert.match(hi, /आधार नंबर चैट में टाइप न करें/, "a full Aadhaar never in chat");

  const en = composeUdiseNudge({ guardianName: "", needs: udiseNudgeNeeds([{ name: "Riya", classLabel: "II A", gaps: ["apaar"], hasDob: false, hasAddress: true }], "en"), language: "en", consentAttached: false });
  assert.match(en, /^📋 \*UDISE\+ \/ APAAR ID — documents needed\*\nDear Parent/);
  assert.match(en, /• birth certificate\n• APAAR consent form — filled in and signed\n/, "no '(attached)' when the form could not be attached");
  assert.match(en, /made only with your consent/);
  // Never more than the sources say.
  for (const t of [hi, en]) {
    assert.doesNotMatch(t, /APAAR[^\n.]*(compulsory|mandatory for (all|every) student)/i, "APAAR is voluntary — never called compulsory");
    assert.doesNotMatch(t, /admission (will be|is) (refused|denied|cancelled)/i, "no threats the Ministry does not make");
    assert.ok(t.length < 4096, "one WhatsApp message");
  }
  // Without an APAAR gap the consent paragraph goes too.
  const noConsent = composeUdiseNudge({ guardianName: "", needs: [{ name: "A", classLabel: "I", docs: ["birth certificate"], consent: false }], language: "en", consentAttached: false });
  assert.doesNotMatch(noConsent, /consent form/);
}

/* ── How often ───────────────────────────────────────────────────── */
{
  const now = new Date("2026-09-21T06:00:00Z"); // 11:30 IST
  const due = (lastAtIso: string | null, sentCount: number, istHour = 11) => udiseNudgeDue({ lastAtIso, sentCount, now, istHour }).reason || "due";
  assert.equal(due(null, 0), "due");
  assert.equal(due("2026-09-18T06:00:00Z", 1), "recent", "three days ago");
  assert.equal(due("2026-09-14T05:00:00Z", 1), "due", "a week and an hour ago");
  assert.equal(due(null, UDISE_NUDGE_MAX), "max", "four times, then the office phones");
  assert.equal(due(null, 0, 21), "night");
  assert.equal(due(null, 0, 7), "night");
  assert.equal(due(null, 0, 8), "due");
}

/* ── Whose Aadhaar card this is ──────────────────────────────────── */
{
  const child = (over: Partial<SisStudent>): SisStudent =>
    ({ id: "s1", fullName: "AARAV SINGH", fatherName: "RAMESH SINGH", motherName: "SITA DEVI", aadhaarNumber: "", aadhaarLast4: "", fatherAadhaarNumber: "", motherAadhaarNumber: "", dob: "2016-04-02", gender: "M", ...over }) as SisStudent;
  const kids = [child({}), child({ id: "s2", fullName: "RIYA SINGH" })];
  const card = (over: Partial<UdiseDocExtract>): UdiseDocExtract => ({
    docType: "aadhaar", person: "unknown", nameOnDoc: "", dob: "", aadhaarNumber: "", gender: "", fatherName: "", motherName: "",
    address: "", pincode: "", payment: null, missing: [], notes: "", ...over,
  });

  // The father's card, as the reader returns it: no relation printed.
  const father = resolveDocPerson(card({ nameOnDoc: "Ramesh Singh" }), kids);
  assert.equal(father.person, "father");
  assert.match(father.notes, /by the name "Ramesh Singh"/);
  assert.equal(resolveDocPerson(card({ nameOnDoc: "Sita Devi" }), kids).person, "mother");
  assert.equal(resolveDocPerson(card({ nameOnDoc: "Seeta Devi" }), kids).person, "mother", "a spelling variant still decides");
  assert.equal(resolveDocPerson(card({ nameOnDoc: "Riya Singh" }), kids).person, "child");
  // The reader guessed "child" for an adult's card: the printed name wins.
  const wrong = resolveDocPerson(card({ nameOnDoc: "Ramesh Singh", person: "child" }), kids);
  assert.equal(wrong.person, "father");
  assert.match(wrong.notes, /reading said child/);
  // Nobody on record, or not an Aadhaar: left for the office.
  assert.equal(resolveDocPerson(card({ nameOnDoc: "Mohan Lal" }), kids).person, "unknown");
  assert.equal(resolveDocPerson(card({ docType: "birth_certificate", nameOnDoc: "Ramesh Singh" }), kids).person, "unknown");

  // And the father's number lands in the father's field — on each child.
  const plan = planUdiseCorrections({
    extract: resolveDocPerson(card({ nameOnDoc: "Ramesh Singh", aadhaarNumber: "234123412346" }), kids),
    student: kids[1]! as never,
    household: null,
  });
  const f = plan.changes.find((c) => c.field === "fatherAadhaarNumber");
  assert.ok(f && f.apply && f.after === "234123412346", "father's Aadhaar → fatherAadhaarNumber");
  assert.ok(!plan.changes.some((c) => c.field === "aadhaarNumber"), "never the child's field");
  const m = planUdiseCorrections({
    extract: resolveDocPerson(card({ nameOnDoc: "Sita Devi", aadhaarNumber: "234123412346" }), kids),
    student: kids[0]! as never,
    household: null,
  });
  assert.ok(m.changes.some((c) => c.field === "motherAadhaarNumber" && c.apply), "mother's Aadhaar → motherAadhaarNumber");
  const c = planUdiseCorrections({
    extract: resolveDocPerson(card({ nameOnDoc: "Aarav Singh", aadhaarNumber: "234123412346" }), kids),
    student: kids[0]! as never,
    household: null,
  });
  assert.ok(c.changes.some((x) => x.field === "aadhaarNumber" && x.apply), "the child's Aadhaar → aadhaarNumber");
}

console.log("  ok");
