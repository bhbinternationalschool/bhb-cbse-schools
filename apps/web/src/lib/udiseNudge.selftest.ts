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
import { kmBetween, pickAadhaarCentres } from "./aadhaarCentres";

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
  assert.equal(udiseNudgeLogLine(needs), "Aarav Singh: child's Aadhaar card, father's or mother's Aadhaar card, APAAR consent (buttons) · Riya Singh: birth certificate, APAAR consent (buttons)");
  // Aadhaar received but not yet verified on the portal: the school's job, not the parent's.
  assert.deepEqual(udiseNudgeNeeds([{ name: "Shruti", classLabel: "VII A", gaps: ["student_aadhaar_unverified", "apaar"], hasDob: true, hasAddress: true }], "en")[0]!.docs, [], "never asked to resend a card we hold");
  // A PEN missing on the portal side, APAAR already made: nothing the parent can send.
  assert.deepEqual(udiseNudgeNeeds([{ name: "X", classLabel: "I", gaps: ["pen"], hasDob: true, hasAddress: true }], "en"), []);
}

/* ── The message ─────────────────────────────────────────────────── */
{
  const needs = udiseNudgeNeeds([{ name: "Aarav Singh", classLabel: "V A", gaps: ["student_aadhaar", "apaar"], hasDob: true, hasAddress: true }], "hi");
  const hi = composeUdiseNudge({ guardianName: "Ramesh Singh", needs, language: "hi", consentButtonsFollow: true });
  assert.match(hi, /^📋 \*UDISE\+ \/ APAAR ID — ज़रूरी दस्तावेज़\*\nनमस्ते Ramesh Singh जी/);
  assert.match(hi, /\*Aarav Singh\* \(V A\)\n• बच्चे का आधार कार्ड\n• APAAR ID के लिए आपकी सहमति — बस एक बटन दबाइए \(कोई फ़ॉर्म नहीं\)/);
  assert.match(hi, /\*नीचे के संदेश में\* एक बटन/, "the buttons follow");
  assert.doesNotMatch(hi, /हस्ताक्षर करके|Annexure/, "no printed form (21 Sep 2026)");
  assert.match(hi, /जल्द से जल्द/, "urgent, as the school asked");
  assert.match(hi, /PEN\* \(Permanent Education Number\)/);
  assert.match(hi, /One Nation One Student ID/);
  assert.match(hi, /apaar\.education\.gov\.in/, "the source is named");
  assert.match(hi, /आपकी सहमति से ही बनती है/, "consent is said, as the Ministry says it");
  assert.match(hi, /आधार नंबर चैट में टाइप न करें/, "a full Aadhaar never in chat");

  const en = composeUdiseNudge({ guardianName: "", needs: udiseNudgeNeeds([{ name: "Riya", classLabel: "II A", gaps: ["apaar"], hasDob: false, hasAddress: true }], "en"), language: "en", consentButtonsFollow: false });
  assert.match(en, /^📋 \*UDISE\+ \/ APAAR ID — documents needed\*\nDear Parent/);
  assert.match(en, /• birth certificate\n• Your consent for the APAAR ID — just tap a button \(no form\)\n/);
  assert.match(en, /send \*APAAR\* and tap a button/, "asked this week already: how to get the buttons again");
  assert.match(en, /made only with your consent/);
  // Never more than the sources say.
  for (const t of [hi, en]) {
    assert.doesNotMatch(t, /APAAR[^\n.]*(compulsory|mandatory for (all|every) student)/i, "APAAR is voluntary — never called compulsory");
    assert.doesNotMatch(t, /admission (will be|is) (refused|denied|cancelled)/i, "no threats the Ministry does not make");
    assert.ok(t.length < 4096, "one WhatsApp message");
  }
  // Without an APAAR gap the consent paragraph goes too.
  const noConsent = composeUdiseNudge({ guardianName: "", needs: [{ name: "A", classLabel: "I", docs: ["birth certificate"], consent: false, recheck: null, enrol: null }], language: "en", consentButtonsFollow: false });
  assert.doesNotMatch(noConsent, /tap a button|consent form/i);
  // A parent who already answered — yes or no — is never asked again.
  assert.equal(udiseNudgeNeeds([{ name: "R", classLabel: "I", gaps: ["apaar"], hasDob: true, hasAddress: true, apaarAnswered: true }], "en").length, 0);
}

