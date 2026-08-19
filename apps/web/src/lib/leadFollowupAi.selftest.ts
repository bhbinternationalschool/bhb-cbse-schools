import assert from "node:assert/strict";
import {
  buildFollowupSystemPrompt,
  buildFollowupUserPrompt,
  cleanFollowupFacts,
  followupDraftLanguage,
  followupUngroundedNumbers,
  parseFollowupDraft,
} from "./leadFollowupAi";

console.log("leadFollowupAi.selftest.ts");

const facts = cleanFollowupFacts({
  schoolName: "BHB International School",
  counsellorName: "Ritu",
  childName: "Aarav",
  guardianName: "Mr Sharma",
  classSoughtLabel: "VI",
  stageLabel: "Enquiry",
  sourceLabel: "Website",
  daysSinceEnquiry: 4,
  concerns: ["transport", "fees", "bogus-but-kept"],
  recentTouchpoints: ["Call: No answer", "WhatsApp: Interested (asked about bus)"],
  kbSnippets: [{ title: "Transport", text: "Bus covers Sigra, Lanka and Bhelupur; fee ₹1,200 per month." }],
  counsellorNote: "Invite to open house on 24 Aug",
  registerUrl: "https://bhbinternational.school/register?src=wa",
  hook: "",
});

// Absent facts are declared absent, never filled.
const noKb = buildFollowupUserPrompt(cleanFollowupFacts({ schoolName: "S", concerns: [] }));
assert.match(noKb, /not asked \/ not recorded — do not guess/);
assert.match(noKb, /Approved school facts: none supplied/);
assert.match(noKb, /none logged yet/);

const withKb = buildFollowupUserPrompt(facts);
assert.match(withKb, /School transport, Fees & concessions, bogus-but-kept/);
assert.match(withKb, /Approved school facts you MAY use:/);
assert.match(withKb, /Transport: Bus covers Sigra/);
assert.match(withKb, /Counsellor's note for this draft: Invite to open house on 24 Aug/);

assert.match(buildFollowupSystemPrompt({ tone: "warm", draftIn: "hi" }), /Devanagari/);
assert.match(buildFollowupSystemPrompt({ tone: "urgent", draftIn: "en" }), /never invent scarcity/);

// Language routing: regional → draft in Hindi, translate via Sarvam; bho → Hindi only.
assert.deepEqual(followupDraftLanguage("en"), { draftIn: "en", translateTo: null });
assert.deepEqual(followupDraftLanguage("hi"), { draftIn: "hi", translateTo: null });
assert.deepEqual(followupDraftLanguage("bho"), { draftIn: "hi", translateTo: null });
assert.deepEqual(followupDraftLanguage("bn"), { draftIn: "hi", translateTo: "bn" });
assert.deepEqual(followupDraftLanguage(""), { draftIn: "en", translateTo: null });

// Parser: partial JSON ok, empty → null, lengths capped.
assert.equal(parseFollowupDraft("{}"), null);
assert.equal(parseFollowupDraft("nope"), null);
const d = parseFollowupDraft(JSON.stringify({ whatsapp: "Hi *Mr Sharma*", sms: "x".repeat(500), email: { subject: "S", body: "B" }, callScript: ["a", "", "b"] }));
assert.ok(d);
assert.equal(d!.sms.length, 320);
assert.deepEqual(d!.callScript, ["a", "b"]);

// Grounding check: numbers from facts pass, invented ones are flagged.
const ok = followupUngroundedNumbers(
  { whatsapp: "Bus fee is ₹1,200 per month; open house on 24 Aug", sms: "", email: { subject: "", body: "" }, callScript: [] },
  facts,
);
assert.deepEqual(ok, []);
const bad = followupUngroundedNumbers(
  { whatsapp: "Admission fee is ₹25,000 and last date 30/09/2026", sms: "Only 5000 seats", email: { subject: "", body: "" }, callScript: [] },
  facts,
);
assert.ok(bad.includes("₹25000") && bad.includes("30/09/2026") && bad.includes("5000"), JSON.stringify(bad));

console.log("OK — leadFollowupAi.selftest.ts");