/* ── Aadhaar rejected by the portal: why, and what to do ──────────── */
{
  // Rudrans Singh, 21 Sep 2026: Aadhaar on file, portal said "Validation failed".
  const needs = udiseNudgeNeeds(
    [{ name: "RUDRANS SINGH", classLabel: "VI A", gaps: ["student_aadhaar_unverified", "apaar"], hasDob: true, hasAddress: true, aadhaarFailed: { dob: "2016-06-09", gender: "M", last4: "6648" } }],
    "hi",
  );
  assert.deepEqual(needs[0]!.docs, ["बच्चे के आधार कार्ड की साफ़ फ़ोटो — आगे और पीछे (दोबारा जाँच के लिए)"], "a card we hold IS asked for again when the portal rejected it");
  const hi = composeUdiseNudge({ guardianName: "Sujeet Singh", needs, language: "hi", consentButtonsFollow: true });
  assert.match(hi, /⚠️ \*आधार सत्यापन नहीं हुआ\*\n\*RUDRANS SINGH\* का आधार UDISE\+ पोर्टल पर सत्यापित नहीं हो सका \("Validation failed"\)। स्कूल के रिकॉर्ड में: जन्म तिथि 09-06-2016 · लिंग पुरुष · आधार के अंतिम 4 अंक 6648/);
  assert.match(hi, /नाम, जन्म तिथि और लिंग बिल्कुल वैसे ही/, "why: what the portal compares");
  assert.match(hi, /दोबारा जाँच/, "asks for it again, for a re-check");
  assert.match(hi, /₹75/);
  assert.match(hi, /30 सितंबर 2026 तक निःशुल्क/);
  assert.match(hi, /appointments\.uidai\.gov\.in/);
  assert.match(hi, /UIDAI — uidai\.gov\.in/, "the UIDAI source is cited when the fees are");
  assert.ok(hi.length < 4096, `one WhatsApp message (${hi.length})`);
  assert.doesNotMatch(hi, /\d{4} \d{4} \d{4}/, "never a full Aadhaar number");
  const en = composeUdiseNudge({ guardianName: "", needs: udiseNudgeNeeds([{ name: "Vidhi", classLabel: "VII A", gaps: [], hasDob: true, hasAddress: true, aadhaarFailed: { dob: "", gender: "F", last4: "" } }], "en"), language: "en", consentButtonsFollow: false });
  assert.match(en, /\*Vidhi\*'s Aadhaar could not be verified on the UDISE\+ portal \("Validation failed"\)\. The school's record: date of birth — · gender Female\n/);
  assert.match(en, /a clear photo of the child's Aadhaar card — front and back \(for a re-check\)/, "asked even when nothing else is missing");
  // No failure, no section.
  assert.doesNotMatch(composeUdiseNudge({ guardianName: "", needs: udiseNudgeNeeds([{ name: "X", classLabel: "I", gaps: ["apaar"], hasDob: true, hasAddress: true }], "en"), language: "en", consentButtonsFollow: false }), /not verified|uidai/i);
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



/* ── No Aadhaar yet: how to enrol, and where ─────────────────────── */
{
  const school = { lat: 25.4354328, lng: 82.9439863 };
  // Shapes as Google Places returned them near the school on 21 Sep 2026.
  const places = [
    { place_id: "p1", name: "Aadhar Seva Kendra (आधार संशोधन केंद्र)", formatted_address: "near Sharmila Inter College, Puari Khurd, Uttar Pradesh 221202, India", business_status: "OPERATIONAL", user_ratings_total: 1, geometry: { location: { lat: 25.4446, lng: 82.9465 } } },
    { place_id: "p2", name: "Aadhar Center", formatted_address: "Sarnath - Munari Rd, Singhpur, Sarnath, Varanasi, India", business_status: "OPERATIONAL", user_ratings_total: 113, geometry: { location: { lat: 25.3925, lng: 83.0237 } } },
    { place_id: "p3", name: "Aadhaar Seva Kendra - Lahartara", formatted_address: "DLW Rd, Lahartara, Varanasi, India", business_status: "OPERATIONAL", user_ratings_total: 351, geometry: { location: { lat: 25.3070, lng: 82.9710 } } },
    { place_id: "p3", name: "Aadhaar Seva Kendra - Lahartara", formatted_address: "duplicate from the second query", business_status: "OPERATIONAL", user_ratings_total: 351, geometry: { location: { lat: 25.3070, lng: 82.9710 } } },
    { place_id: "p4", name: "Closed Aadhaar Point", formatted_address: "x", business_status: "CLOSED_PERMANENTLY", user_ratings_total: 50, geometry: { location: { lat: 25.44, lng: 82.95 } } },
    { place_id: "p5", name: "Hotel Ganga View", formatted_address: "matched the word, sells rooms", business_status: "OPERATIONAL", user_ratings_total: 900, geometry: { location: { lat: 25.44, lng: 82.95 } } },
    { place_id: "p6", name: "Aadhaar Seva Kendra", formatted_address: "far away", business_status: "OPERATIONAL", user_ratings_total: 40, geometry: { location: { lat: 26.5, lng: 83.5 } } },
  ];
  const picked = pickAadhaarCentres(places, school, { max: 3 });
  assert.deepEqual(picked.map((c) => c.placeId), ["p2", "p3"], "used centres, nearest first; no 1-review listing while better exist; no closed, hotel, duplicate or far-off one");
  assert.match(picked[0]!.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Aadhar%20Center&query_place_id=p2$/);
  assert.equal(picked[1]!.address, "DLW Rd, Lahartara, Varanasi", "', India' trimmed");
  // Nothing well used near: the only listing is still better than none.
  assert.deepEqual(pickAadhaarCentres([places[0]!], school).map((c) => c.placeId), ["p1"]);
  assert.ok(Math.abs(kmBetween(school, { lat: 25.3070, lng: 82.9710 }) - 14.8) < 0.5);

  const today = "2026-09-21";
  const needs = udiseNudgeNeeds(
    [
      { name: "NAVYA SINGH", classLabel: "Nursery A", gaps: ["student_aadhaar", "pen", "apaar", "parent_aadhaar"], hasDob: true, hasAddress: true, dob: "2022-05-10" },
      { name: "SUJIT KUMAR", classLabel: "VIII A", gaps: ["student_aadhaar", "apaar"], hasDob: true, hasAddress: true, dob: "2013-01-01" },
    ],
    "hi",
    today,
  );
  assert.deepEqual(needs.map((n) => n.enrol?.under5), [true, false]);
  const hi = composeUdiseNudge({ guardianName: "Sandesh", needs, language: "hi", consentButtonsFollow: true, centres: picked });
  assert.match(hi, /🆔 \*आधार नहीं बना है\? ऐसे बनवाएँ — नया आधार निःशुल्क है\*/);
  assert.match(hi, /\*NAVYA SINGH\* \(5 वर्ष से कम\), \*SUJIT KUMAR\* \(5 वर्ष या अधिक\)/);
  assert.match(hi, /जन्म प्रमाणपत्र\* और \*माता-पिता का आधार कार्ड/);
  assert.match(hi, /केवल फ़ोटो ली जाती है/, "under 5: photo only");
  assert.match(hi, /बायोमेट्रिक/, "5 and over: biometrics");
  assert.match(hi, /स्कूल UIDAI के निर्धारित फ़ॉर्मेट में छात्र का प्रमाणपत्र/, "the school certificate, UIDAI list item 13(v)");
  assert.match(hi, /📍 \*स्कूल के पास के आधार केंद्र\* \(Google Maps\):\n1\. Aadhar Center — लगभग \d+(\.\d)? किमी\n   https:\/\/www\.google\.com\/maps/);
  assert.match(hi, /appointments\.uidai\.gov\.in/);
  assert.ok(hi.length < 4096, `one WhatsApp message (${hi.length})`);
  // Without centres the section still says how; it never invents a place.
  const bare = composeUdiseNudge({ guardianName: "", needs, language: "en", consentButtonsFollow: false });
  assert.match(bare, /No Aadhaar yet\? How to get one — new enrolment is free/);
  assert.doesNotMatch(bare, /centres near/);
  // Distances from the family's own home only when the home is located.
  assert.match(composeUdiseNudge({ guardianName: "", needs, language: "en", consentButtonsFollow: false, centres: picked, centresNear: "home" }), /Aadhaar centres near you/);
  // A rejected Aadhaar is a re-check, not a new enrolment.
  assert.equal(udiseNudgeNeeds([{ name: "R", classLabel: "VI", gaps: ["student_aadhaar_unverified", "apaar"], hasDob: true, hasAddress: true, aadhaarFailed: { dob: "", gender: "M", last4: "" } }], "en")[0]!.enrol, null);
}

console.log("  ok");
